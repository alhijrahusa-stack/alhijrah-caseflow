// Effective authorization model.
//
// Design rule that drives everything here: nothing narrows by default. A staff
// member's scope is `global` unless the Owner has stored a policy saying
// otherwise, so applying this model to an existing deployment leaves every
// staff member seeing exactly what they saw before. Narrowing is something the
// Owner opts into, per role, per team, per user, or per record.
//
// Effective access is resolved in layers, each able to add or remove:
//
//   role defaults  ->  role policy  ->  team policies  ->  user policy
//
// Later layers win, so a user-level grant overrides a team-level restriction
// and a user-level restriction overrides a role default. Record-level grants
// and restrictions are then applied on top of whatever scope survives.
//
// The Owner is outside the system: no restriction applies to the owner role.

import { roleDefinitions } from './auth.js';
import { serviceCatalog } from './platform.js';

// service_code -> category, so a grant made against a whole practice area
// resolves for a case that only stores its service code.
const serviceCategory = new Map(serviceCatalog.map(service => [service.code, service.category]));
export function categoryOfCase(caseRecord) {
  const code = caseRecord?.service_code;
  return code ? serviceCategory.get(String(code)) || null : null;
}

// Modules the Owner can scope and permission independently.
export const accessModules = Object.freeze([
  'cases',
  'documents',
  'tasks',
  'deadlines',
  'clients',
  'billing',
  'audit',
  'reports',
  'imports',
  'portal',
  'users',
  'workflows',
  'settings',
  'access',
  'dashboard',
]);

// Ordered widest to narrowest. The rank decides which scope wins when several
// teams disagree: the most permissive applies, because a second team
// membership should never silently take access away.
export const accessScopes = Object.freeze([
  'global',
  'team',
  'assigned',
  'explicit_client',
  'explicit_category',
  'explicit_case',
  'client_self',
]);

const scopeRank = Object.freeze({
  global: 6,
  team: 5,
  assigned: 4,
  explicit_client: 3,
  explicit_category: 2,
  explicit_case: 1,
  client_self: 0,
});

// Scope applied when neither the Owner nor a policy has said anything. Staff
// default to global -- this is what preserves existing access on migration.
export const defaultStaffScope = 'global';
// Client portal principals are isolated to their own client unless the Owner
// explicitly authorises a supported collaborator relationship.
export const defaultClientScope = 'client_self';

const clientRoles = new Set(['client_owner', 'client_collaborator']);

export function moduleOf(permission) {
  const [module] = String(permission || '').split('.');
  return accessModules.includes(module) ? module : 'dashboard';
}

export function isValidScope(scope) {
  return accessScopes.includes(scope);
}

// The full permission catalogue, derived from the role defaults so the Owner's
// UI can offer every permission the system understands without a code change
// when a role gains one.
export function permissionCatalogue() {
  const all = new Set();
  for (const permissions of Object.values(roleDefinitions)) {
    for (const permission of permissions) if (permission !== '*') all.add(permission);
  }
  for (const module of accessModules) {
    if (module === 'dashboard') continue;
    all.add(`${module}.view`);
    all.add(`${module}.manage`);
  }
  return [...all].sort();
}

function normalisePermissions(values) {
  if (!Array.isArray(values)) return [];
  return values.map(value => String(value || '').trim()).filter(Boolean);
}

function normaliseScopes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const scopes = {};
  for (const [module, scope] of Object.entries(value)) {
    if (accessModules.includes(module) && isValidScope(scope)) scopes[module] = scope;
  }
  return scopes;
}

export function normalisePolicy(policy) {
  return {
    subject_type: policy.subject_type,
    subject_id: String(policy.subject_id),
    grants: normalisePermissions(policy.grants),
    restrictions: normalisePermissions(policy.restrictions),
    scopes: normaliseScopes(policy.scopes),
  };
}

function applyLayer(state, policy) {
  if (!policy) return;
  for (const permission of policy.grants) {
    state.permissions.add(permission);
    state.restrictions.delete(permission);
  }
  for (const permission of policy.restrictions) {
    state.permissions.delete(permission);
    state.restrictions.add(permission);
  }
  for (const [module, scope] of Object.entries(policy.scopes)) {
    const current = state.scopes[module];
    // Within one layer several policies can apply (a user can be on several
    // teams); the widest wins. Across layers the later layer replaces.
    if (current === undefined || scopeRank[scope] > scopeRank[current]) state.scopes[module] = scope;
  }
}

