// Proofs for the Owner-controlled authorization model.
//
// The load-bearing property is the first section: applying this model changes
// nobody's access until the Owner records a decision. Everything after that
// exercises the Owner's controls.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { addUser, backend, browserHeaders, cookieHeader, driver, putObject, resetBackend } from './helpers/harness.js';
import { handle, invalidateAccessCache, respondToError } from '../src/server.js';
import { resetAuthProvisioningCache, resetLoginThrottle } from '../src/auth.js';
import { canAccessCase, resolveAccess, scopeFor } from '../src/access.js';

const request = driver(handle, respondToError);

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const CASE_A1 = '11111111-1111-4111-8111-111111111111';
const CASE_A2 = '11111111-1111-4111-8111-111111111112';
const CASE_B1 = '22222222-2222-4222-8222-222222222221';
const TEAM_NORTH = '33333333-3333-4333-8333-333333333331';
const TEAM_SOUTH = '33333333-3333-4333-8333-333333333332';

let owner;
let manager;
let reviewer;
let portalClient;

async function signIn(email) {
  const response = await request({
    method: 'POST',
    path: '/api/v1/auth/login',
    headers: browserHeaders(),
    body: { email, password: 'correct-horse-battery' },
  });
  assert.equal(response.status, 200, `sign-in failed for ${email}: ${response.raw}`);
  return cookieHeader(response.cookies);
}

function seedWorkspace() {
  backend.tables.clients.push(
    { id: CLIENT_A, legal_name: 'Amina Yusuf', created_at: new Date().toISOString() },
    { id: CLIENT_B, legal_name: 'Omar Farah', created_at: new Date().toISOString() },
  );
  backend.tables.teams.push(
    { id: TEAM_NORTH, name: 'North', created_at: new Date().toISOString() },
    { id: TEAM_SOUTH, name: 'South', created_at: new Date().toISOString() },
  );
  const base = { case_type: 'Naturalization', status: 'intake', priority: 'normal', created_at: new Date().toISOString() };
  backend.tables.cases.push(
    { id: CASE_A1, client_name: 'Amina Yusuf', client_id: CLIENT_A, team_id: TEAM_NORTH, ...base },
    { id: CASE_A2, client_name: 'Amina Yusuf', client_id: CLIENT_A, team_id: TEAM_SOUTH, ...base },
    { id: CASE_B1, client_name: 'Omar Farah', client_id: CLIENT_B, team_id: TEAM_SOUTH, ...base },
  );
  // Assignment lives in case_assignments on this schema.
  backend.tables.case_assignments.push({ case_id: CASE_A1, auth_user_id: manager.id, assignment_role: 'lead', active: true });
}

function seedDocument(caseId, id = crypto.randomUUID()) {
  const key = `cases/${caseId}/${id}-file.pdf`;
  backend.tables.documents.push({
    id,
    case_id: caseId,
    object_key: key,
    file_name: 'file.pdf',
    content_type: 'application/pdf',
    size_bytes: 1024,
    status: 'uploaded',
    created_at: new Date().toISOString(),
  });
  putObject(key, { size: 1024, contentType: 'application/pdf' });
  return id;
}

async function setPolicy(ownerCookie, policy) {
  const response = await request({
    method: 'PUT',
    path: '/api/v1/access/policies',
    headers: browserHeaders({ cookie: ownerCookie }),
    body: policy,
  });
  assert.equal(response.status, 200, `policy write failed: ${response.raw}`);
  return response.body.data;
}

async function addRecordGrant(ownerCookie, grant) {
  const response = await request({
    method: 'POST',
    path: '/api/v1/access/record-grants',
    headers: browserHeaders({ cookie: ownerCookie }),
    body: grant,
  });
  assert.equal(response.status, 201, `record grant failed: ${response.raw}`);
  return response.body.data;
}

async function caseIds(cookie) {
  const response = await request({ path: '/api/v1/cases', headers: { cookie } });
  assert.equal(response.status, 200, response.raw);
  return response.body.data.map(row => row.id).sort();
}

