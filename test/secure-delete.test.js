// Secure delete, trash and restore.
//
// The three authorities are deliberately separate, so most of what is proved
// here is what a caller CANNOT do: soft delete does not confer permanent
// delete, a wildcard grant confers neither, and neither the Owner nor anyone
// else gets past a legal hold, a retention period, a dependent record, or the
// client boundary.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { addUser, backend, browserHeaders, cookieHeader, driver, resetBackend } from './helpers/harness.js';
import { handle, invalidateAccessCache, respondToError } from '../src/server.js';
import { resetAuthProvisioningCache, resetLoginThrottle } from '../src/auth.js';

const request = driver(handle, respondToError);

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const OTHER_CLIENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const CASE = '11111111-1111-4111-8111-111111111111';
const OTHER_CASE = '22222222-2222-4222-8222-222222222221';
const DOC = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const OTHER_DOC = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const LONE_CASE = '33333333-3333-4333-8333-333333333331';

let owner;
let staff;

async function signIn(email) {
  const response = await request({
    method: 'POST', path: '/api/v1/auth/login',
    headers: browserHeaders(), body: { email, password: 'correct-horse-battery' },
  });
  assert.equal(response.status, 200, `sign-in failed for ${email}: ${response.raw}`);
  return cookieHeader(response.cookies);
}

async function grant(ownerCookie, permissions, subjectId = staff.id) {
  const response = await request({
    method: 'PUT', path: '/api/v1/access/policies',
    headers: browserHeaders({ cookie: ownerCookie }),
    body: { subject_type: 'user', subject_id: subjectId, grants: permissions },
  });
  assert.equal(response.status, 200, response.raw);
}

const del = (cookie, resource_type, resource_id, body = {}) => request({
  method: 'POST', path: '/api/v1/trash/delete',
  headers: browserHeaders({ cookie }), body: { resource_type, resource_id, ...body },
});

beforeEach(() => {
  resetBackend();
  resetLoginThrottle();
  resetAuthProvisioningCache();
  invalidateAccessCache();
  owner = addUser({ email: 'owner@caseflow.test', roles: ['owner'], fullName: 'Owner' });
  staff = addUser({ email: 'staff@caseflow.test', roles: ['admin'], fullName: 'Staff' });

  backend.tables.clients.push(
    { id: CLIENT, client_number: 'AHC-2026-000001', legal_name: 'Amina Yusuf', passport_number: 'AAA111', archived_at: null, created_at: '2020-01-01T00:00:00.000Z' },
    { id: OTHER_CLIENT, client_number: 'AHC-2026-000002', legal_name: 'Other Client', archived_at: null, created_at: '2020-01-01T00:00:00.000Z' },
  );
  const base = { status: 'intake', priority: 'normal', created_at: '2020-01-01T00:00:00.000Z' };
  backend.tables.cases.push(
    { id: CASE, case_number: 'AH-2026-000001', client_name: 'Amina Yusuf', client_id: CLIENT, case_type: 'N-400', service_code: 'N-400', ...base },
    { id: OTHER_CASE, case_number: 'AH-2026-000002', client_name: 'Other Client', client_id: OTHER_CLIENT, case_type: 'I-751', service_code: 'I-751', ...base },
    { id: LONE_CASE, case_number: 'AH-2026-000009', client_name: 'Amina Yusuf', client_id: CLIENT, case_type: 'I-130', service_code: 'I-130', ...base },
  );
  backend.tables.documents.push(
    { id: DOC, case_id: CASE, client_id: CLIENT, object_key: `cases/${CASE}/aaa-passport.png`, file_name: 'passport.png', content_type: 'image/png', category: 'identity', review_status: 'received', status: 'uploaded', version: 1, archived_at: null, created_at: '2020-01-01T00:00:00.000Z' },
    { id: OTHER_DOC, case_id: OTHER_CASE, client_id: OTHER_CLIENT, object_key: `cases/${OTHER_CASE}/bbb-secret.pdf`, file_name: 'other-client-secret.pdf', content_type: 'application/pdf', category: 'evidence', review_status: 'received', status: 'uploaded', version: 1, archived_at: null, created_at: '2020-01-01T00:00:00.000Z' },
  );
});

