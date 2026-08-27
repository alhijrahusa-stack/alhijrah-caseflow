// Cross-client isolation on the clients resource itself.
//
// The case, document and audit surfaces already resolve the Owner's scope per
// record. The clients endpoints did not: a staff member the Owner had narrowed
// to one client could still read and overwrite any other client's identity
// record -- including date of birth and passport number -- by addressing it
// directly, and could do the same through the identity autofill confirmation.

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { addUser, backend, browserHeaders, cookieHeader, driver, resetBackend } from './helpers/harness.js';
import { handle, invalidateAccessCache, respondToError } from '../src/server.js';
import { resetAuthProvisioningCache, resetLoginThrottle } from '../src/auth.js';

const request = driver(handle, respondToError);

const CLIENT_MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CLIENT_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const CASE_MINE = '11111111-1111-4111-8111-111111111111';
const CASE_OTHER = '22222222-2222-4222-8222-222222222221';

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

async function setPolicy(ownerCookie, policy) {
  const response = await request({
    method: 'PUT', path: '/api/v1/access/policies',
    headers: browserHeaders({ cookie: ownerCookie }), body: policy,
  });
  assert.equal(response.status, 200, response.raw);
}

async function addGrant(ownerCookie, grant) {
  const response = await request({
    method: 'POST', path: '/api/v1/access/record-grants',
    headers: browserHeaders({ cookie: ownerCookie }), body: grant,
  });
  assert.equal(response.status, 201, response.raw);
}

// Narrow the staff member to CLIENT_MINE only, the way an Owner would.
async function narrowToOwnClient(ownerCookie) {
  await setPolicy(ownerCookie, {
    subject_type: 'user', subject_id: staff.id,
    scopes: { cases: 'explicit_client', clients: 'explicit_client', documents: 'explicit_client' },
  });
  await addGrant(ownerCookie, {
    subject_type: 'user', subject_id: staff.id, resource_type: 'client', resource_id: CLIENT_MINE, effect: 'grant',
  });
}

beforeEach(() => {
  resetBackend();
  resetLoginThrottle();
  resetAuthProvisioningCache();
  invalidateAccessCache();
  owner = addUser({ email: 'owner@caseflow.test', roles: ['owner'], fullName: 'Owner' });
  staff = addUser({ email: 'staff@caseflow.test', roles: ['case_manager'], fullName: 'Staff' });

  backend.tables.clients.push(
    { id: CLIENT_MINE, legal_name: 'My Client', date_of_birth: '1990-01-01', passport_number: 'AAA111', archived_at: null },
    { id: CLIENT_OTHER, legal_name: 'Other Client', date_of_birth: '1985-05-05', passport_number: 'BBB222', archived_at: null },
  );
  const base = { status: 'intake', priority: 'normal', created_at: new Date().toISOString() };
  backend.tables.cases.push(
    { id: CASE_MINE, client_name: 'My Client', client_id: CLIENT_MINE, case_type: 'N-400', service_code: 'N-400', ...base },
    { id: CASE_OTHER, client_name: 'Other Client', client_id: CLIENT_OTHER, case_type: 'I-751', service_code: 'I-751', ...base },
  );
});

test('a client-scoped staff member sees only their own client in the listing', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  const listed = await request({ path: '/api/v1/clients', headers: { cookie: staffCookie } });
  assert.equal(listed.status, 200, listed.raw);
  assert.deepEqual(listed.body.data.map(row => row.id), [CLIENT_MINE], 'another client must not appear in the list');
});

test('a client-scoped staff member cannot read another client by id', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  const mine = await request({ path: `/api/v1/clients/${CLIENT_MINE}`, headers: { cookie: staffCookie } });
  assert.equal(mine.status, 200, 'their own client stays reachable');

  const theirs = await request({ path: `/api/v1/clients/${CLIENT_OTHER}`, headers: { cookie: staffCookie } });
  assert.equal(theirs.status, 404, 'another client must not be readable by id');
  assert.equal(theirs.raw.includes('BBB222'), false, 'no passport number may leak');
  assert.equal(theirs.raw.includes('1985-05-05'), false, 'no date of birth may leak');
});

test('a client-scoped staff member cannot overwrite another client', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  const write = await request({
    method: 'PATCH', path: `/api/v1/clients/${CLIENT_OTHER}`,
    headers: browserHeaders({ cookie: staffCookie }),
    body: { legal_name: 'Overwritten', passport_number: 'HACKED' },
  });
  assert.equal(write.status, 404);
  const row = backend.tables.clients.find(client => client.id === CLIENT_OTHER);
  assert.equal(row.legal_name, 'Other Client', 'no write may land');
  assert.equal(row.passport_number, 'BBB222');
});

test('identity autofill cannot be aimed at a client outside the caller\'s scope', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  // A real extraction token, obtained legitimately, must not become a way to
  // write identity fields onto someone else's client record.
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907724' +
    '1d0000000a49444154789c6360000002000100ffff03000006000557bfabd400' +
    '00000049454e44ae426082', 'hex');
  const ocr = await request({
    method: 'POST', path: '/api/v1/identity/ocr',
    headers: browserHeaders({ cookie: staffCookie, 'content-type': 'image/png', 'content-length': String(png.length) }),
    body: png,
  });

  if (ocr.status === 200) {
    const confirm = await request({
      method: 'POST', path: '/api/v1/identity/confirm',
      headers: browserHeaders({ cookie: staffCookie }),
      body: { confirmed: true, extraction_token: ocr.body.extraction_token, client_id: CLIENT_OTHER, fields: { legal_name: 'Overwritten' } },
    });
    assert.equal(confirm.status, 404, 'autofill must obey the same client boundary');
  }
  // Whether or not the stub image yields an extraction, the target row must be
  // untouched: a bare confirm without a valid token must not write either.
  const bare = await request({
    method: 'POST', path: '/api/v1/identity/confirm',
    headers: browserHeaders({ cookie: staffCookie }),
    body: { confirmed: true, extraction_token: 'forged', client_id: CLIENT_OTHER, fields: { legal_name: 'Overwritten' } },
  });
  assert.ok(bare.status >= 400, 'a forged extraction token must be refused');
  assert.equal(backend.tables.clients.find(c => c.id === CLIENT_OTHER).legal_name, 'Other Client');
});

test('an unnarrowed staff member keeps firm-wide client access', async () => {
  // The default must not change: with no Owner policy, clients stay visible.
  const staffCookie = await signIn('staff@caseflow.test');
  const listed = await request({ path: '/api/v1/clients', headers: { cookie: staffCookie } });
  assert.equal(listed.body.data.length, 2, 'no policy means no narrowing');
  assert.equal((await request({ path: `/api/v1/clients/${CLIENT_OTHER}`, headers: { cookie: staffCookie } })).status, 200);
});
