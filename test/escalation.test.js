// Adversarial coverage: the attacks the model has to stop, driven through the
// HTTP surface exactly as an attacker would reach them.
//
// Each test names its attack class so a regression is legible from the failure
// output alone. The premise throughout is that the caller is authenticated and
// legitimate for *something* -- these are not "can a stranger get in" tests,
// they are "can a real user reach past their own authorization" tests.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { INTERNAL_KEY, addUser, backend, browserHeaders, cookieHeader, driver, putObject, resetBackend } from './helpers/harness.js';
import { handle, invalidateAccessCache, respondToError } from '../src/server.js';
import { resetAuthProvisioningCache, resetLoginThrottle } from '../src/auth.js';

const request = driver(handle, respondToError);

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const CASE_A = '11111111-1111-4111-8111-111111111111';
const CASE_B = '22222222-2222-4222-8222-222222222221';
const CASE_HUM = '33333333-3333-4333-8333-333333333331';

let owner;
let alice;   // narrowed to her own assigned case
let bob;     // narrowed to a different case
let portal;  // client portal user for CLIENT_A

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

async function setPolicy(ownerCookie, policy) {
  const response = await request({
    method: 'PUT', path: '/api/v1/access/policies',
    headers: browserHeaders({ cookie: ownerCookie }), body: policy,
  });
  assert.equal(response.status, 200, `policy write failed: ${response.raw}`);
  return response.body.data;
}

async function addGrant(ownerCookie, grant) {
  const response = await request({
    method: 'POST', path: '/api/v1/access/record-grants',
    headers: browserHeaders({ cookie: ownerCookie }), body: grant,
  });
  assert.equal(response.status, 201, `grant failed: ${response.raw}`);
  return response.body.data;
}

function seedDocument(caseId, clientId) {
  const id = crypto.randomUUID();
  const key = `cases/${caseId}/${id}-file.pdf`;
  backend.tables.documents.push({
    id, case_id: caseId, client_id: clientId, object_key: key, file_name: 'evidence.pdf',
    content_type: 'application/pdf', size_bytes: 1024, status: 'uploaded', created_at: new Date().toISOString(),
  });
  putObject(key, { size: 1024, contentType: 'application/pdf' });
  return { id, key };
}

beforeEach(() => {
  resetBackend();
  resetLoginThrottle();
  resetAuthProvisioningCache();
  invalidateAccessCache();

  owner = addUser({ email: 'owner@caseflow.test', roles: ['owner'], fullName: 'Owner' });
  alice = addUser({ email: 'alice@caseflow.test', roles: ['case_manager'], fullName: 'Alice' });
  bob = addUser({ email: 'bob@caseflow.test', roles: ['case_manager'], fullName: 'Bob' });
  portal = addUser({ email: 'portal@caseflow.test', roles: ['client_owner'], fullName: 'Portal Client' });

  backend.tables.clients.push(
    { id: CLIENT_A, legal_name: 'Client A' },
    { id: CLIENT_B, legal_name: 'Client B' },
  );
  const base = { status: 'intake', priority: 'normal', created_at: new Date().toISOString() };
  backend.tables.cases.push(
    { id: CASE_A, client_name: 'Client A', client_id: CLIENT_A, case_type: 'Naturalization', service_code: 'N-400', ...base },
    { id: CASE_B, client_name: 'Client B', client_id: CLIENT_B, case_type: 'I-751', service_code: 'I-751', ...base },
    { id: CASE_HUM, client_name: 'Client B', client_id: CLIENT_B, case_type: 'Asylum', service_code: 'ASYLUM', ...base },
  );
  backend.tables.case_assignments.push(
    { case_id: CASE_A, auth_user_id: alice.id, assignment_role: 'lead', active: true },
    { case_id: CASE_B, auth_user_id: bob.id, assignment_role: 'lead', active: true },
  );
  backend.tables.client_access.push({ client_id: CLIENT_A, auth_user_id: portal.id, access_role: 'owner', status: 'active' });
});

// ---------------------------------------------------------------------------
// Horizontal privilege escalation: same role, another user's records
// ---------------------------------------------------------------------------