// --- permission separation -------------------------------------------------

test('no staff role carries a destructive permission by default', async () => {
  const staffCookie = await signIn('staff@caseflow.test');
  const attempt = await del(staffCookie, 'document', DOC);
  assert.equal(attempt.status, 403, 'delete is deny-by-default');
  assert.equal(backend.tables.trash_entries.length, 0);
});

test('a wildcard grant confers no destructive permission', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await grant(ownerCookie, ['*']);
  const staffCookie = await signIn('staff@caseflow.test');

  // The wildcard still confers the ordinary permissions -- it must, or granting
  // it would be a downgrade. What it must never reach is the three destructive
  // authorities, each of which has to be named.
  assert.equal((await request({ path: '/api/v1/clients', headers: { cookie: staffCookie } })).status, 200, 'ordinary access is unchanged');
  assert.equal((await del(staffCookie, 'document', DOC)).status, 403, 'wildcard must not confer delete');
  backend.tables.trash_entries.push({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', resource_type: 'document', resource_facet: 'record', resource_id: DOC, client_id: CLIENT, case_id: CASE, display_name: 'passport.png', deleted_at: new Date().toISOString() });
  assert.equal((await request({ method: 'POST', path: '/api/v1/trash/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1/restore', headers: browserHeaders({ cookie: staffCookie }) })).status, 403, 'nor restore');
  assert.equal((await request({ method: 'POST', path: '/api/v1/trash/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1/purge', headers: browserHeaders({ cookie: staffCookie }), body: { confirm_identifier: 'passport.png' } })).status, 403, 'nor permanent delete');
});

test('soft delete does not confer permanent delete', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await grant(ownerCookie, ['trash.delete', 'trash.view']);
  const staffCookie = await signIn('staff@caseflow.test');

  const deleted = await del(staffCookie, 'document', DOC);
  assert.equal(deleted.status, 201, deleted.raw);
  const entryId = deleted.body.data.id;

  const purge = await request({
    method: 'POST', path: `/api/v1/trash/${entryId}/purge`,
    headers: browserHeaders({ cookie: staffCookie }), body: { confirm_identifier: 'passport.png' },
  });
  assert.equal(purge.status, 403, 'the absolute integrity rule');
  assert.equal(backend.tables.documents.find(d => d.id === DOC).object_key, `cases/${CASE}/aaa-passport.png`);

  const restore = await request({
    method: 'POST', path: `/api/v1/trash/${entryId}/restore`,
    headers: browserHeaders({ cookie: staffCookie }),
  });
  assert.equal(restore.status, 403, 'restore is its own authority too');
});

// --- soft delete lifecycle -------------------------------------------------

test('a soft-deleted record leaves active views and appears in Trash', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');

  const listedBefore = await request({ path: '/api/v1/clients', headers: { cookie: ownerCookie } });
  assert.equal(listedBefore.body.data.length, 2);

  const deleted = await del(ownerCookie, 'client', CLIENT, { reason: 'duplicate record' });
  assert.equal(deleted.status, 201, deleted.raw);

  const listedAfter = await request({ path: '/api/v1/clients', headers: { cookie: ownerCookie } });
  assert.deepEqual(listedAfter.body.data.map(row => row.id), [OTHER_CLIENT], 'gone from the active listing');
  assert.equal((await request({ path: `/api/v1/clients/${CLIENT}`, headers: { cookie: ownerCookie } })).status, 404, 'gone by direct id');

  const search = await request({ path: '/api/v1/search?q=Amina', headers: { cookie: ownerCookie } });
  assert.equal(search.body.data.clients.length, 0, 'gone from search');

  const trash = await request({ path: '/api/v1/trash', headers: { cookie: ownerCookie } });
  assert.equal(trash.body.data.length, 1);
  const entry = trash.body.data[0];
  assert.equal(entry.resource_type, 'client');
  assert.equal(entry.client_number, 'AHC-2026-000001', 'canonical context is captured');
  assert.equal(entry.display_name, 'Amina Yusuf');
  assert.equal(entry.deleted_by_label, 'Owner');
  assert.equal(entry.deleted_reason, 'duplicate record');
  assert.ok(entry.deleted_at, 'deleted at is recorded');
});