beforeEach(() => {
  resetBackend();
  resetLoginThrottle();
  resetAuthProvisioningCache();
  invalidateAccessCache();
  owner = addUser({ email: 'owner@caseflow.test', roles: ['owner'], fullName: 'Owner' });
  manager = addUser({ email: 'manager@caseflow.test', roles: ['case_manager'], fullName: 'Case Manager' });
  reviewer = addUser({ email: 'reviewer@caseflow.test', roles: ['document_reviewer'], fullName: 'Doc Reviewer' });
  portalClient = addUser({ email: 'client@caseflow.test', roles: ['client_owner'], fullName: 'Portal Client' });
  seedWorkspace();
});

// ---------------------------------------------------------------------------
// 1. Existing staff access is unchanged by default
// ---------------------------------------------------------------------------

test('with no Owner policy recorded, staff see every case exactly as before', async () => {
  assert.equal(backend.tables.access_policies.length, 0, 'the migration records no policies');
  assert.equal(backend.tables.record_access_grants.length, 0);

  const cookie = await signIn('manager@caseflow.test');
  assert.deepEqual(await caseIds(cookie), [CASE_A1, CASE_A2, CASE_B1].sort());

  // Direct UUID access to a case they are neither assigned nor teamed to.
  const direct = await request({ path: `/api/v1/cases/${CASE_B1}`, headers: { cookie } });
  assert.equal(direct.status, 200, 'broad staff access must survive the migration');
});

test('the default scope for every staff module is global', async () => {
  const cookie = await signIn('manager@caseflow.test');
  const me = await request({ path: '/api/v1/auth/me', headers: { cookie } });
  assert.equal(me.status, 200);
  for (const [module, scope] of Object.entries(me.body.user.access.scopes)) {
    assert.equal(scope, 'global', `${module} must default to global so nothing narrows on migration`);
  }
});

test('team membership alone never narrows anyone', async () => {
  backend.tables.team_members.push({ team_id: TEAM_NORTH, user_id: manager.id });
  invalidateAccessCache();
  const cookie = await signIn('manager@caseflow.test');
  assert.deepEqual(
    await caseIds(cookie),
    [CASE_A1, CASE_A2, CASE_B1].sort(),
    'joining a team is not by itself a restriction',
  );
});

test('documents and audit stay fully visible to staff by default', async () => {
  seedDocument(CASE_A1);
  seedDocument(CASE_B1);
  backend.tables.audit_events.push(
    { id: crypto.randomUUID(), case_id: CASE_A1, action: 'case_created', entity_type: 'case', created_at: new Date().toISOString() },
    { id: crypto.randomUUID(), case_id: CASE_B1, action: 'case_created', entity_type: 'case', created_at: new Date().toISOString() },
  );

  const cookie = await signIn('manager@caseflow.test');
  const documents = await request({ path: '/api/v1/documents', headers: { cookie } });
  assert.equal(documents.body.data.length, 2);

  const auditorCookie = await signIn('owner@caseflow.test');
  const auditTrail = await request({ path: '/api/v1/audit', headers: { cookie: auditorCookie } });
  assert.ok(auditTrail.body.data.filter(row => row.case_id).length >= 2, 'staff audit stays firm-wide by default');
});

// ---------------------------------------------------------------------------
// 2. Owner is unrestricted
// ---------------------------------------------------------------------------

test('the Owner is unrestricted and cannot be restricted', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');

  const refused = await request({
    method: 'PUT',
    path: '/api/v1/access/policies',
    headers: browserHeaders({ cookie: ownerCookie }),
    body: { subject_type: 'role', subject_id: 'owner', restrictions: ['cases.view'] },
  });
  assert.equal(refused.status, 400, 'a policy pretending to limit the owner role is refused outright');

  // Even a user-level restriction aimed at the owner is inert in the engine.
  const access = resolveAccess({
    principal: { id: owner.id, roles: ['owner'], permissions: new Set(['*']) },
    policies: [{ subject_type: 'user', subject_id: owner.id, restrictions: ['cases.view'], grants: [], scopes: { cases: 'assigned' } }],
  });
  assert.equal(scopeFor(access, 'cases'), 'global');
  assert.equal(canAccessCase(access, { id: CASE_B1 }, 'cases.view'), true);
});

