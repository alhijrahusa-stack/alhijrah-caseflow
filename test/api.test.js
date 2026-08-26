// Integration coverage for the API surface. Each test names the defect it
// pins down so a regression is legible from the failure output alone.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { APP_ORIGIN, INTERNAL_KEY, addUser, backend, browserHeaders, cookieHeader, driver, putObject, resetBackend } from './helpers/harness.js';
import { handle, requiredPermission, respondToError } from '../src/server.js';
import { resetAuthProvisioningCache, resetLoginThrottle } from '../src/auth.js';

const request = driver(handle, respondToError);

const CASE_ID = '11111111-1111-4111-8111-111111111111';

async function signIn(email = 'manager@caseflow.test') {
  const response = await request({
    method: 'POST',
    path: '/api/v1/auth/login',
    headers: browserHeaders(),
    body: { email, password: 'correct-horse-battery' },
  });
  assert.equal(response.status, 200, `sign-in failed: ${response.raw}`);
  return cookieHeader(response.cookies);
}

function seedCase(overrides = {}) {
  const record = {
    id: CASE_ID,
    client_name: 'Amina Yusuf',
    case_type: 'Naturalization',
    status: 'intake',
    priority: 'normal',
    created_at: new Date().toISOString(),
    ...overrides,
  };
  backend.tables.cases.push(record);
  return record;
}

beforeEach(() => {
  resetBackend();
  resetLoginThrottle();
  resetAuthProvisioningCache();
  addUser({ email: 'manager@caseflow.test', roles: ['case_manager'], fullName: 'Case Manager' });
  addUser({ email: 'auditor@caseflow.test', roles: ['auditor'], fullName: 'Auditor' });
  addUser({ email: 'billing@caseflow.test', roles: ['billing'], fullName: 'Billing' });
  addUser({ email: 'client@caseflow.test', roles: ['client_owner'], fullName: 'Client' });
});

test('readiness verifies the authorization schema independently of owner provisioning', async () => {
  const response = await request({ path: '/ready' });
  assert.equal(response.status, 503, 'the test tenant has no Owner account');
  assert.equal(response.body.checks.supabase, true);
  assert.equal(response.body.checks.coreSchema, true);
  assert.equal(response.body.checks.authorizationSchema, true);
  assert.deepEqual(response.body.authorizationTables, { teams: true, teamMembers: true, accessPolicies: true, recordAccessGrants: true });
  assert.deepEqual(response.body.authorizationTableErrors, {});
  assert.equal(response.body.checks.ownerAccount, false);
});

// ---------------------------------------------------------------------------
// Authentication and session handling
// ---------------------------------------------------------------------------

test('unauthenticated callers cannot reach any /api resource', async () => {
  for (const path of ['/api/v1/cases', '/api/v1/documents', '/api/v1/audit', '/api/v1/users', '/api/v1/services']) {
    const response = await request({ path });
    assert.equal(response.status, 401, `${path} should require authentication`);
  }
});

test('session cookies are host-locked, HttpOnly, Secure and SameSite=Strict', async () => {
  const response = await request({
    method: 'POST',
    path: '/api/v1/auth/login',
    headers: browserHeaders(),
    body: { email: 'manager@caseflow.test', password: 'correct-horse-battery' },
  });
  assert.equal(response.status, 200);
  const cookies = response.cookies;
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) {
    assert.match(cookie, /^__Host-/, 'cookie must use the __Host- prefix');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Domain=/i, '__Host- cookies must not carry a Domain attribute');
  }
});

test('login response never echoes the access token into the body', async () => {
  const response = await request({
    method: 'POST',
    path: '/api/v1/auth/login',
    headers: browserHeaders(),
    body: { email: 'manager@caseflow.test', password: 'correct-horse-battery' },
  });
  assert.equal(response.raw.includes('access-'), false, 'token must stay in the HttpOnly cookie');
  assert.equal(response.raw.includes('refresh-'), false);
  assert.deepEqual(Object.keys(response.body.user).sort(), ['access', 'display_name', 'email', 'id', 'permissions', 'roles']);
  // Staff default to global scope, so publishing the resolved access does not
  // imply anything has been narrowed.
  assert.equal(response.body.user.access.scopes.cases, 'global');
  assert.equal(response.body.user.access.is_owner, false);
  // Permissions are published so the UI can hide unusable controls; they must
  // describe only the caller's own grant.
  assert.deepEqual(response.body.user.permissions.includes('*'), false);
  assert.ok(response.body.user.permissions.includes('cases.manage'));
});