test('HORIZONTAL: a narrowed staff member cannot reach a peer\'s case by any route', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: alice.id, scopes: { cases: 'assigned', documents: 'assigned' } });
  const aliceCookie = await signIn('alice@caseflow.test');

  // Listing shows only her own.
  const listed = await request({ path: '/api/v1/cases', headers: { cookie: aliceCookie } });
  assert.deepEqual(listed.body.data.map(row => row.id), [CASE_A]);

  // Direct object id.
  assert.equal((await request({ path: `/api/v1/cases/${CASE_B}`, headers: { cookie: aliceCookie } })).status, 404);

  // Write to a peer's case.
  const write = await request({
    method: 'PATCH', path: `/api/v1/cases/${CASE_B}`,
    headers: browserHeaders({ cookie: aliceCookie }), body: { notes: 'tampered' },
  });
  assert.equal(write.status, 404);
  assert.equal(backend.tables.cases.find(row => row.id === CASE_B).notes, undefined, 'no write may land');

  // Filtered listing aimed at the peer's case.
  const filtered = await request({ path: `/api/v1/documents?case_id=${CASE_B}`, headers: { cookie: aliceCookie } });
  assert.deepEqual(filtered.body.data, [], 'a case_id filter cannot widen the result set');
});

test('HORIZONTAL: two narrowed peers each see only their own case', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  for (const subject of [alice.id, bob.id]) {
    await setPolicy(ownerCookie, { subject_type: 'user', subject_id: subject, scopes: { cases: 'assigned' } });
  }
  const aliceCookie = await signIn('alice@caseflow.test');
  const bobCookie = await signIn('bob@caseflow.test');

  const aliceCases = (await request({ path: '/api/v1/cases', headers: { cookie: aliceCookie } })).body.data.map(r => r.id);
  const bobCases = (await request({ path: '/api/v1/cases', headers: { cookie: bobCookie } })).body.data.map(r => r.id);
  assert.deepEqual(aliceCases, [CASE_A]);
  assert.deepEqual(bobCases, [CASE_B]);
  assert.equal(aliceCases.some(id => bobCases.includes(id)), false, 'the two views must not intersect');
});

// ---------------------------------------------------------------------------
// Vertical privilege escalation: reaching a higher permission
// ---------------------------------------------------------------------------

test('VERTICAL: staff cannot reach the authorization surface or grant themselves anything', async () => {
  const aliceCookie = await signIn('alice@caseflow.test');

  assert.equal((await request({ path: '/api/v1/access', headers: { cookie: aliceCookie } })).status, 403);
  assert.equal((await request({ path: `/api/v1/access/effective/${alice.id}`, headers: { cookie: aliceCookie } })).status, 403);

  const selfPolicy = await request({
    method: 'PUT', path: '/api/v1/access/policies',
    headers: browserHeaders({ cookie: aliceCookie }),
    body: { subject_type: 'user', subject_id: alice.id, grants: ['access.manage', 'settings.manage'] },
  });
  assert.equal(selfPolicy.status, 403);
  assert.equal(backend.tables.access_policies.length, 0, 'no policy may be written');

  const selfGrant = await request({
    method: 'POST', path: '/api/v1/access/record-grants',
    headers: browserHeaders({ cookie: aliceCookie }),
    body: { subject_type: 'user', subject_id: alice.id, resource_type: 'case', resource_id: CASE_B, effect: 'grant' },
  });
  assert.equal(selfGrant.status, 403);
  assert.equal(backend.tables.record_access_grants.length, 0);
});

test('VERTICAL: an admin cannot become owner, nor demote or disable the owner', async () => {
  const admin = addUser({ email: 'admin@caseflow.test', roles: ['admin'], fullName: 'Admin' });
  const adminCookie = await signIn('admin@caseflow.test');

  for (const [label, body, target] of [
    ['self-promotion', { roles: ['admin', 'owner'] }, admin.id],
    ['promoting an accomplice', { roles: ['owner'] }, alice.id],
    ['demoting the owner', { roles: ['auditor'] }, owner.id],
    ['disabling the owner', { status: 'inactive' }, owner.id],
  ]) {
    const response = await request({
      method: 'PATCH', path: `/api/v1/users/${target}`,
      headers: browserHeaders({ cookie: adminCookie }), body,
    });
    assert.equal(response.status, 403, `${label} must be refused`);
  }
  assert.deepEqual(backend.users.get('admin@caseflow.test').app_metadata.roles, ['admin']);
  assert.ok(backend.users.get('owner@caseflow.test').app_metadata.roles.includes('owner'));

  const invite = await request({
    method: 'POST', path: '/api/v1/users',
    headers: browserHeaders({ cookie: adminCookie }),
    body: { email: 'newowner@caseflow.test', roles: ['owner'] },
  });
  assert.equal(invite.status, 403, 'inviting a new owner must be refused');
});