test('only the Owner may reach access management until they delegate it', async () => {
  const managerCookie = await signIn('manager@caseflow.test');
  assert.equal((await request({ path: '/api/v1/access', headers: { cookie: managerCookie } })).status, 403);

  const ownerCookie = await signIn('owner@caseflow.test');
  assert.equal((await request({ path: '/api/v1/access', headers: { cookie: ownerCookie } })).status, 200);

  // Rule: nothing is a permanent ceiling. The Owner can hand the control over.
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: manager.id, grants: ['access.manage'] });
  assert.equal((await request({ path: '/api/v1/access', headers: { cookie: managerCookie } })).status, 200);
});

// ---------------------------------------------------------------------------
// 3. Owner can restrict
// ---------------------------------------------------------------------------

test('Owner can restrict a user to only the cases assigned to them', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const managerCookie = await signIn('manager@caseflow.test');
  assert.equal((await caseIds(managerCookie)).length, 3);

  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: manager.id, scopes: { cases: 'assigned', documents: 'assigned' } });

  assert.deepEqual(await caseIds(managerCookie), [CASE_A1]);
  const blocked = await request({ path: `/api/v1/cases/${CASE_B1}`, headers: { cookie: managerCookie } });
  assert.equal(blocked.status, 404, 'direct UUID access obeys the same scope');
});

test('Owner can restrict a user to their team', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  backend.tables.team_members.push({ team_id: TEAM_SOUTH, user_id: manager.id });
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: manager.id, scopes: { cases: 'team' } });

  const managerCookie = await signIn('manager@caseflow.test');
  assert.deepEqual(await caseIds(managerCookie), [CASE_A2, CASE_B1].sort());
});

test('Owner can restrict a whole role, and a user policy still overrides it', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'role', subject_id: 'case_manager', scopes: { cases: 'assigned' } });

  const managerCookie = await signIn('manager@caseflow.test');
  assert.deepEqual(await caseIds(managerCookie), [CASE_A1], 'the role-level restriction applies');

  // Rule 5: override a role restriction for one individual.
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: manager.id, scopes: { cases: 'global' } });
  assert.deepEqual(await caseIds(managerCookie), [CASE_A1, CASE_A2, CASE_B1].sort(), 'the user policy overrides the role');
});

test('Owner can remove a permission from one user without touching their role', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const managerCookie = await signIn('manager@caseflow.test');

  const before = await request({
    method: 'POST',
    path: '/api/v1/cases',
    headers: browserHeaders({ cookie: managerCookie }),
    body: { client_name: 'New Matter', case_type: 'Naturalization' },
  });
  assert.equal(before.status, 201);

  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: manager.id, restrictions: ['cases.manage'] });

  const after = await request({
    method: 'POST',
    path: '/api/v1/cases',
    headers: browserHeaders({ cookie: managerCookie }),
    body: { client_name: 'Blocked Matter', case_type: 'Naturalization' },
  });
  assert.equal(after.status, 403);

  // Another holder of the same role is unaffected.
  const peer = addUser({ email: 'peer@caseflow.test', roles: ['case_manager'], fullName: 'Peer' });
  assert.ok(peer);
  const peerCookie = await signIn('peer@caseflow.test');
  const peerWrite = await request({
    method: 'POST',
    path: '/api/v1/cases',
    headers: browserHeaders({ cookie: peerCookie }),
    body: { client_name: 'Peer Matter', case_type: 'Naturalization' },
  });
  assert.equal(peerWrite.status, 201, 'a user-level restriction must not leak onto the role');
});

// ---------------------------------------------------------------------------
// 4. Owner can expand
// ---------------------------------------------------------------------------