test('soft delete writes an immutable audit event and never destroys content', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await del(ownerCookie, 'document', DOC);
  const recorded = backend.tables.audit_events.filter(row => row.action === 'record_soft_deleted');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].metadata.recoverable, true);
  assert.equal(recorded[0].metadata.case_number, 'AH-2026-000001');
  assert.equal(backend.tables.documents.find(d => d.id === DOC).object_key, `cases/${CASE}/aaa-passport.png`, 'the object is untouched');
});

test('restore returns the same canonical identifiers and never mints new ones', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const deleted = await del(ownerCookie, 'case', CASE);
  const entryId = deleted.body.data.id;

  const restored = await request({
    method: 'POST', path: `/api/v1/trash/${entryId}/restore`,
    headers: browserHeaders({ cookie: ownerCookie }),
  });
  assert.equal(restored.status, 200, restored.raw);

  const row = backend.tables.cases.find(item => item.id === CASE);
  assert.equal(row.id, CASE, 'same case id');
  assert.equal(row.case_number, 'AH-2026-000001', 'same case number');
  assert.equal(row.client_id, CLIENT, 'same client linkage');
  assert.equal(row.deleted_at, null);
  assert.equal(backend.tables.cases.filter(item => item.case_number === 'AH-2026-000001').length, 1, 'no replacement row');
  assert.equal((await request({ path: `/api/v1/cases/${CASE}`, headers: { cookie: ownerCookie } })).status, 200, 'back in active views');
});

// --- idempotency and concurrency -------------------------------------------

test('repeated delete, restore and purge are idempotent', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');

  const first = await del(ownerCookie, 'case', LONE_CASE);
  assert.equal(first.status, 201);
  const second = await del(ownerCookie, 'case', LONE_CASE);
  assert.equal(second.status, 200, 'a repeat is not an error');
  assert.equal(second.body.idempotent, true);
  assert.equal(second.body.data.id, first.body.data.id, 'and does not stack Trash rows');
  assert.equal(backend.tables.trash_entries.length, 1);

  const entryId = first.body.data.id;
  assert.equal((await request({ method: 'POST', path: `/api/v1/trash/${entryId}/restore`, headers: browserHeaders({ cookie: ownerCookie }) })).status, 200);
  const again = await request({ method: 'POST', path: `/api/v1/trash/${entryId}/restore`, headers: browserHeaders({ cookie: ownerCookie }) });
  assert.equal(again.status, 200);
  assert.equal(again.body.idempotent, true);
});

test('restore after a permanent delete is refused, not silently reversed', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const deleted = await del(ownerCookie, 'case', LONE_CASE);
  const entryId = deleted.body.data.id;
  const purged = await request({
    method: 'POST', path: `/api/v1/trash/${entryId}/purge`,
    headers: browserHeaders({ cookie: ownerCookie }), body: { confirm_identifier: 'AH-2026-000009' },
  });
  assert.equal(purged.status, 200, purged.raw);

  const restore = await request({ method: 'POST', path: `/api/v1/trash/${entryId}/restore`, headers: browserHeaders({ cookie: ownerCookie }) });
  assert.equal(restore.status, 409);
  assert.match(restore.raw, /ALREADY_PERMANENTLY_DELETED/);
});

// --- integrity gates, which bind the Owner too ------------------------------