test('VERTICAL: delegating access.manage does not delegate ownership', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const admin = addUser({ email: 'admin@caseflow.test', roles: ['admin'], fullName: 'Admin' });
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: admin.id, grants: ['access.manage'] });
  const adminCookie = await signIn('admin@caseflow.test');

  // The delegate really can manage access...
  assert.equal((await request({ path: '/api/v1/access', headers: { cookie: adminCookie } })).status, 200);
  // ...but still cannot mint an owner, and cannot lift the owner-role ceiling.
  const escalate = await request({
    method: 'PATCH', path: `/api/v1/users/${admin.id}`,
    headers: browserHeaders({ cookie: adminCookie }), body: { roles: ['admin', 'owner'] },
  });
  assert.equal(escalate.status, 403);

  const rewriteOwnerRole = await request({
    method: 'PUT', path: '/api/v1/access/policies',
    headers: browserHeaders({ cookie: adminCookie }),
    body: { subject_type: 'role', subject_id: 'owner', restrictions: ['cases.view'] },
  });
  assert.equal(rewriteOwnerRole.status, 400, 'the owner role cannot be rewritten by a delegate');
});

// ---------------------------------------------------------------------------
// Direct document access: knowing an id or a storage key is not authorization
// ---------------------------------------------------------------------------

test('DIRECT DOCUMENT: knowing a document id yields neither metadata nor a signed URL', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const mine = seedDocument(CASE_A, CLIENT_A);
  const theirs = seedDocument(CASE_B, CLIENT_B);
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: alice.id, scopes: { cases: 'assigned', documents: 'assigned' } });
  const aliceCookie = await signIn('alice@caseflow.test');

  const listed = await request({ path: '/api/v1/documents', headers: { cookie: aliceCookie } });
  assert.deepEqual(listed.body.data.map(row => row.id), [mine.id]);

  const url = await request({
    method: 'POST', path: '/api/v1/documents/download-url',
    headers: browserHeaders({ cookie: aliceCookie }), body: { document_id: theirs.id },
  });
  assert.equal(url.status, 404, 'a signed URL is a bearer capability and must be gated');
  assert.equal(url.raw.includes('X-Amz-Signature'), false, 'no signature may leak in the error body');

  for (const [label, response] of [
    ['metadata write', await request({ method: 'PATCH', path: `/api/v1/documents/${theirs.id}`, headers: browserHeaders({ cookie: aliceCookie }), body: { file_name: 'renamed.pdf' } })],
    ['deletion', await request({ method: 'DELETE', path: `/api/v1/documents/${theirs.id}`, headers: browserHeaders({ cookie: aliceCookie }) })],
  ]) {
    assert.equal(response.status, 404, `${label} on another case's document must be refused`);
  }
  assert.equal(backend.tables.documents.find(row => row.id === theirs.id).file_name, 'evidence.pdf');
  assert.equal(backend.tables.documents.find(row => row.id === theirs.id).archived_at, undefined);
});

test('DIRECT DOCUMENT: a raw storage key is not an address a session may use', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const theirs = seedDocument(CASE_B, CLIENT_B);
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: alice.id, scopes: { cases: 'assigned', documents: 'assigned' } });
  const aliceCookie = await signIn('alice@caseflow.test');

  // Lookup by object_key is reserved for the internal key; a session caller
  // must address documents by id, so the key is not a usable side channel.
  const byKey = await request({
    method: 'POST', path: '/api/v1/documents/download-url',
    headers: browserHeaders({ cookie: aliceCookie }), body: { key: theirs.key },
  });
  assert.equal(byKey.status, 400);
  assert.equal(byKey.body.error, 'VALID_DOCUMENT_ID_REQUIRED');
});