test('Owner can expand a user beyond their role defaults', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const reviewerCookie = await signIn('reviewer@caseflow.test');

  // document_reviewer holds no audit.view and no cases.manage.
  assert.equal((await request({ path: '/api/v1/audit', headers: { cookie: reviewerCookie } })).status, 403);

  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: reviewer.id, grants: ['audit.view', 'cases.manage'] });

  assert.equal((await request({ path: '/api/v1/audit', headers: { cookie: reviewerCookie } })).status, 200);
  const write = await request({
    method: 'POST',
    path: '/api/v1/cases',
    headers: browserHeaders({ cookie: reviewerCookie }),
    body: { client_name: 'Expanded', case_type: 'I-751' },
  });
  assert.equal(write.status, 201, 'an Owner grant expands beyond the role');
});

test('a user-level grant overrides a team-level restriction', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  backend.tables.team_members.push({ team_id: TEAM_NORTH, user_id: manager.id });
  await setPolicy(ownerCookie, { subject_type: 'team', subject_id: TEAM_NORTH, restrictions: ['cases.manage'] });

  const managerCookie = await signIn('manager@caseflow.test');
  const blocked = await request({
    method: 'POST',
    path: '/api/v1/cases',
    headers: browserHeaders({ cookie: managerCookie }),
    body: { client_name: 'Team blocked', case_type: 'I-751' },
  });
  assert.equal(blocked.status, 403);

  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: manager.id, grants: ['cases.manage'] });
  const allowed = await request({
    method: 'POST',
    path: '/api/v1/cases',
    headers: browserHeaders({ cookie: managerCookie }),
    body: { client_name: 'User granted', case_type: 'I-751' },
  });
  assert.equal(allowed.status, 201, 'the individual layer is applied last');
});

test('clearing a policy returns the subject to unchanged defaults', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: manager.id, scopes: { cases: 'assigned' } });

  const managerCookie = await signIn('manager@caseflow.test');
  assert.deepEqual(await caseIds(managerCookie), [CASE_A1]);

  const cleared = await request({
    method: 'DELETE',
    path: `/api/v1/access/policies/user/${manager.id}`,
    headers: browserHeaders({ cookie: ownerCookie }),
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual(await caseIds(managerCookie), [CASE_A1, CASE_A2, CASE_B1].sort());
});

// ---------------------------------------------------------------------------
// 5. Explicit record grants and revocation
// ---------------------------------------------------------------------------

test('Owner can grant a narrowed user access to one specific case', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: manager.id, scopes: { cases: 'assigned' } });

  const managerCookie = await signIn('manager@caseflow.test');
  assert.deepEqual(await caseIds(managerCookie), [CASE_A1]);

  await addRecordGrant(ownerCookie, {
    subject_type: 'user', subject_id: manager.id, resource_type: 'case', resource_id: CASE_B1, effect: 'grant',
  });

  assert.deepEqual(await caseIds(managerCookie), [CASE_A1, CASE_B1].sort());
  assert.equal((await request({ path: `/api/v1/cases/${CASE_B1}`, headers: { cookie: managerCookie } })).status, 200);
  assert.equal((await request({ path: `/api/v1/cases/${CASE_A2}`, headers: { cookie: managerCookie } })).status, 404);
});

test('Owner can grant access to every case of one specific client', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: reviewer.id, scopes: { cases: 'explicit_client' } });

  const reviewerCookie = await signIn('reviewer@caseflow.test');
  assert.deepEqual(await caseIds(reviewerCookie), [], 'explicit_client starts from nothing');

  await addRecordGrant(ownerCookie, {
    subject_type: 'user', subject_id: reviewer.id, resource_type: 'client', resource_id: CLIENT_A, effect: 'grant',
  });

  assert.deepEqual(await caseIds(reviewerCookie), [CASE_A1, CASE_A2].sort(), 'both of that client\'s cases, and no others');
});