function findPolicy(policies, subjectType, subjectId) {
  return policies.find(policy => policy.subject_type === subjectType && String(policy.subject_id) === String(subjectId)) || null;
}

/**
 * Resolve everything an authenticated principal may do.
 *
 * @param {object} input
 * @param {object} input.principal      - from principalFromUser()
 * @param {Array}  input.policies       - access_policies rows
 * @param {Array}  input.recordGrants   - record_access_grants rows
 * @param {Array}  input.teamIds        - team ids the user belongs to
 * @param {Array}  input.clientIds      - client ids the user is linked to
 */
export function resolveAccess({ principal, policies = [], recordGrants = [], teamIds = [], clientIds = [], assignedCaseIds = [] } = {}) {
  const roles = principal?.roles || [];
  const isOwner = roles.includes('owner') || principal?.permissions?.has?.('*') || principal?.authType === 'internal';

  const state = {
    permissions: new Set(),
    restrictions: new Set(),
    scopes: {},
  };

  const normalised = policies.map(normalisePolicy);

  // Layer 1: role defaults, then any Owner override of that role.
  for (const role of roles) {
    for (const permission of roleDefinitions[role] || []) state.permissions.add(permission);
  }
  for (const role of roles) applyLayer(state, findPolicy(normalised, 'role', role));

  // Layer 2: every team the user belongs to.
  const teamSet = new Set(teamIds.map(String));
  const teamLayerScopes = {};
  for (const teamId of teamSet) {
    const policy = findPolicy(normalised, 'team', teamId);
    if (!policy) continue;
    applyLayer(state, { ...policy, scopes: {} });
    for (const [module, scope] of Object.entries(policy.scopes)) {
      const current = teamLayerScopes[module];
      if (current === undefined || scopeRank[scope] > scopeRank[current]) teamLayerScopes[module] = scope;
    }
  }
  for (const [module, scope] of Object.entries(teamLayerScopes)) state.scopes[module] = scope;

  // Layer 3: the individual. Applied last so an Owner decision about one
  // person overrides both their role and their teams, in either direction.
  const userPolicy = findPolicy(normalised, 'user', principal?.id);
  if (userPolicy) {
    applyLayer(state, { ...userPolicy, scopes: {} });
    for (const [module, scope] of Object.entries(userPolicy.scopes)) state.scopes[module] = scope;
  }

  // Record-level grants and restrictions addressed to this user or their teams.
  const granted = { case: new Set(), client: new Set(), category: new Set(), service: new Set() };
  const restricted = { case: new Set(), client: new Set(), category: new Set(), service: new Set() };
  const grantPermissions = new Map();
  for (const grant of recordGrants) {
    const matchesUser = grant.subject_type === 'user' && String(grant.subject_id) === String(principal?.id);
    const matchesTeam = grant.subject_type === 'team' && teamSet.has(String(grant.subject_id));
    if (!matchesUser && !matchesTeam) continue;
    if (!['case', 'client', 'category', 'service'].includes(grant.resource_type)) continue;
    // case/client are addressed by uuid; category/service by their text key.
    const target = ['category', 'service'].includes(grant.resource_type)
      ? String(grant.resource_key ?? '')
      : String(grant.resource_id ?? '');
    if (!target) continue;
    const bucket = grant.effect === 'restrict' ? restricted : granted;
    bucket[grant.resource_type].add(target);
    if (grant.effect === 'grant') {
      const key = `${grant.resource_type}:${target}`;
      const permissions = normalisePermissions(grant.permissions);
      // An empty permission list means "everything this person could otherwise
      // do", which is the common case for handing someone one case.
      grantPermissions.set(key, permissions.length ? new Set(permissions) : null);
    }
  }

  const isClientPrincipal = roles.length > 0 && roles.every(role => clientRoles.has(role));

  return {
    userId: principal?.id || null,
    email: principal?.email || null,
    displayName: principal?.displayName || null,
    roles,
    isOwner,
    isClientPrincipal,
    permissions: state.permissions,
    restrictions: state.restrictions,
    scopeOverrides: state.scopes,
    teamIds: teamSet,
    clientIds: new Set(clientIds.map(String)),
    // Assignment lives in case_assignments (case_id, auth_user_id, active), so
    // the assigned scope is a set of case ids rather than a column on the case.
    assignedCaseIds: new Set(assignedCaseIds.map(String)),
    grantedCaseIds: granted.case,
    grantedClientIds: granted.client,
    grantedCategories: granted.category,
    grantedServiceCodes: granted.service,
    restrictedCaseIds: restricted.case,
    restrictedClientIds: restricted.client,
    restrictedCategories: restricted.category,
    restrictedServiceCodes: restricted.service,
    grantPermissions,
  };
}