test('an inactive user cannot obtain a principal even with valid credentials', async () => {
  addUser({ email: 'suspended@caseflow.test', roles: ['admin'], status: 'inactive' });
  const response = await request({
    method: 'POST',
    path: '/api/v1/auth/login',
    headers: browserHeaders(),
    body: { email: 'suspended@caseflow.test', password: 'correct-horse-battery' },
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'USER_INACTIVE');
});

test('owner-by-email bootstrap requires a confirmed address', async () => {
  addUser({ email: 'owner@caseflow.test', roles: [], confirmed: false });
  const unconfirmed = await request({
    method: 'POST',
    path: '/api/v1/auth/login',
    headers: browserHeaders(),
    body: { email: 'owner@caseflow.test', password: 'correct-horse-battery' },
  });
  assert.equal(unconfirmed.status, 403, 'an unconfirmed OWNER_EMAIL must not be granted owner');
  assert.equal(unconfirmed.body.error, 'NO_ASSIGNED_ROLE');

  resetLoginThrottle();
  addUser({ email: 'owner@caseflow.test', roles: [], confirmed: true });
  const confirmed = await request({
    method: 'POST',
    path: '/api/v1/auth/login',
    headers: browserHeaders(),
    body: { email: 'owner@caseflow.test', password: 'correct-horse-battery' },
  });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(confirmed.body.user.roles, ['owner']);
});

test('repeated failed logins are throttled before reaching the auth provider', async () => {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await request({
      method: 'POST',
      path: '/api/v1/auth/login',
      headers: browserHeaders(),
      body: { email: 'manager@caseflow.test', password: 'wrong-password-guess' },
    });
    lastStatus = response.status;
  }
  assert.equal(lastStatus, 429, 'brute force must be rate limited');
  assert.ok(backend.authFailures <= 8, `upstream saw ${backend.authFailures} attempts; throttle should cap them`);
});

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