test('Owner can revoke an explicit grant', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: manager.id, scopes: { cases: 'assigned' } });
  const grant = await addRecordGrant(ownerCookie, {
    subject_type: 'user', subject_id: manager.id, resource_type: 'case', resource_id: CASE_B1, effect: 'grant',
  });

  const managerCookie = await signIn('manager@caseflow.test');
  assert.ok((await caseIds(managerCookie)).includes(CASE_B1));

  const revoked = await request({
    method: 'DELETE',
    path: `/api/v1/access/record-grants/${grant.id}`,
    headers: browserHeaders({ cookie: ownerCookie }),
  });
  assert.equal(revoked.status, 200);
  assert.deepEqual(await caseIds(managerCookie), [CASE_A1]);
});

test('an explicit restriction removes one case from an otherwise global user', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const managerCookie = await signIn('manager@caseflow.test');
  assert.equal((await caseIds(managerCookie)).length, 3);

  await addRecordGrant(ownerCookie, {
    subject_type: 'user', subject_id: manager.id, resource_type: 'case', resource_id: CASE_B1, effect: 'restrict',
  });

  assert.deepEqual(await caseIds(managerCookie), [CASE_A1, CASE_A2].sort());
  assert.equal(
    (await request({ path: `/api/v1/cases/${CASE_B1}`, headers: { cookie: managerCookie } })).status,
    404,
    'a restriction beats a global scope',
  );
});

test('an explicit client restriction removes that client from a global user', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await addRecordGrant(ownerCookie, {
    subject_type: 'user', subject_id: manager.id, resource_type: 'client', resource_id: CLIENT_A, effect: 'restrict',
  });

  const managerCookie = await signIn('manager@caseflow.test');
  assert.deepEqual(await caseIds(managerCookie), [CASE_B1], 'both of that client\'s cases are withheld');
});

test('a record grant can carry its own permission, without widening the module', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, {
    subject_type: 'user',
    subject_id: reviewer.id,
    scopes: { cases: 'explicit_case' },
  });
  await addRecordGrant(ownerCookie, {
    subject_type: 'user',
    subject_id: reviewer.id,
    resource_type: 'case',
    resource_id: CASE_A1,
    effect: 'grant',
    permissions: ['cases.view'],
  });

  const reviewerCookie = await signIn('reviewer@caseflow.test');
  assert.deepEqual(await caseIds(reviewerCookie), [CASE_A1]);

  // The grant carries cases.view only, so managing that case is still refused.
  const write = await request({
    method: 'PATCH',
    path: `/api/v1/cases/${CASE_A1}`,
    headers: browserHeaders({ cookie: reviewerCookie }),
    body: { status: 'filed' },
  });
  assert.equal(write.status, 403);
});

test('a team-addressed record grant reaches every member of that team', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  backend.tables.team_members.push({ team_id: TEAM_NORTH, user_id: reviewer.id });
  await setPolicy(ownerCookie, { subject_type: 'role', subject_id: 'document_reviewer', scopes: { cases: 'explicit_case' } });
  await addRecordGrant(ownerCookie, {
    subject_type: 'team', subject_id: TEAM_NORTH, resource_type: 'case', resource_id: CASE_B1, effect: 'grant',
  });

  const reviewerCookie = await signIn('reviewer@caseflow.test');
  assert.deepEqual(await caseIds(reviewerCookie), [CASE_B1]);
});

// ---------------------------------------------------------------------------
// 6. Documents follow the same model, independently scoped
// ---------------------------------------------------------------------------