export function scopeFor(access, module) {
  if (access.isOwner) return 'global';
  const override = access.scopeOverrides[module];
  if (override) return override;
  return access.isClientPrincipal ? defaultClientScope : defaultStaffScope;
}

export function hasEffectivePermission(access, permission) {
  if (access.isOwner) return true;
  if (access.restrictions.has(permission)) return false;
  return access.permissions.has('*') || access.permissions.has(permission);
}

function recordGrantAllows(access, resourceType, resourceId, permission) {
  const explicit = access.grantPermissions.get(`${resourceType}:${resourceId}`);
  if (explicit === undefined) return false;
  return explicit === null || explicit.has(permission);
}

/**
 * Decide access to one case record for one permission.
 *
 * `caseRecord` needs id, and whichever of client_id / team_id /
 * assigned_user_id / assigned_to the configured scope depends on.
 */
export function canAccessCase(access, caseRecord, permission) {
  if (access.isOwner) return true;
  if (!caseRecord) return false;

  const caseId = String(caseRecord.id ?? '');
  const clientId = caseRecord.client_id ? String(caseRecord.client_id) : null;

  // An explicit restriction is absolute for a non-owner: it is how the Owner
  // takes one case or one client away from someone who otherwise qualifies.
  const category = categoryOfCase(caseRecord);
  const serviceCode = caseRecord.service_code ? String(caseRecord.service_code) : null;

  if (access.restrictedCaseIds.has(caseId)) return false;
  if (clientId && access.restrictedClientIds.has(clientId)) return false;
  if (category && access.restrictedCategories.has(category)) return false;
  if (serviceCode && access.restrictedServiceCodes.has(serviceCode)) return false;

  // An explicit grant carries its own permission, so the Owner can hand
  // someone a single case, one client, or a whole practice area without
  // giving them the module generally.
  if (recordGrantAllows(access, 'case', caseId, permission)) return true;
  if (clientId && recordGrantAllows(access, 'client', clientId, permission)) return true;
  if (category && recordGrantAllows(access, 'category', category, permission)) return true;
  if (serviceCode && recordGrantAllows(access, 'service', serviceCode, permission)) return true;

  if (!hasEffectivePermission(access, permission)) return false;

  switch (scopeFor(access, moduleOf(permission))) {
    case 'global':
      return true;
    case 'team':
      return Boolean(caseRecord.team_id) && access.teamIds.has(String(caseRecord.team_id));
    case 'assigned':
      return isAssignedTo(access, caseRecord);
    case 'client_self':
      return Boolean(clientId) && access.clientIds.has(clientId);
    case 'explicit_case':
    case 'explicit_client':
    case 'explicit_category':
      // Reachable only through an explicit grant, already handled above.
      return false;
    default:
      return false;
  }
}

function isAssignedTo(access, caseRecord) {
  if (access.assignedCaseIds.has(String(caseRecord.id ?? ''))) return true;
  if (caseRecord.assigned_user_id && String(caseRecord.assigned_user_id) === String(access.userId)) return true;
  // Legacy free-text assignment, kept working so scoping a user to "assigned"
  // does not blank out cases recorded before case_assignments existed.
  const label = String(caseRecord.assigned_to || '').trim().toLowerCase();
  if (!label) return false;
  return label === String(access.email || '').toLowerCase() || label === String(access.displayName || '').toLowerCase();
}

/**
 * Decide access to one client record.
 *
 * Mirrors canAccessCase: owner bypasses, an explicit restriction is absolute,
 * an explicit grant carries its own permission, and only then does the
 * configured scope apply. `global` -- the default for staff -- returns true, so
 * a deployment with no Owner policy is unchanged.
 *
 * The case-shaped scopes (team, assigned, explicit_case, explicit_category)
 * have no direct meaning for a client row, so they resolve through the clients
 * that own a case the caller can already reach; the caller supplies that set.
 */