test('DIRECT DOCUMENT: uploading into an unreachable case is refused at presign and confirm', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: alice.id, scopes: { cases: 'assigned', documents: 'assigned' } });
  const aliceCookie = await signIn('alice@caseflow.test');
  const payload = { case_id: CASE_B, filename: 'x.pdf', content_type: 'application/pdf', size_bytes: 100 };

  assert.equal((await request({ method: 'POST', path: '/api/v1/documents/presign', headers: browserHeaders({ cookie: aliceCookie }), body: payload })).status, 404);

  // Even holding a well-formed key for that case, confirm re-checks.
  const forged = `cases/${CASE_B}/${crypto.randomUUID()}-x.pdf`;
  putObject(forged, { size: 100, contentType: 'application/pdf' });
  const confirm = await request({
    method: 'POST', path: '/api/v1/documents/confirm',
    headers: browserHeaders({ cookie: aliceCookie }), body: { ...payload, key: forged },
  });
  assert.equal(confirm.status, 404);
  assert.equal(backend.tables.documents.some(row => row.object_key === forged), false, 'no row may be created');
});

// ---------------------------------------------------------------------------
// Cross-client and cross-case access
// ---------------------------------------------------------------------------

test('CROSS-CLIENT: a client-scoped grant reaches that client only', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: alice.id, scopes: { cases: 'explicit_client' } });
  await addGrant(ownerCookie, { subject_type: 'user', subject_id: alice.id, resource_type: 'client', resource_id: CLIENT_B, effect: 'grant' });
  const aliceCookie = await signIn('alice@caseflow.test');

  const ids = (await request({ path: '/api/v1/cases', headers: { cookie: aliceCookie } })).body.data.map(r => r.id).sort();
  assert.deepEqual(ids, [CASE_B, CASE_HUM].sort(), 'both of that client\'s cases and no others');
  assert.equal((await request({ path: `/api/v1/cases/${CASE_A}`, headers: { cookie: aliceCookie } })).status, 404);
});

test('CROSS-CLIENT: a portal user cannot reach another client by id', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: portal.id, grants: ['cases.view', 'documents.view'] });
  const portalCookie = await signIn('portal@caseflow.test');

  const ids = (await request({ path: '/api/v1/cases', headers: { cookie: portalCookie } })).body.data.map(r => r.id);
  assert.deepEqual(ids, [CASE_A], 'client_self stays client_self even when permissions are widened');
  assert.equal((await request({ path: `/api/v1/cases/${CASE_B}`, headers: { cookie: portalCookie } })).status, 404);
  assert.equal((await request({ path: `/api/v1/cases/${CASE_HUM}`, headers: { cookie: portalCookie } })).status, 404);
});

test('CROSS-CASE: a category grant covers its practice area and nothing else', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: alice.id, scopes: { cases: 'explicit_category' } });
  await addGrant(ownerCookie, {
    subject_type: 'user', subject_id: alice.id, resource_type: 'category', resource_key: 'humanitarian_complex', effect: 'grant',
  });
  const aliceCookie = await signIn('alice@caseflow.test');

  const ids = (await request({ path: '/api/v1/cases', headers: { cookie: aliceCookie } })).body.data.map(r => r.id);
  assert.deepEqual(ids, [CASE_HUM], 'only the asylum matter, which is the one humanitarian case');
  assert.equal((await request({ path: `/api/v1/cases/${CASE_A}`, headers: { cookie: aliceCookie } })).status, 404);
  assert.equal((await request({ path: `/api/v1/cases/${CASE_B}`, headers: { cookie: aliceCookie } })).status, 404);
});

test('CROSS-CASE: a category restriction removes that area from an otherwise global user', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await addGrant(ownerCookie, {
    subject_type: 'user', subject_id: alice.id, resource_type: 'category', resource_key: 'humanitarian_complex', effect: 'restrict',
  });
  const aliceCookie = await signIn('alice@caseflow.test');

  const ids = (await request({ path: '/api/v1/cases', headers: { cookie: aliceCookie } })).body.data.map(r => r.id).sort();
  assert.deepEqual(ids, [CASE_A, CASE_B].sort(), 'the humanitarian matter is withheld');
  assert.equal((await request({ path: `/api/v1/cases/${CASE_HUM}`, headers: { cookie: aliceCookie } })).status, 404);
});