test('document listing, signed URLs and deletion all obey the effective model', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const reachable = seedDocument(CASE_A1);
  const unreachable = seedDocument(CASE_B1);

  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: manager.id, scopes: { documents: 'assigned' } });
  const managerCookie = await signIn('manager@caseflow.test');

  const listed = await request({ path: '/api/v1/documents', headers: { cookie: managerCookie } });
  assert.deepEqual(listed.body.data.map(row => row.id), [reachable]);

  const allowedUrl = await request({
    method: 'POST',
    path: '/api/v1/documents/download-url',
    headers: browserHeaders({ cookie: managerCookie }),
    body: { document_id: reachable },
  });
  assert.equal(allowedUrl.status, 200);

  const refusedUrl = await request({
    method: 'POST',
    path: '/api/v1/documents/download-url',
    headers: browserHeaders({ cookie: managerCookie }),
    body: { document_id: unreachable },
  });
  assert.equal(refusedUrl.status, 404, 'a signed URL is a bearer capability and must be gated the same way');

  const refusedDelete = await request({
    method: 'DELETE',
    path: `/api/v1/documents/${unreachable}`,
    headers: browserHeaders({ cookie: managerCookie }),
  });
  assert.equal(refusedDelete.status, 404);
  assert.equal(backend.tables.documents.find(row => row.id === unreachable).status, 'uploaded');

  const refusedUpload = await request({
    method: 'POST',
    path: '/api/v1/documents/presign',
    headers: browserHeaders({ cookie: managerCookie }),
    body: { case_id: CASE_B1, filename: 'x.pdf', content_type: 'application/pdf', size_bytes: 100 },
  });
  assert.equal(refusedUpload.status, 404, 'uploading into an unreachable case is refused');
});

test('document scope is controlled independently of case scope', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  seedDocument(CASE_A1);
  seedDocument(CASE_B1);

  // Cases stay global; documents alone are narrowed.
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: manager.id, scopes: { documents: 'assigned' } });
  const managerCookie = await signIn('manager@caseflow.test');

  assert.equal((await caseIds(managerCookie)).length, 3, 'case access is untouched');
  const documents = await request({ path: '/api/v1/documents', headers: { cookie: managerCookie } });
  assert.equal(documents.body.data.length, 1, 'document access is narrowed on its own');
});

test('audit scope is controlled independently too', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  backend.tables.audit_events.push(
    { id: crypto.randomUUID(), case_id: CASE_A1, action: 'case_created', entity_type: 'case', created_at: new Date().toISOString() },
    { id: crypto.randomUUID(), case_id: CASE_B1, action: 'case_created', entity_type: 'case', created_at: new Date().toISOString() },
  );
  await setPolicy(ownerCookie, {
    subject_type: 'user', subject_id: manager.id, grants: ['audit.view'], scopes: { audit: 'assigned' },
  });

  const managerCookie = await signIn('manager@caseflow.test');
  const trail = await request({ path: '/api/v1/audit', headers: { cookie: managerCookie } });
  assert.equal(trail.status, 200);
  // Only the assigned case's history, and no firm-level rows either.
  assert.deepEqual(trail.body.data.map(row => row.case_id), [CASE_A1]);
  assert.equal((await caseIds(managerCookie)).length, 3, 'narrowing audit did not narrow cases');
});

// ---------------------------------------------------------------------------
// 7. Client portal isolation
// ---------------------------------------------------------------------------

test('a portal client sees only their own client, even if the Owner grants cases.view', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  backend.tables.client_access.push({ client_id: CLIENT_A, auth_user_id: portalClient.id, access_role: 'owner', status: 'active' });

  // Expanding a portal user's permissions must not expand their scope.
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: portalClient.id, grants: ['cases.view', 'documents.view'] });

  const clientCookie = await signIn('client@caseflow.test');
  assert.deepEqual(await caseIds(clientCookie), [CASE_A1, CASE_A2].sort());
  assert.equal(
    (await request({ path: `/api/v1/cases/${CASE_B1}`, headers: { cookie: clientCookie } })).status,
    404,
    'another client\'s case stays invisible',
  );
});

test('an unlinked portal user reaches nothing at all', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: portalClient.id, grants: ['cases.view'] });

  const clientCookie = await signIn('client@caseflow.test');
  assert.deepEqual(await caseIds(clientCookie), [], 'client_self with no client link resolves to nothing');
});