export function canAccessClient(access, clientRecord, permission = 'clients.view', { reachableClientIds } = {}) {
  if (access.isOwner) return true;
  if (!clientRecord) return false;

  const clientId = String(clientRecord.id ?? '');
  if (access.restrictedClientIds.has(clientId)) return false;
  if (recordGrantAllows(access, 'client', clientId, permission)) return true;
  if (!hasEffectivePermission(access, permission)) return false;

  switch (scopeFor(access, 'clients')) {
    case 'global':
      return true;
    case 'client_self':
      return access.clientIds.has(clientId);
    default:
      return Boolean(reachableClientIds && reachableClientIds.has(clientId));
  }
}

// Documents are scoped independently of cases, but always in terms of the case
// the document belongs to: a document is reachable when the documents-module
// scope admits its case.
export function canAccessDocument(access, documentRecord, caseRecord, permission) {
  if (access.isOwner) return true;
  if (!documentRecord) return false;
  const subject = caseRecord || { id: documentRecord.case_id, client_id: documentRecord.client_id };
  return canAccessCase(access, subject, permission);
}

/**
 * Build the PostgREST filter that narrows a case listing to what this
 * principal may see, or null when no narrowing is needed.
 *
 * Explicit restrictions are not expressible alongside the positive union, so
 * they are applied by filterAccessibleCases() after the rows come back.
 */
export function caseListFilter(access, permission = 'cases.view') {
  if (access.isOwner) return null;

  const clauses = [];
  const scope = scopeFor(access, moduleOf(permission));
  const permitted = hasEffectivePermission(access, permission);
  const globallyPermitted = permitted && scope === 'global';

  if (permitted) {
    if (scope === 'team' && access.teamIds.size) clauses.push(`team_id.in.(${[...access.teamIds].join(',')})`);
    if (scope === 'assigned') {
      if (access.assignedCaseIds.size) clauses.push(`id.in.(${[...access.assignedCaseIds].join(',')})`);
      if (access.userId) clauses.push(`assigned_user_id.eq.${access.userId}`);
    }
    if (scope === 'client_self' && access.clientIds.size) clauses.push(`client_id.in.(${[...access.clientIds].join(',')})`);
  }

  // Explicit grants widen the listing regardless of the configured scope.
  const grantedCases = [...access.grantedCaseIds].filter(id => recordGrantAllows(access, 'case', id, permission));
  const grantedClients = [...access.grantedClientIds].filter(id => recordGrantAllows(access, 'client', id, permission));
  if (grantedCases.length) clauses.push(`id.in.(${grantedCases.join(',')})`);
  if (grantedClients.length) clauses.push(`client_id.in.(${grantedClients.join(',')})`);

  // A category grant covers every service code in that practice area, so it
  // expands into the codes the catalogue lists for it.
  const grantedCodes = new Set([...access.grantedServiceCodes].filter(code => recordGrantAllows(access, 'service', code, permission)));
  for (const category of access.grantedCategories) {
    if (!recordGrantAllows(access, 'category', category, permission)) continue;
    for (const [code, name] of serviceCategory) if (name === category) grantedCodes.add(code);
  }
  if (grantedCodes.size) clauses.push(`service_code.in.(${[...grantedCodes].join(',')})`);

  // Apply restrictions in PostgreSQL before LIMIT. The final row predicate is
  // still retained by callers as defense in depth, but it must not be the
  // first place a restriction is applied or a page can be incomplete.
  const exclusions=[];
  if(access.restrictedCaseIds.size)exclusions.push(`id=not.in.(${[...access.restrictedCaseIds].join(',')})`);
  if(access.restrictedClientIds.size)exclusions.push(`client_id=not.in.(${[...access.restrictedClientIds].join(',')})`);
  const restrictedCodes=new Set(access.restrictedServiceCodes);
  for(const category of access.restrictedCategories)for(const [code,name] of serviceCategory)if(name===category)restrictedCodes.add(code);
  if(restrictedCodes.size)exclusions.push(`service_code=not.in.(${[...restrictedCodes].join(',')})`);

  // No clause at all means nothing is reachable. Encode that as a filter that
  // matches no row rather than returning null, which would mean "everything".
  if (!globallyPermitted&&!clauses.length) return { matchesNothing: true, query: '' };
  const positive=globallyPermitted?'':`&or=(${clauses.join(',')})`;
  const negative=exclusions.length?`&${exclusions.join('&')}`:'';
  if(!positive&&!negative)return null;
  return { matchesNothing: false, query: positive+negative };
}

export function filterAccessibleCases(access, rows, permission = 'cases.view') {
  if (access.isOwner) return rows;
  return rows.filter(row => canAccessCase(access, row, permission));
}