test('state-changing requests from a foreign origin are rejected', async () => {
  const cookie = await signIn();
  const response = await request({
    method: 'POST',
    path: '/api/v1/cases',
    headers: { origin: 'https://evil.test', 'sec-fetch-site': 'cross-site', cookie },
    body: { client_name: 'Injected', case_type: 'Naturalization' },
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'CROSS_SITE_REQUEST_BLOCKED');
});

test('an opaque "null" Origin is refused, not treated as a server error', async () => {
  const cookie = await signIn();
  const response = await request({
    method: 'POST',
    path: '/api/v1/cases',
    headers: { origin: 'null', cookie },
    body: { client_name: 'Sandboxed', case_type: 'Naturalization' },
  });
  assert.equal(response.status, 403, 'a malformed Origin previously threw an uncaught TypeError (HTTP 500)');
  assert.equal(response.body.error, 'CROSS_SITE_REQUEST_BLOCKED');
});

test('a cookie-authenticated write with no origin signal at all is refused', async () => {
  const cookie = await signIn();
  const response = await request({
    method: 'POST',
    path: '/api/v1/cases',
    headers: { cookie, 'content-type': 'application/json' },
    body: { client_name: 'Stripped', case_type: 'Naturalization' },
  });
  assert.equal(response.status, 403, 'the CSRF gate must fail closed when Origin and Sec-Fetch-Site are both absent');
});

test('the expected origin is pinned to APP_BASE_URL, not the client Host header', async () => {
  const cookie = await signIn();
  const response = await request({
    method: 'POST',
    path: '/api/v1/cases',
    headers: { origin: 'https://attacker.test', host: 'attacker.test', 'x-forwarded-proto': 'https', cookie },
    body: { client_name: 'Host spoof', case_type: 'Naturalization' },
  });
  assert.equal(response.status, 403);
});

test('internal API-key callers bypass the CSRF gate but still authenticate', async () => {
  seedCase();
  const authorized = await request({ path: '/api/v1/cases', headers: { 'x-api-key': INTERNAL_KEY } });
  assert.equal(authorized.status, 200);

  const wrongKey = await request({ path: '/api/v1/cases', headers: { 'x-api-key': 'x'.repeat(INTERNAL_KEY.length) } });
  assert.equal(wrongKey.status, 401);

  const shortKey = await request({ path: '/api/v1/cases', headers: { 'x-api-key': 'short' } });
  assert.equal(shortKey.status, 401);
});

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

test('unmapped /api routes deny by default instead of inheriting dashboard.view', () => {
  assert.equal(requiredPermission({ method: 'GET' }, '/api/v1/cases'), 'cases.view');
  assert.equal(requiredPermission({ method: 'POST' }, '/api/v1/cases'), 'cases.manage');
  assert.equal(requiredPermission({ method: 'GET' }, '/api/v1/exports'), null, 'a route family added later must not auto-authorize');
  assert.equal(requiredPermission({ method: 'GET' }, '/api/v1/anything'), null);
  assert.equal(requiredPermission({ method: 'GET' }, '/api/v1/billing/invoices'), 'billing.view');
  assert.equal(requiredPermission({ method: 'GET' }, '/api/v1/internal/metrics'), null);
  // Access management is owner-only by default.
  assert.equal(requiredPermission({ method: 'GET' }, '/api/v1/access'), 'access.manage');
});

test('each role is confined to the resources its permissions cover', async () => {
  seedCase();
  const auditor = await signIn('auditor@caseflow.test');
  assert.equal((await request({ path: '/api/v1/cases', headers: { cookie: auditor } })).status, 200);
  assert.equal((await request({ path: '/api/v1/audit', headers: { cookie: auditor } })).status, 200);
  assert.equal((await request({ path: '/api/v1/users', headers: { cookie: auditor } })).status, 403);
  const auditorWrite = await request({
    method: 'POST',
    path: '/api/v1/cases',
    headers: browserHeaders({ cookie: auditor }),
    body: { client_name: 'Auditor write', case_type: 'Naturalization' },
  });
  assert.equal(auditorWrite.status, 403, 'auditor is read-only');

  const billing = await signIn('billing@caseflow.test');
  assert.equal((await request({ path: '/api/v1/documents', headers: { cookie: billing } })).status, 403);
  assert.equal((await request({ path: '/api/v1/audit', headers: { cookie: billing } })).status, 403);
});

test('client portal roles hold no staff-workspace access', async () => {
  const client = await signIn('client@caseflow.test');
  for (const path of ['/api/v1/cases', '/api/v1/documents', '/api/v1/audit', '/api/v1/users']) {
    assert.equal((await request({ path, headers: { cookie: client } })).status, 403, `${path} must be closed to portal roles`);
  }
});

test('a non-admin cannot invite users or escalate roles', async () => {
  const cookie = await signIn();
  const invite = await request({
    method: 'POST',
    path: '/api/v1/users',
    headers: browserHeaders({ cookie }),
    body: { email: 'new@caseflow.test', roles: ['owner'] },
  });
  assert.equal(invite.status, 403);

  const escalate = await request({
    method: 'PATCH',
    path: `/api/v1/users/${crypto.randomUUID()}`,
    headers: browserHeaders({ cookie }),
    body: { roles: ['owner'] },
  });
  assert.equal(escalate.status, 403);
});

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

test('a PATCH that matches no case reports 404 rather than a phantom success', async () => {
  const cookie = await signIn();
  const response = await request({
    method: 'PATCH',
    path: `/api/v1/cases/${crypto.randomUUID()}`,
    headers: browserHeaders({ cookie }),
    body: { status: 'filed' },
  });
  assert.equal(response.status, 404);
  assert.equal(backend.tables.case_events.filter(row => row.event_type === 'case_updated').length, 0, 'no audit event may be written for a case that does not exist');
});

// ---------------------------------------------------------------------------
// Error disclosure
// ---------------------------------------------------------------------------

test('database error payloads never reach the client', async () => {
  const cookie = await signIn();
  seedCase();
  const key = `cases/${CASE_ID}/${crypto.randomUUID()}-file.pdf`;
  putObject(key, { size: 1024, contentType: 'application/pdf' });
  const body = { case_id: CASE_ID, key, file_name: 'file.pdf', content_type: 'application/pdf', size_bytes: 1024 };

  const first = await request({ method: 'POST', path: '/api/v1/documents/confirm', headers: browserHeaders({ cookie }), body });
  assert.equal(first.status, 201);

  // Confirming the same object twice trips the unique index on object_key, so
  // PostgREST answers 4xx with a payload naming the constraint. That payload
  // was previously forwarded to the caller verbatim.
  const duplicate = await request({ method: 'POST', path: '/api/v1/documents/confirm', headers: browserHeaders({ cookie }), body });
  assert.ok(duplicate.status >= 400, `expected a failure, got ${duplicate.status}`);
  assert.equal(duplicate.body.error, 'DATABASE_REQUEST_FAILED');
  assert.equal('details' in duplicate.body, false, 'upstream error payloads must not be forwarded');
  assert.equal(duplicate.raw.includes('constraint'), false);
  assert.equal(duplicate.raw.includes('documents_object_key_key'), false);
  assert.equal(duplicate.raw.includes('23505'), false);
});

test('malformed identifiers are rejected locally instead of at the database', async () => {
  const cookie = await signIn();
  const notAUuid = '-'.repeat(36);
  const response = await request({ path: `/api/v1/cases/${notAUuid}`, headers: { cookie } });
  assert.equal(response.status, 404, 'a malformed id resolves to no record');
  assert.equal(response.raw.includes('details'), false, 'and never surfaces an upstream parse error');

  const badFilter = await request({ path: '/api/v1/documents?case_id=not-a-uuid', headers: { cookie } });
  assert.equal(badFilter.status, 400);
  assert.equal(badFilter.body.error, 'VALID_CASE_ID_REQUIRED');
});

test('unhandled server faults return a generic error body', async () => {
  const res = { headers: {}, setHeader() {}, getHeader: () => 'req-1', writeHead(status, headers) { this.status = status; this.headers = headers; return this; }, end(chunk) { this.body = chunk; } };
  respondToError({ headers: {} }, res, Object.assign(new Error('SUPABASE_TIMEOUT_AT_10.0.0.5'), { status: 500, internalDetails: { secret: 'connection string' } }));
  assert.equal(res.status, 500);
  assert.equal(JSON.parse(res.body).error, 'INTERNAL_ERROR');
  assert.equal(res.body.includes('10.0.0.5'), false);
  assert.equal(res.body.includes('connection string'), false);
});

// ---------------------------------------------------------------------------
// Documents and R2
// ---------------------------------------------------------------------------

test('presign refuses unsupported types, oversized files and unknown cases', async () => {
  const cookie = await signIn();
  seedCase();
  const base = { case_id: CASE_ID, filename: 'evidence.pdf', content_type: 'application/pdf', size_bytes: 1024 };

  assert.equal((await request({ method: 'POST', path: '/api/v1/documents/presign', headers: browserHeaders({ cookie }), body: { ...base, content_type: 'application/x-msdownload' } })).status, 415);
  assert.equal((await request({ method: 'POST', path: '/api/v1/documents/presign', headers: browserHeaders({ cookie }), body: { ...base, size_bytes: 40 * 1024 * 1024 } })).status, 413);
  assert.equal((await request({ method: 'POST', path: '/api/v1/documents/presign', headers: browserHeaders({ cookie }), body: { ...base, case_id: crypto.randomUUID() } })).status, 404);

  const ok = await request({ method: 'POST', path: '/api/v1/documents/presign', headers: browserHeaders({ cookie }), body: base });
  assert.equal(ok.status, 200);
  assert.match(ok.body.key, new RegExp(`^cases/${CASE_ID}/`), 'objects must be namespaced under their case');
  assert.equal(ok.body.key.includes('..'), false);
  assert.ok(ok.body.upload_url.includes('X-Amz-Signature'), 'a signed URL is returned');
  assert.ok(ok.body.expires_in <= 900);
});

test('a presigned key cannot be redirected onto another case', async () => {
  const cookie = await signIn();
  seedCase();
  const otherCase = crypto.randomUUID();
  backend.tables.cases.push({ id: otherCase, client_name: 'Other', case_type: 'I-751', status: 'intake', priority: 'normal', created_at: new Date().toISOString() });

  const response = await request({
    method: 'POST',
    path: '/api/v1/documents/confirm',
    headers: browserHeaders({ cookie }),
    body: { case_id: otherCase, key: `cases/${CASE_ID}/abc-file.pdf`, file_name: 'file.pdf', content_type: 'application/pdf', size_bytes: 10 },
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'DOCUMENT_CASE_MISMATCH');
});

test('confirm rejects an object whose stored bytes differ from the declared upload', async () => {
  const cookie = await signIn();
  seedCase();
  const key = `cases/${CASE_ID}/${crypto.randomUUID()}-file.pdf`;
  putObject(key, { size: 999999, contentType: 'application/pdf' });

  const response = await request({
    method: 'POST',
    path: '/api/v1/documents/confirm',
    headers: browserHeaders({ cookie }),
    body: { case_id: CASE_ID, key, file_name: 'file.pdf', content_type: 'application/pdf', size_bytes: 1024 },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'UPLOADED_OBJECT_MISMATCH');
});

test('deleting a document removes the object but preserves the record and its trail', async () => {
  const cookie = await signIn();
  seedCase();
  const key = `cases/${CASE_ID}/${crypto.randomUUID()}-file.pdf`;
  putObject(key, { size: 1024, contentType: 'application/pdf' });
  const confirmed = await request({
    method: 'POST',
    path: '/api/v1/documents/confirm',
    headers: browserHeaders({ cookie }),
    body: { case_id: CASE_ID, key, file_name: 'file.pdf', content_type: 'application/pdf', size_bytes: 1024 },
  });
  assert.equal(confirmed.status, 201);
  const documentId = confirmed.body.data[0].id;

  const deleted = await request({ method: 'DELETE', path: `/api/v1/documents/${documentId}`, headers: browserHeaders({ cookie }) });
  assert.equal(deleted.status, 200);

  const row = backend.tables.documents.find(entry => entry.id === documentId);
  assert.ok(row, 'the document row must survive as evidence that the file existed');
  assert.ok(row.archived_at, 'deletion is a soft delete that retains the record');
  assert.ok(backend.tables.case_events.some(entry => entry.event_type === 'document_archived'));

  const listed = await request({ path: '/api/v1/documents', headers: { cookie } });
  assert.equal(listed.body.data.some(entry => entry.id === documentId), false, 'archived documents are hidden from the workspace');

  assert.equal(deleted.body.recoverable, true, 'the record is recoverable, the object is not');
});

test('download URLs are short-lived, attachment-dispositioned and audited', async () => {
  const cookie = await signIn();
  seedCase();
  const key = `cases/${CASE_ID}/${crypto.randomUUID()}-file.pdf`;
  putObject(key, { size: 1024, contentType: 'application/pdf' });
  const confirmed = await request({
    method: 'POST',
    path: '/api/v1/documents/confirm',
    headers: browserHeaders({ cookie }),
    body: { case_id: CASE_ID, key, file_name: 'file.pdf', content_type: 'application/pdf', size_bytes: 1024 },
  });

  const download = await request({
    method: 'POST',
    path: '/api/v1/documents/download-url',
    headers: browserHeaders({ cookie }),
    body: { document_id: confirmed.body.data[0].id },
  });
  assert.equal(download.status, 200);
  assert.ok(download.body.expires_in <= 300);
  assert.ok(download.body.download_url.includes('response-content-disposition=attachment'));
  assert.ok(backend.tables.case_events.some(entry => entry.event_type === 'document_downloaded'));
});

test('object-key lookup by raw key stays restricted to internal callers', async () => {
  const cookie = await signIn();
  seedCase();
  const response = await request({
    method: 'POST',
    path: '/api/v1/documents/download-url',
    headers: browserHeaders({ cookie }),
    body: { key: `cases/${CASE_ID}/anything.pdf` },
  });
  assert.equal(response.status, 400, 'session callers must address documents by id, not by storage key');
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

test('security-relevant actions are recorded with actor and request context', async () => {
  const cookie = await signIn();
  const login = backend.tables.audit_events.find(entry => entry.action === 'login');
  assert.ok(login, 'sign-in must be audited');
  assert.ok(login.actor_user_id);
  assert.ok(login.metadata.ip);
  assert.ok(login.metadata.request_id);

  await request({
    method: 'POST',
    path: '/api/v1/cases',
    headers: browserHeaders({ cookie }),
    body: { client_name: 'Audited', case_type: 'Naturalization' },
  });
  const created = backend.tables.case_events.find(entry => entry.event_type === 'case_created');
  assert.ok(created);
  assert.ok(created.actor_user_id, 'case events must carry a resolvable actor id, not only a display name');
});

// ---------------------------------------------------------------------------
// Transport hardening
// ---------------------------------------------------------------------------

test('every response carries the security header set', async () => {
  const response = await request({ path: '/health' });
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.headers['strict-transport-security'], /max-age=31536000/);
  assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(response.headers['content-security-policy'], /object-src 'none'/);
});

test('the policy refuses inline script outright', async () => {
  const response = await request({ path: '/health' });
  const csp = response.headers['content-security-policy'];
  const scriptSrc = csp.split(';').map(part => part.trim()).find(part => part.startsWith('script-src'));
  assert.equal(scriptSrc, "script-src 'self'", 'script-src must not allow inline or eval');
  assert.equal(csp.includes('unsafe-eval'), false);
});

test('the workspace script is served as an external asset', async () => {
  const response = await request({ path: '/app.js' });
  assert.equal(response.status, 200);
  assert.match(String(response.headers['content-type']), /text\/javascript/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.ok(response.raw.includes('uiActions'), 'the dispatch table ships with it');
});

test('the served page carries no inline script or inline event handlers', async () => {
  const page = await request({ path: '/' });
  assert.equal(page.status, 200);
  // An inline <script> or an on*= attribute would each need the very CSP
  // relaxation this change removes, so the page must contain neither.
  assert.equal(/<script(?![^>]*\bsrc=)/.test(page.raw), false, 'no inline <script> block');
  assert.equal(/\son(click|input|change|load|error|submit)\s*=/i.test(page.raw), false, 'no inline event handlers');
  assert.ok(page.raw.includes('src="/app.js"'));
});

test('an unknown UI action name resolves to nothing', async () => {
  const script = (await request({ path: '/app.js' })).raw;
  // The dispatcher must look the name up in a frozen table, never on window
  // and never through eval, so an attacker-supplied data-act does nothing.
  assert.ok(script.includes('const uiActions = Object.freeze({'));
  assert.ok(script.includes('const handler = uiActions[element.dataset.act];'));
  assert.ok(script.includes('if (!handler) return;'));
  assert.equal(/\beval\s*\(/.test(script), false, 'no eval in the workspace script');
  assert.equal(/new Function\s*\(/.test(script), false, 'no Function constructor');
});

test('CORS reflects only allowlisted origins and never a wildcard', async () => {
  const allowed = await request({ path: '/health', headers: { origin: APP_ORIGIN } });
  assert.equal(allowed.headers['access-control-allow-origin'], APP_ORIGIN);
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
  assert.equal(allowed.headers.vary, 'Origin');

  const foreign = await request({ path: '/health', headers: { origin: 'https://evil.test' } });
  assert.equal(foreign.headers['access-control-allow-origin'], undefined);
});

test('unauthenticated status probes do not leak tenant size or hammer the admin API', async () => {
  const response = await request({ path: '/api/v1/auth/status' });
  assert.equal(response.status, 200);
  assert.equal('userCount' in response.body, false, 'tenant user count is operational data');

  const before = backend.adminProbes;
  for (let i = 0; i < 25; i += 1) await request({ path: '/api/v1/auth/status' });
  assert.ok(backend.adminProbes - before <= 1, `anonymous traffic drove ${backend.adminProbes - before} privileged admin calls`);
});

test('oversized request bodies are refused before parsing', async () => {
  const cookie = await signIn();
  const response = await request({
    method: 'POST',
    path: '/api/v1/auth/login',
    headers: browserHeaders({ cookie }),
    body: 'x'.repeat(20_000),
  });
  assert.equal(response.status, 413);
});