test('CROSS-CASE: a grant addressed to someone else does nothing for the caller', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: alice.id, scopes: { cases: 'explicit_case' } });
  await addGrant(ownerCookie, { subject_type: 'user', subject_id: bob.id, resource_type: 'case', resource_id: CASE_B, effect: 'grant' });
  const aliceCookie = await signIn('alice@caseflow.test');

  assert.deepEqual((await request({ path: '/api/v1/cases', headers: { cookie: aliceCookie } })).body.data, []);
  assert.equal((await request({ path: `/api/v1/cases/${CASE_B}`, headers: { cookie: aliceCookie } })).status, 404);
});

// ---------------------------------------------------------------------------
// Revocation must take effect immediately, with no stale authorization
// ---------------------------------------------------------------------------

test('REVOCATION: withdrawing a record grant takes effect on the next request', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: alice.id, scopes: { cases: 'assigned' } });
  const grant = await addGrant(ownerCookie, { subject_type: 'user', subject_id: alice.id, resource_type: 'case', resource_id: CASE_B, effect: 'grant' });
  const aliceCookie = await signIn('alice@caseflow.test');

  assert.ok((await request({ path: '/api/v1/cases', headers: { cookie: aliceCookie } })).body.data.some(r => r.id === CASE_B));
  assert.equal((await request({ path: `/api/v1/cases/${CASE_B}`, headers: { cookie: aliceCookie } })).status, 200);

  const revoked = await request({
    method: 'DELETE', path: `/api/v1/access/record-grants/${grant.id}`,
    headers: browserHeaders({ cookie: ownerCookie }),
  });
  assert.equal(revoked.status, 200);

  // No sign-out, no cache wait: the very next call must already be denied.
  assert.equal((await request({ path: `/api/v1/cases/${CASE_B}`, headers: { cookie: aliceCookie } })).status, 404, 'revocation must not be served from a stale cache');
  assert.deepEqual((await request({ path: '/api/v1/cases', headers: { cookie: aliceCookie } })).body.data.map(r => r.id), [CASE_A]);
});

test('REVOCATION: a fresh restriction applies to an in-flight session immediately', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const aliceCookie = await signIn('alice@caseflow.test');
  assert.equal((await request({ path: '/api/v1/cases', headers: { cookie: aliceCookie } })).body.data.length, 3);

  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: alice.id, scopes: { cases: 'assigned' } });
  assert.deepEqual(
    (await request({ path: '/api/v1/cases', headers: { cookie: aliceCookie } })).body.data.map(r => r.id),
    [CASE_A],
    'the session already open must not keep its wider view',
  );

  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: alice.id, restrictions: ['cases.manage'], scopes: { cases: 'assigned' } });
  const write = await request({
    method: 'PATCH', path: `/api/v1/cases/${CASE_A}`,
    headers: browserHeaders({ cookie: aliceCookie }), body: { notes: 'still allowed?' },
  });
  assert.equal(write.status, 403, 'a permission removed mid-session is removed now');
});

test('REVOCATION: clearing a portal link cuts access on the next request', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await setPolicy(ownerCookie, { subject_type: 'user', subject_id: portal.id, grants: ['cases.view'] });
  const portalCookie = await signIn('portal@caseflow.test');
  assert.deepEqual((await request({ path: '/api/v1/cases', headers: { cookie: portalCookie } })).body.data.map(r => r.id), [CASE_A]);

  const unlink = await request({
    method: 'DELETE', path: `/api/v1/clients/${CLIENT_A}/access/${portal.id}`,
    headers: browserHeaders({ cookie: ownerCookie }),
  });
  assert.equal(unlink.status, 200, unlink.raw);
  assert.deepEqual((await request({ path: '/api/v1/cases', headers: { cookie: portalCookie } })).body.data, [], 'the link is gone, so the access is gone');
});

// ---------------------------------------------------------------------------
// The internal key is a service credential, not a user escalation path
// ---------------------------------------------------------------------------

test('INTERNAL KEY: a forged or truncated key is refused, and a session cannot borrow it', async () => {
  for (const key of ['', 'x'.repeat(INTERNAL_KEY.length), INTERNAL_KEY.slice(0, -1), `${INTERNAL_KEY}x`]) {
    const response = await request({ path: '/api/v1/cases', headers: { 'x-api-key': key } });
    assert.equal(response.status, 401, `key ${JSON.stringify(key)} must be refused`);
  }
  // The real key still works, so the check is not simply denying everything.
  assert.equal((await request({ path: '/api/v1/cases', headers: { 'x-api-key': INTERNAL_KEY } })).status, 200);
});