test('a legal hold blocks deletion, including for the Owner', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  backend.tables.legal_holds.push({ id: 'ffffffff-ffff-4fff-8fff-fffffffffff1', case_id: CASE, client_id: null, reason: 'EOIR litigation hold', active: true });

  const attempt = await del(ownerCookie, 'document', DOC);
  assert.equal(attempt.status, 409);
  assert.match(attempt.raw, /RESOURCE_UNDER_LEGAL_HOLD/);
  assert.equal(backend.tables.trash_entries.length, 0);
  assert.equal(backend.tables.documents.find(d => d.id === DOC).deleted_at, undefined);
});

test('an unexpired retention policy blocks permanent delete, including for the Owner', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const recent = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9';
  backend.tables.cases.push({ id: recent, case_number: 'AH-2026-000099', client_id: CLIENT, client_name: 'Amina Yusuf', case_type: 'N-400', service_code: 'N-400', status: 'intake', priority: 'normal', created_at: new Date().toISOString() });
  backend.tables.retention_policies.push({ record_type: 'case', retention_days: 3650, action: 'review' });

  const deleted = await del(ownerCookie, 'case', recent);
  assert.equal(deleted.status, 201, 'soft delete is still allowed: nothing is destroyed');

  const purge = await request({
    method: 'POST', path: `/api/v1/trash/${deleted.body.data.id}/purge`,
    headers: browserHeaders({ cookie: ownerCookie }), body: { confirm_identifier: 'AH-2026-000099' },
  });
  assert.equal(purge.status, 409);
  assert.match(purge.raw, /RETENTION_PERIOD_ACTIVE/);
  assert.equal(backend.tables.cases.find(item => item.id === recent).purged_at, undefined);
});

test('dependent records block permanent delete and the reason names them', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const deleted = await del(ownerCookie, 'client', CLIENT);

  const impact = await request({ path: `/api/v1/trash/${deleted.body.data.id}`, headers: { cookie: ownerCookie } });
  assert.equal(impact.status, 200, impact.raw);
  assert.equal(impact.body.data.purgeable, false);
  assert.equal(impact.body.data.blocked_reason, 'CLIENT_HAS_CASES');

  const purge = await request({
    method: 'POST', path: `/api/v1/trash/${deleted.body.data.id}/purge`,
    headers: browserHeaders({ cookie: ownerCookie }), body: { confirm_identifier: 'AHC-2026-000001' },
  });
  assert.equal(purge.status, 409);
  const blockers = purge.body.details.blockers.map(row => row.code);
  assert.ok(blockers.includes('CLIENT_HAS_CASES'), 'the exact verified reason');
  assert.ok(blockers.includes('CLIENT_HAS_DOCUMENTS'));
  assert.equal(backend.tables.clients.find(row => row.id === CLIENT).legal_name, 'Amina Yusuf', 'nothing redacted');
});

test('a soft-deleted dependent still blocks the parent permanent delete', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await del(ownerCookie, 'case', LONE_CASE);
  const clientEntry = await del(ownerCookie, 'client', CLIENT);
  const purge = await request({
    method: 'POST', path: `/api/v1/trash/${clientEntry.body.data.id}/purge`,
    headers: browserHeaders({ cookie: ownerCookie }), body: { confirm_identifier: 'AHC-2026-000001' },
  });
  assert.equal(purge.status, 409, 'the foreign key survives the soft delete, so it still blocks');
  assert.match(purge.raw, /CLIENT_HAS_CASES/);
});

test('permanent delete requires the canonical identifier to be echoed back', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const deleted = await del(ownerCookie, 'case', LONE_CASE);

  const wrong = await request({
    method: 'POST', path: `/api/v1/trash/${deleted.body.data.id}/purge`,
    headers: browserHeaders({ cookie: ownerCookie }), body: { confirm_identifier: 'AH-2026-000001' },
  });
  assert.equal(wrong.status, 400, 'a neighbouring case number must not pass');
  assert.match(wrong.raw, /CONFIRMATION_IDENTIFIER_MISMATCH/);

  const none = await request({
    method: 'POST', path: `/api/v1/trash/${deleted.body.data.id}/purge`,
    headers: browserHeaders({ cookie: ownerCookie }), body: {},
  });
  assert.equal(none.status, 400);
  assert.equal(backend.tables.cases.find(item => item.id === LONE_CASE).purged_at, undefined);
});