test('a collaborator relationship is an explicit Owner authorization', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const collaborator = addUser({ email: 'collab@caseflow.test', roles: ['client_collaborator'], fullName: 'Collaborator' });
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: collaborator.id, grants: ['cases.view'] });

  const collabCookie = await signIn('collab@caseflow.test');
  assert.deepEqual(await caseIds(collabCookie), [], 'no link, no access');

  const link = await request({
    method: 'POST',
    path: `/api/v1/clients/${CLIENT_A}/access`,
    headers: browserHeaders({ cookie: ownerCookie }),
    body: { auth_user_id: collaborator.id, access_role: 'collaborator' },
  });
  assert.equal(link.status, 200, link.raw);
  assert.deepEqual(await caseIds(collabCookie), [CASE_A1, CASE_A2].sort());

  const unlink = await request({
    method: 'DELETE',
    path: `/api/v1/clients/${CLIENT_A}/access/${collaborator.id}`,
    headers: browserHeaders({ cookie: ownerCookie }),
  });
  assert.equal(unlink.status, 200);
  assert.deepEqual(await caseIds(collabCookie), [], 'revoking the relationship revokes the access');
});

test('a portal client cannot be widened to global by a scope policy on their role', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  backend.tables.client_access.push({ client_id: CLIENT_A, auth_user_id: portalClient.id, access_role: 'owner', status: 'active' });
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: portalClient.id, grants: ['cases.view'] });

  const clientCookie = await signIn('client@caseflow.test');
  const me = await request({ path: '/api/v1/auth/me', headers: { cookie: clientCookie } });
  assert.equal(me.body.user.access.scopes.cases, 'client_self', 'portal principals default to their own client');
  assert.deepEqual(await caseIds(clientCookie), [CASE_A1, CASE_A2].sort());
});

// ---------------------------------------------------------------------------
// 8. Owner tooling and auditability
// ---------------------------------------------------------------------------

test('the Owner can preview a user\'s effective access', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, {
    subject_type: 'user', subject_id: manager.id, restrictions: ['cases.manage'], scopes: { cases: 'assigned' },
  });

  const preview = await request({ path: `/api/v1/access/effective/${manager.id}`, headers: { cookie: ownerCookie } });
  assert.equal(preview.status, 200, preview.raw);
  assert.equal(preview.body.data.scopes.cases, 'assigned');
  assert.equal(preview.body.data.permissions.includes('cases.manage'), false);
  assert.ok(preview.body.data.restrictions.includes('cases.manage'));
});

test('the access catalogue tells the UI everything it needs to render controls', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const response = await request({ path: '/api/v1/access', headers: { cookie: ownerCookie } });
  assert.equal(response.status, 200);
  const data = response.body.data;
  for (const scope of ['global', 'team', 'assigned', 'explicit_client', 'explicit_case', 'client_self']) {
    assert.ok(data.scopes.includes(scope), `scope ${scope} must be offerable`);
  }
  for (const module of ['cases', 'documents', 'tasks', 'deadlines', 'billing', 'audit', 'reports', 'portal']) {
    assert.ok(data.modules.includes(module), `module ${module} must be independently controllable`);
  }
  assert.ok(data.permissions.includes('cases.manage'));
  assert.ok(data.roles.includes('case_manager'));
  assert.equal(data.defaults.staff, 'global');
});

test('every authorization change is written to the append-only audit trail', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: manager.id, scopes: { cases: 'assigned' } });
  await addRecordGrant(ownerCookie, {
    subject_type: 'user', subject_id: manager.id, resource_type: 'case', resource_id: CASE_B1, effect: 'grant',
  });

  const actions = backend.tables.audit_events.map(row => row.action);
  assert.ok(actions.includes('access_policy_set'));
  assert.ok(actions.includes('record_access_granted'));
  const entry = backend.tables.audit_events.find(row => row.action === 'access_policy_set');
  assert.equal(entry.actor_user_id, owner.id);
  assert.ok(entry.metadata.ip);
});

