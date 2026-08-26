// Unit coverage for the resolver itself.
//
// The API tests exercise the engine through HTTP, where the row-level filter
// is the last word. These tests pin the query-level filter directly, because a
// bug that over-narrows it would silently hide records without any request
// failing, and pin the layering rules that decide who wins.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canAccessCase,
  canAccessDocument,
  caseListFilter,
  filterAccessibleCases,
  hasEffectivePermission,
  moduleOf,
  permissionCatalogue,
  resolveAccess,
  scopeFor,
} from '../src/access.js';

const USER = '44444444-4444-4444-8444-444444444441';
const TEAM = '33333333-3333-4333-8333-333333333331';
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CASE = '11111111-1111-4111-8111-111111111111';

function principal(roles = ['case_manager'], id = USER) {
  return { id, email: 'staff@caseflow.test', displayName: 'Staff', roles, permissions: new Set(), authType: 'session' };
}

function access(overrides = {}) {
  return resolveAccess({ principal: principal(), ...overrides });
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

test('an empty policy set leaves staff at global scope on every module', () => {
  const resolved = access();
  for (const module of ['cases', 'documents', 'tasks', 'deadlines', 'billing', 'audit', 'reports']) {
    assert.equal(scopeFor(resolved, module), 'global', `${module} must default to global`);
  }
  assert.equal(caseListFilter(resolved, 'cases.view'), null, 'global scope adds no query filter');
});

test('a client principal defaults to their own client, not to global', () => {
  const resolved = resolveAccess({ principal: principal(['client_owner']) });
  assert.equal(scopeFor(resolved, 'cases'), 'client_self');
  assert.equal(resolved.isClientPrincipal, true);
});

test('a staff role mixed with a client role is treated as staff', () => {
  const resolved = resolveAccess({ principal: principal(['case_manager', 'client_owner']) });
  assert.equal(resolved.isClientPrincipal, false);
  assert.equal(scopeFor(resolved, 'cases'), 'global');
});

// ---------------------------------------------------------------------------
// Query filter — the part the HTTP tests cannot pin
// ---------------------------------------------------------------------------

test('the query filter matches the scope it was built from', () => {
  const assigned = access({ policies: [{ subject_type: 'user', subject_id: USER, scopes: { cases: 'assigned' } }] });
  assert.equal(caseListFilter(assigned, 'cases.view').query, `&or=(assigned_user_id.eq.${USER})`);

  const team = access({
    policies: [{ subject_type: 'user', subject_id: USER, scopes: { cases: 'team' } }],
    teamIds: [TEAM],
  });
  assert.equal(caseListFilter(team, 'cases.view').query, `&or=(team_id.in.(${TEAM}))`);

  // A portal role holds no cases.view of its own, so the Owner must grant it
  // before the client_self scope has anything to narrow.
  const clientSelf = resolveAccess({
    principal: principal(['client_owner']),
    policies: [{ subject_type: 'user', subject_id: USER, grants: ['cases.view'] }],
    clientIds: [CLIENT],
  });
  assert.equal(caseListFilter(clientSelf, 'cases.view').query, `&or=(client_id.in.(${CLIENT}))`);

  // Without that grant the filter matches nothing rather than everything.
  const ungranted = resolveAccess({ principal: principal(['client_owner']), clientIds: [CLIENT] });
  assert.equal(caseListFilter(ungranted, 'cases.view').matchesNothing, true);
});

test('an explicit grant widens the query filter beyond the configured scope', () => {
  const resolved = access({
    policies: [{ subject_type: 'user', subject_id: USER, scopes: { cases: 'assigned' } }],
    recordGrants: [{ subject_type: 'user', subject_id: USER, resource_type: 'case', resource_id: CASE, effect: 'grant', permissions: [] }],
  });
  const filter = caseListFilter(resolved, 'cases.view');
  assert.ok(filter.query.includes(`assigned_user_id.eq.${USER}`));
  assert.ok(filter.query.includes(`id.in.(${CASE})`));
});

test('a scope with nothing to match yields a filter that matches nothing, never everything', () => {
  // explicit_case with no grants: the danger is returning null here, which
  // PostgREST would read as "no filter" and hand back the whole table.
  const explicit = access({ policies: [{ subject_type: 'user', subject_id: USER, scopes: { cases: 'explicit_case' } }] });
  assert.equal(caseListFilter(explicit, 'cases.view').matchesNothing, true);

  // team scope while belonging to no team.
  const teamless = access({ policies: [{ subject_type: 'user', subject_id: USER, scopes: { cases: 'team' } }] });
  assert.equal(caseListFilter(teamless, 'cases.view').matchesNothing, true);

  // client_self with the permission granted but no client link.
  const unlinked = resolveAccess({
    principal: principal(['client_owner']),
    policies: [{ subject_type: 'user', subject_id: USER, grants: ['cases.view'] }],
  });
  assert.equal(caseListFilter(unlinked, 'cases.view').matchesNothing, true);

  // Lacking the permission entirely.
  const unpermitted = access({ policies: [{ subject_type: 'user', subject_id: USER, restrictions: ['cases.view'] }] });
  assert.equal(caseListFilter(unpermitted, 'cases.view').matchesNothing, true);
});

test('the owner is never narrowed by the query filter', () => {
  const resolved = resolveAccess({ principal: principal(['owner']) });
  assert.equal(caseListFilter(resolved, 'cases.view'), null);
});

test('the query filter and the row filter agree', () => {
  const rows = [
    { id: CASE, client_id: CLIENT, team_id: TEAM, assigned_user_id: USER },
    { id: 'aaaa1111-1111-4111-8111-111111111112', client_id: CLIENT, team_id: null, assigned_user_id: null },
    { id: 'aaaa1111-1111-4111-8111-111111111113', client_id: null, team_id: TEAM, assigned_user_id: null },
  ];
  const resolved = access({
    policies: [{ subject_type: 'user', subject_id: USER, scopes: { cases: 'assigned' } }],
    teamIds: [TEAM],
  });
  assert.equal(caseListFilter(resolved, 'cases.view').query, `&or=(assigned_user_id.eq.${USER})`);
  assert.deepEqual(filterAccessibleCases(resolved, rows, 'cases.view').map(row => row.id), [CASE]);
});

// ---------------------------------------------------------------------------
// Layering
// ---------------------------------------------------------------------------

test('the user layer is applied after the team layer, in both directions', () => {
  const teamRestricts = [{ subject_type: 'team', subject_id: TEAM, restrictions: ['cases.manage'] }];

  const restricted = access({ policies: teamRestricts, teamIds: [TEAM] });
  assert.equal(hasEffectivePermission(restricted, 'cases.manage'), false);

  const overridden = access({
    policies: [...teamRestricts, { subject_type: 'user', subject_id: USER, grants: ['cases.manage'] }],
    teamIds: [TEAM],
  });
  assert.equal(hasEffectivePermission(overridden, 'cases.manage'), true, 'a user grant beats a team restriction');

  const reduced = access({
    policies: [{ subject_type: 'user', subject_id: USER, restrictions: ['cases.view'] }],
  });
  assert.equal(hasEffectivePermission(reduced, 'cases.view'), false, 'a user restriction beats a role default');
});

test('a role policy can add a permission the role never had', () => {
  const resolved = access({ policies: [{ subject_type: 'role', subject_id: 'case_manager', grants: ['audit.view'] }] });
  assert.equal(hasEffectivePermission(resolved, 'audit.view'), true);
});

test('when two teams disagree on scope, the wider one applies', () => {
  const other = '33333333-3333-4333-8333-333333333332';
  const resolved = access({
    policies: [
      { subject_type: 'team', subject_id: TEAM, scopes: { cases: 'assigned' } },
      { subject_type: 'team', subject_id: other, scopes: { cases: 'team' } },
    ],
    teamIds: [TEAM, other],
  });
  assert.equal(scopeFor(resolved, 'cases'), 'team', 'a second membership must not take access away');
});

test('a restriction on one module leaves the others alone', () => {
  const resolved = access({
    policies: [{ subject_type: 'user', subject_id: USER, restrictions: ['documents.manage'], scopes: { documents: 'assigned' } }],
  });
  assert.equal(scopeFor(resolved, 'documents'), 'assigned');
  assert.equal(scopeFor(resolved, 'cases'), 'global');
  assert.equal(hasEffectivePermission(resolved, 'documents.manage'), false);
  assert.equal(hasEffectivePermission(resolved, 'cases.manage'), true);
});

// ---------------------------------------------------------------------------
// Record decisions
// ---------------------------------------------------------------------------

test('an explicit restriction outranks every positive signal short of ownership', () => {
  const record = { id: CASE, client_id: CLIENT, team_id: TEAM, assigned_user_id: USER };
  const resolved = access({
    teamIds: [TEAM],
    recordGrants: [
      { subject_type: 'user', subject_id: USER, resource_type: 'case', resource_id: CASE, effect: 'grant', permissions: [] },
      { subject_type: 'user', subject_id: USER, resource_type: 'case', resource_id: CASE, effect: 'restrict', permissions: [] },
    ],
  });
  assert.equal(canAccessCase(resolved, record, 'cases.view'), false);

  const asOwner = resolveAccess({
    principal: principal(['owner']),
    recordGrants: [{ subject_type: 'user', subject_id: USER, resource_type: 'case', resource_id: CASE, effect: 'restrict', permissions: [] }],
  });
  assert.equal(canAccessCase(asOwner, record, 'cases.view'), true);
});

test('the assigned scope still recognises legacy free-text assignment', () => {
  const resolved = access({ policies: [{ subject_type: 'user', subject_id: USER, scopes: { cases: 'assigned' } }] });
  // A row written before assigned_user_id existed carries only a name.
  assert.equal(canAccessCase(resolved, { id: CASE, assigned_to: 'Staff' }, 'cases.view'), true);
  assert.equal(canAccessCase(resolved, { id: CASE, assigned_to: 'staff@caseflow.test' }, 'cases.view'), true);
  assert.equal(canAccessCase(resolved, { id: CASE, assigned_to: 'Someone Else' }, 'cases.view'), false);
});

test('documents resolve against their case under the documents module', () => {
  const record = { id: CASE, client_id: CLIENT, team_id: TEAM, assigned_user_id: null };
  const resolved = access({
    policies: [{ subject_type: 'user', subject_id: USER, scopes: { documents: 'team', cases: 'global' } }],
    teamIds: ['99999999-9999-4999-8999-999999999999'],
  });
  assert.equal(canAccessCase(resolved, record, 'cases.view'), true, 'case scope is untouched');
  assert.equal(canAccessDocument(resolved, { id: 'doc', case_id: CASE }, record, 'documents.view'), false);
});

test('a record grant carrying specific permissions does not imply the others', () => {
  const record = { id: CASE, client_id: CLIENT };
  const resolved = access({
    policies: [{ subject_type: 'user', subject_id: USER, scopes: { cases: 'explicit_case' } }],
    recordGrants: [{
      subject_type: 'user', subject_id: USER, resource_type: 'case', resource_id: CASE, effect: 'grant', permissions: ['cases.view'],
    }],
  });
  assert.equal(canAccessCase(resolved, record, 'cases.view'), true);
  assert.equal(canAccessCase(resolved, record, 'cases.manage'), false);
});

test('a record grant addressed to someone else is ignored', () => {
  const resolved = access({
    policies: [{ subject_type: 'user', subject_id: USER, scopes: { cases: 'explicit_case' } }],
    recordGrants: [{
      subject_type: 'user',
      subject_id: '55555555-5555-4555-8555-555555555555',
      resource_type: 'case',
      resource_id: CASE,
      effect: 'grant',
      permissions: [],
    }],
  });
  assert.equal(canAccessCase(resolved, { id: CASE }, 'cases.view'), false);
  assert.equal(caseListFilter(resolved, 'cases.view').matchesNothing, true);
});

test('a missing or malformed record is refused, not defaulted open', () => {
  const resolved = access();
  assert.equal(canAccessCase(resolved, null, 'cases.view'), false);
  assert.equal(canAccessCase(resolved, undefined, 'cases.view'), false);
  assert.equal(canAccessDocument(resolved, null, null, 'documents.view'), false);
});

test('permissions map to the module that scopes them', () => {
  assert.equal(moduleOf('cases.view'), 'cases');
  assert.equal(moduleOf('documents.manage'), 'documents');
  assert.equal(moduleOf('audit.view'), 'audit');
  assert.equal(moduleOf('portal.intake'), 'portal');
  assert.equal(moduleOf('nonsense'), 'dashboard');
});

test('the catalogue covers every module the Owner can scope', () => {
  const catalogue = permissionCatalogue();
  for (const module of ['cases', 'documents', 'tasks', 'deadlines', 'billing', 'audit', 'reports', 'portal', 'access']) {
    assert.ok(catalogue.includes(`${module}.view`), `${module}.view must be offerable`);
    assert.ok(catalogue.includes(`${module}.manage`), `${module}.manage must be offerable`);
  }
  assert.equal(catalogue.includes('*'), false, 'the wildcard is the owner role, not a grantable permission');
});