test('permanent delete of a case leaves a tombstone and never removes the row', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const deleted = await del(ownerCookie, 'case', LONE_CASE);
  const purged = await request({
    method: 'POST', path: `/api/v1/trash/${deleted.body.data.id}/purge`,
    headers: browserHeaders({ cookie: ownerCookie }), body: { confirm_identifier: 'AH-2026-000009' },
  });
  assert.equal(purged.status, 200, purged.raw);

  const row = backend.tables.cases.find(item => item.id === LONE_CASE);
  assert.ok(row, 'the row survives: the database forbids hard-deleting a case');
  assert.ok(row.purged_at, 'and is marked destroyed');
  assert.equal(row.case_number, 'AH-2026-000009', 'the identifier survives for the audit trail');
  assert.equal(row.client_name, '[permanently deleted]', 'the content does not');

  const recorded = backend.tables.audit_events.filter(item => item.action === 'record_permanently_deleted');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].metadata.recoverable, false);
  assert.equal(recorded[0].metadata.case_number, 'AH-2026-000009');
});

// --- client isolation and R2 ownership -------------------------------------

test('a client-scoped staff member cannot delete another client\'s record', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await grant(ownerCookie, ['trash.delete', 'trash.restore', 'trash.purge', 'trash.view']);
  const narrow = await request({
    method: 'PUT', path: '/api/v1/access/policies',
    headers: browserHeaders({ cookie: ownerCookie }),
    body: { subject_type: 'user', subject_id: staff.id, grants: ['trash.delete', 'trash.restore', 'trash.purge', 'trash.view'], scopes: { cases: 'explicit_client', clients: 'explicit_client', documents: 'explicit_client' } },
  });
  assert.equal(narrow.status, 200, narrow.raw);
  const grantRecord = await request({
    method: 'POST', path: '/api/v1/access/record-grants',
    headers: browserHeaders({ cookie: ownerCookie }),
    body: { subject_type: 'user', subject_id: staff.id, resource_type: 'client', resource_id: CLIENT, effect: 'grant' },
  });
  assert.equal(grantRecord.status, 201, grantRecord.raw);
  const staffCookie = await signIn('staff@caseflow.test');

  const foreign = await del(staffCookie, 'document', OTHER_DOC);
  assert.equal(foreign.status, 404, 'holding the permission is not reaching the record');
  assert.equal(foreign.raw.includes('other-client-secret.pdf'), false, 'no file name may leak');
  assert.equal(backend.tables.trash_entries.length, 0);

  const own = await del(staffCookie, 'document', DOC);
  assert.equal(own.status, 201, 'their own client stays deletable');
});

test('a Trash entry is invisible to someone who could not reach the record', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await del(ownerCookie, 'document', OTHER_DOC);
  await request({
    method: 'PUT', path: '/api/v1/access/policies',
    headers: browserHeaders({ cookie: ownerCookie }),
    body: { subject_type: 'user', subject_id: staff.id, grants: ['trash.view', 'trash.restore'], scopes: { cases: 'explicit_client', clients: 'explicit_client', documents: 'explicit_client' } },
  });
  await request({
    method: 'POST', path: '/api/v1/access/record-grants',
    headers: browserHeaders({ cookie: ownerCookie }),
    body: { subject_type: 'user', subject_id: staff.id, resource_type: 'client', resource_id: CLIENT, effect: 'grant' },
  });
  const staffCookie = await signIn('staff@caseflow.test');

  const trash = await request({ path: '/api/v1/trash', headers: { cookie: staffCookie } });
  assert.equal(trash.status, 200, trash.raw);
  assert.deepEqual(trash.body.data, [], 'Trash is not a way around the client boundary');

  const entryId = backend.tables.trash_entries[0].id;
  const restore = await request({ method: 'POST', path: `/api/v1/trash/${entryId}/restore`, headers: browserHeaders({ cookie: staffCookie }) });
  assert.equal(restore.status, 404, 'nor is restoring by id');
});