test('a non-owner cannot seize the owner role through user management', async () => {
  const admin = addUser({ email: 'admin@caseflow.test', roles: ['admin'], fullName: 'Admin' });
  const adminCookie = await signIn('admin@caseflow.test');

  // Self-promotion.
  const selfPromote = await request({
    method: 'PATCH',
    path: `/api/v1/users/${admin.id}`,
    headers: browserHeaders({ cookie: adminCookie }),
    body: { roles: ['admin', 'owner'] },
  });
  assert.equal(selfPromote.status, 403, 'an admin must not be able to make themselves owner');
  assert.deepEqual(backend.users.get('admin@caseflow.test').app_metadata.roles, ['admin']);

  // Promoting an accomplice.
  const promoteOther = await request({
    method: 'PATCH',
    path: `/api/v1/users/${manager.id}`,
    headers: browserHeaders({ cookie: adminCookie }),
    body: { roles: ['owner'] },
  });
  assert.equal(promoteOther.status, 403);

  // Inviting a new owner.
  const invite = await request({
    method: 'POST',
    path: '/api/v1/users',
    headers: browserHeaders({ cookie: adminCookie }),
    body: { email: 'accomplice@caseflow.test', roles: ['owner'] },
  });
  assert.equal(invite.status, 403);

  // Demoting the actual Owner, or deactivating them.
  const demote = await request({
    method: 'PATCH',
    path: `/api/v1/users/${owner.id}`,
    headers: browserHeaders({ cookie: adminCookie }),
    body: { roles: ['auditor'] },
  });
  assert.equal(demote.status, 403, 'the Owner cannot be demoted by anyone else');

  const deactivate = await request({
    method: 'PATCH',
    path: `/api/v1/users/${owner.id}`,
    headers: browserHeaders({ cookie: adminCookie }),
    body: { status: 'inactive' },
  });
  assert.equal(deactivate.status, 403, 'the Owner cannot be locked out by anyone else');
});

test('the Owner can assign and remove the owner role', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const promote = await request({
    method: 'PATCH',
    path: `/api/v1/users/${manager.id}`,
    headers: browserHeaders({ cookie: ownerCookie }),
    body: { roles: ['case_manager', 'owner'] },
  });
  assert.equal(promote.status, 200, promote.raw);
  assert.ok(promote.body.data.roles.includes('owner'));

  const demote = await request({
    method: 'PATCH',
    path: `/api/v1/users/${manager.id}`,
    headers: browserHeaders({ cookie: ownerCookie }),
    body: { roles: ['case_manager'] },
  });
  assert.equal(demote.status, 200);
  assert.equal(demote.body.data.roles.includes('owner'), false);
});

test('a delegated access.manage holder still cannot mint an owner', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const admin = addUser({ email: 'admin@caseflow.test', roles: ['admin'], fullName: 'Admin' });
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: admin.id, grants: ['access.manage'] });

  const adminCookie = await signIn('admin@caseflow.test');
  assert.equal((await request({ path: '/api/v1/access', headers: { cookie: adminCookie } })).status, 200);

  const escalate = await request({
    method: 'PATCH',
    path: `/api/v1/users/${admin.id}`,
    headers: browserHeaders({ cookie: adminCookie }),
    body: { roles: ['admin', 'owner'] },
  });
  assert.equal(escalate.status, 403, 'delegating access management is not delegating ownership');
});

test('policy writes are validated', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const cases = [
    [{ subject_type: 'nonsense', subject_id: manager.id }, 'subject_type'],
    [{ subject_type: 'user', subject_id: 'not-a-uuid' }, 'subject_id'],
    [{ subject_type: 'role', subject_id: 'no_such_role' }, 'subject_id'],
    [{ subject_type: 'user', subject_id: manager.id, grants: ['made.up'] }, 'permissions'],
    [{ subject_type: 'user', subject_id: manager.id, scopes: { cases: 'everything' } }, 'scopes'],
    [{ subject_type: 'user', subject_id: manager.id, scopes: { nope: 'global' } }, 'scopes'],
  ];
  for (const [body, field] of cases) {
    const response = await request({
      method: 'PUT', path: '/api/v1/access/policies', headers: browserHeaders({ cookie: ownerCookie }), body,
    });
    assert.equal(response.status, 400, `${JSON.stringify(body)} should be refused`);
    assert.ok(response.body.fields[field], `expected a ${field} error, got ${JSON.stringify(response.body.fields)}`);
  }
});