test('permanent delete of a document destroys only the server-resolved object', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const deleted = await del(ownerCookie, 'document', DOC);
  const purged = await request({
    method: 'POST', path: `/api/v1/trash/${deleted.body.data.id}/purge`,
    headers: browserHeaders({ cookie: ownerCookie }),
    // A caller-supplied key must have no effect: the key comes off the row.
    body: { confirm_identifier: 'passport.png', object_key: `cases/${OTHER_CASE}/bbb-secret.pdf` },
  });
  assert.equal(purged.status, 200, purged.raw);
  assert.equal(purged.body.object_destroyed, true);

  assert.equal(backend.objects.has(`cases/${OTHER_CASE}/bbb-secret.pdf`), backend.objects.has(`cases/${OTHER_CASE}/bbb-secret.pdf`), 'the other client\'s object is not addressed');
  const row = backend.tables.documents.find(item => item.id === DOC);
  assert.equal(row.object_key, null, 'the destroyed object is unlinked');
  assert.equal(row.purged_at !== undefined && row.purged_at !== null, true);
  const recorded = backend.tables.audit_events.filter(item => item.action === 'record_permanently_deleted');
  assert.equal(recorded[0].metadata.object_destroyed, `cases/${CASE}/aaa-passport.png`, 'the audit names the object actually destroyed');
});

test('a document whose row points outside its case namespace is refused', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  const row = backend.tables.documents.find(item => item.id === DOC);
  row.object_key = `cases/${OTHER_CASE}/bbb-secret.pdf`;
  const deleted = await del(ownerCookie, 'document', DOC);
  const purge = await request({
    method: 'POST', path: `/api/v1/trash/${deleted.body.data.id}/purge`,
    headers: browserHeaders({ cookie: ownerCookie }), body: { confirm_identifier: 'passport.png' },
  });
  assert.equal(purge.status, 409);
  assert.match(purge.raw, /DOCUMENT_OBJECT_OUTSIDE_CASE_NAMESPACE/);
});

// --- filtering -------------------------------------------------------------

test('Trash filters by resource type, client, case, actor and date', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await del(ownerCookie, 'document', DOC);
  await del(ownerCookie, 'case', LONE_CASE);

  const byType = await request({ path: '/api/v1/trash?resource_type=document', headers: { cookie: ownerCookie } });
  assert.deepEqual(byType.body.data.map(row => row.resource_type), ['document']);

  const byFacet = await request({ path: '/api/v1/trash?resource_facet=image', headers: { cookie: ownerCookie } });
  assert.deepEqual(byFacet.body.data.map(row => row.resource_id), [DOC], 'an image is a filterable facet of a document');

  const byCase = await request({ path: `/api/v1/trash?case_id=${CASE}`, headers: { cookie: ownerCookie } });
  assert.deepEqual(byCase.body.data.map(row => row.resource_id), [DOC]);

  const byClient = await request({ path: `/api/v1/trash?client_id=${CLIENT}`, headers: { cookie: ownerCookie } });
  assert.equal(byClient.body.data.length, 2);

  const byActor = await request({ path: `/api/v1/trash?deleted_by=${owner.id}`, headers: { cookie: ownerCookie } });
  assert.equal(byActor.body.data.length, 2);

  const future = await request({ path: '/api/v1/trash?deleted_from=2099-01-01', headers: { cookie: ownerCookie } });
  assert.equal(future.body.data.length, 0, 'the date window is applied');

  assert.equal((await request({ path: '/api/v1/trash?resource_type=nonsense', headers: { cookie: ownerCookie } })).status, 400);
});
