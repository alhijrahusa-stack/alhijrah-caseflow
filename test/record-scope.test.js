// Client-scoped records on the write path.
//
// Alerts and invoices exist in two shapes: attached to a case, or attached
// only to a client (passport-expiry alerts, retainer invoices). The read paths
// gate both shapes -- case_id through canAccessCase, client_id through
// canAccessClient. The mutating paths only ever tested case_id, so a staff
// member the Owner had narrowed to one client could still reach every other
// client's client-level alert and invoice by addressing it directly.
//
// The document review decision had the same shape: every other /documents route
// resolves the record through canAccessDocument, but POST /documents/:id/review
// patched the row straight from the URL id.
//
// The /clients/:id sub-resources were the third instance: the parent route
// resolves the client, but /people and /access read and wrote straight from the
// URL id -- including granting and revoking portal access on any client.

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
const DOC_OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const ALERT_OTHER = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const INVOICE_OTHER = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

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

async function narrowToOwnClient(ownerCookie) {
  const policy = await request({
    method: 'PUT', path: '/api/v1/access/policies',
    headers: browserHeaders({ cookie: ownerCookie }),
    body: {
      subject_type: 'user', subject_id: staff.id,
      scopes: { cases: 'explicit_client', clients: 'explicit_client', documents: 'explicit_client', billing: 'explicit_client', tasks: 'explicit_client' },
    },
  });
  assert.equal(policy.status, 200, policy.raw);
  const grant = await request({
    method: 'POST', path: '/api/v1/access/record-grants',
    headers: browserHeaders({ cookie: ownerCookie }),
    body: { subject_type: 'user', subject_id: staff.id, resource_type: 'client', resource_id: CLIENT_MINE, effect: 'grant' },
  });
  assert.equal(grant.status, 201, grant.raw);
}

beforeEach(() => {
  resetBackend();
  resetLoginThrottle();
  resetAuthProvisioningCache();
  invalidateAccessCache();
  owner = addUser({ email: 'owner@caseflow.test', roles: ['owner'], fullName: 'Owner' });
  staff = addUser({ email: 'staff@caseflow.test', roles: ['admin'], fullName: 'Staff' });

  backend.tables.clients.push(
    { id: CLIENT_MINE, legal_name: 'My Client', archived_at: null },
    { id: CLIENT_OTHER, legal_name: 'Other Client', passport_number: 'BBB222', archived_at: null },
  );
  const caseBase = { status: 'intake', priority: 'normal', created_at: new Date().toISOString() };
  backend.tables.cases.push(
    { id: CASE_MINE, client_name: 'My Client', client_id: CLIENT_MINE, case_type: 'N-400', service_code: 'N-400', ...caseBase },
    { id: CASE_OTHER, client_name: 'Other Client', client_id: CLIENT_OTHER, case_type: 'I-751', service_code: 'I-751', ...caseBase },
  );
  backend.tables.documents.push({
    id: DOC_OTHER, case_id: CASE_OTHER, client_id: CLIENT_OTHER, object_key: 'cases/other/passport.png',
    file_name: 'other-client-passport.png', content_type: 'image/png', category: 'identity',
    review_status: 'received', status: 'uploaded', version: 1, archived_at: null,
    created_at: new Date().toISOString(),
  });
  backend.tables.alerts.push({
    id: ALERT_OTHER, client_id: CLIENT_OTHER, case_id: null, alert_type: 'passport_expiration',
    severity: 'high', title: 'Passport expiration — Other Client', status: 'open',
    source_type: 'client_passport', source_id: CLIENT_OTHER, created_at: new Date().toISOString(),
  });
  backend.tables.invoices.push({
    id: INVOICE_OTHER, invoice_number: 'INV-2026-OTHER', client_id: CLIENT_OTHER, case_id: null,
    currency: 'USD', status: 'draft', office_fee_cents: 250_000, government_fee_cents: 0,
    other_fee_cents: 0, created_at: new Date().toISOString(),
  });
});

test('a client-scoped staff member cannot see another client\'s client-level alert', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  const listed = await request({ path: '/api/v1/alerts', headers: { cookie: staffCookie } });
  assert.equal(listed.status, 200, listed.raw);
  assert.deepEqual(listed.body.data.map(row => row.id), [], 'the read path already gates client-level alerts');
});

test('a client-scoped staff member cannot mutate another client\'s client-level alert', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  const write = await request({
    method: 'PATCH', path: `/api/v1/alerts/${ALERT_OTHER}`,
    headers: browserHeaders({ cookie: staffCookie }), body: { status: 'dismissed' },
  });
  assert.equal(write.status, 404, 'a client-level alert outside scope must not be reachable');
  assert.equal(write.raw.includes('Other Client'), false, 'no client name may leak back');
  assert.equal(backend.tables.alerts.find(row => row.id === ALERT_OTHER).status, 'open', 'no write may land');
});

test('a client-scoped staff member cannot see another client\'s client-level invoice', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  const listed = await request({ path: '/api/v1/billing/invoices', headers: { cookie: staffCookie } });
  assert.equal(listed.status, 200, listed.raw);
  assert.deepEqual(listed.body.data.map(row => row.id), [], 'the read path already gates client-level invoices');
});

test('a client-scoped staff member cannot mutate another client\'s client-level invoice', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  const write = await request({
    method: 'PATCH', path: `/api/v1/billing/invoices/${INVOICE_OTHER}`,
    headers: browserHeaders({ cookie: staffCookie }), body: { status: 'void' },
  });
  assert.equal(write.status, 404, 'a client-level invoice outside scope must not be reachable');
  assert.equal(write.raw.includes('INV-2026-OTHER'), false, 'no invoice number may leak back');
  assert.equal(backend.tables.invoices.find(row => row.id === INVOICE_OTHER).status, 'draft', 'no write may land');
});

test('a client-scoped staff member cannot record a payment against another client\'s invoice', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  const paid = await request({
    method: 'POST', path: '/api/v1/billing/payments',
    headers: browserHeaders({ cookie: staffCookie }),
    body: { invoice_id: INVOICE_OTHER, amount_cents: 1000, method: 'cash' },
  });
  assert.equal(paid.status, 404, 'a payment must obey the same client boundary');
  assert.equal(backend.tables.payments.length, 0, 'no payment row may be created');
});

test('an unnarrowed staff member keeps firm-wide alert and billing access', async () => {
  // The default must not change: with no Owner policy, both stay reachable.
  const staffCookie = await signIn('staff@caseflow.test');
  assert.equal((await request({ path: '/api/v1/alerts', headers: { cookie: staffCookie } })).body.data.length, 1);
  assert.equal((await request({ path: '/api/v1/billing/invoices', headers: { cookie: staffCookie } })).body.data.length, 1);
  const write = await request({
    method: 'PATCH', path: `/api/v1/alerts/${ALERT_OTHER}`,
    headers: browserHeaders({ cookie: staffCookie }), body: { status: 'acknowledged' },
  });
  assert.equal(write.status, 200, 'no policy means no narrowing');
});

test('a client-scoped reviewer cannot decide review on another client\'s document', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  const decided = await request({
    method: 'POST', path: `/api/v1/documents/${DOC_OTHER}/review`,
    headers: browserHeaders({ cookie: staffCookie }),
    body: { status: 'approved', reviewer_notes: 'signed off' },
  });
  assert.equal(decided.status, 404, 'a review decision must obey the document boundary');
  assert.equal(decided.raw.includes('other-client-passport.png'), false, 'no file name may leak back');
  assert.equal(decided.raw.includes('cases/other/passport.png'), false, 'no object key may leak back');
  const row = backend.tables.documents.find(item => item.id === DOC_OTHER);
  assert.equal(row.review_status, 'received', 'no review decision may land');
  assert.equal(row.reviewed_by, undefined, 'no reviewer may be recorded');
});

test('a client-scoped reviewer keeps review on documents inside their scope', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  const mine = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
  backend.tables.documents.push({
    id: mine, case_id: CASE_MINE, client_id: CLIENT_MINE, object_key: 'cases/mine/passport.png',
    file_name: 'my-passport.png', content_type: 'image/png', category: 'identity',
    review_status: 'received', status: 'uploaded', version: 1, archived_at: null,
    created_at: new Date().toISOString(),
  });
  const decided = await request({
    method: 'POST', path: `/api/v1/documents/${mine}/review`,
    headers: browserHeaders({ cookie: staffCookie }), body: { status: 'approved' },
  });
  assert.equal(decided.status, 200, decided.raw);
  assert.equal(backend.tables.documents.find(item => item.id === mine).review_status, 'approved');
});

test('an unnarrowed reviewer keeps firm-wide document review', async () => {
  const staffCookie = await signIn('staff@caseflow.test');
  const decided = await request({
    method: 'POST', path: `/api/v1/documents/${DOC_OTHER}/review`,
    headers: browserHeaders({ cookie: staffCookie }), body: { status: 'approved' },
  });
  assert.equal(decided.status, 200, 'no policy means no narrowing');
});

test('a client-scoped staff member cannot read another client\'s family members', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  backend.tables.people.push({ id: 'ffffffff-ffff-4fff-8fff-fffffffffff1', legal_name: 'Other Relative', date_of_birth: '1970-02-02', a_number: 'A099887766' });
  backend.tables.client_people.push({ client_id: CLIENT_OTHER, person_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1', relationship: 'spouse', is_primary: true, created_at: new Date().toISOString() });
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  const read = await request({ path: `/api/v1/clients/${CLIENT_OTHER}/people`, headers: { cookie: staffCookie } });
  assert.equal(read.status, 404, 'family members follow the client boundary');
  assert.equal(read.raw.includes('Other Relative'), false, 'no relative name may leak');
  assert.equal(read.raw.includes('A099887766'), false, 'no A-number may leak');
});

test('a client-scoped staff member cannot attach a person to another client', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  const write = await request({
    method: 'POST', path: `/api/v1/clients/${CLIENT_OTHER}/people`,
    headers: browserHeaders({ cookie: staffCookie }),
    body: { legal_name: 'Injected Person', relationship: 'spouse' },
  });
  assert.equal(write.status, 404);
  assert.equal(backend.tables.client_people.some(row => String(row.client_id) === CLIENT_OTHER), false, 'no link may land');
});

test('a client-scoped staff member cannot grant portal access on another client', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  // Granting themselves client_access on a client they cannot reach would widen
  // their own effective access, so this is escalation, not just a stray write.
  const granted = await request({
    method: 'POST', path: `/api/v1/clients/${CLIENT_OTHER}/access`,
    headers: browserHeaders({ cookie: staffCookie }),
    body: { auth_user_id: staff.id, access_role: 'owner' },
  });
  assert.equal(granted.status, 404, 'portal access follows the client boundary');
  assert.equal(backend.tables.client_access.some(row => String(row.client_id) === CLIENT_OTHER), false, 'no grant may land');
});

test('a client-scoped staff member cannot read or revoke another client\'s portal access', async () => {
  const ownerCookie = await signIn('owner@caseflow.test');
  backend.tables.client_access.push({ client_id: CLIENT_OTHER, auth_user_id: owner.id, access_role: 'owner', status: 'active', granted_at: new Date().toISOString(), revoked_at: null });
  await narrowToOwnClient(ownerCookie);
  const staffCookie = await signIn('staff@caseflow.test');

  const read = await request({ path: `/api/v1/clients/${CLIENT_OTHER}/access`, headers: { cookie: staffCookie } });
  assert.equal(read.status, 404, 'the portal roster follows the client boundary');

  const revoked = await request({
    method: 'DELETE', path: `/api/v1/clients/${CLIENT_OTHER}/access/${owner.id}`,
    headers: browserHeaders({ cookie: staffCookie }),
  });
  assert.equal(revoked.status, 404, 'revocation follows the client boundary');
  assert.equal(backend.tables.client_access.find(row => String(row.client_id) === CLIENT_OTHER).status, 'active', 'no revocation may land');
});

test('an unnarrowed staff member keeps firm-wide client sub-resource access', async () => {
  const staffCookie = await signIn('staff@caseflow.test');
  assert.equal((await request({ path: `/api/v1/clients/${CLIENT_OTHER}/people`, headers: { cookie: staffCookie } })).status, 200);
  assert.equal((await request({ path: `/api/v1/clients/${CLIENT_OTHER}/access`, headers: { cookie: staffCookie } })).status, 200);
  const write = await request({
    method: 'POST', path: `/api/v1/clients/${CLIENT_OTHER}/people`,
    headers: browserHeaders({ cookie: staffCookie }), body: { legal_name: 'Relative', relationship: 'spouse' },
  });
  assert.equal(write.status, 201, 'no policy means no narrowing');
});

test('a narrowed staff member cannot create a case for another client or reassociate a case to it', async () => {
  const ownerCookie=await signIn('owner@caseflow.test');await narrowToOwnClient(ownerCookie);const staffCookie=await signIn('staff@caseflow.test');
  const before=backend.tables.cases.length;
  const created=await request({method:'POST',path:'/api/v1/cases',headers:browserHeaders({cookie:staffCookie}),body:{client_id:CLIENT_OTHER,service_code:'I-130',case_type:'Family Petition'}});
  assert.equal(created.status,404);assert.equal(backend.tables.cases.length,before,'no cross-client case may be created');
  const moved=await request({method:'PATCH',path:`/api/v1/cases/${CASE_MINE}`,headers:browserHeaders({cookie:staffCookie}),body:{client_id:CLIENT_OTHER}});
  assert.equal(moved.status,404);assert.equal(backend.tables.cases.find(row=>row.id===CASE_MINE).client_id,CLIENT_MINE,'canonical client link remains unchanged');
});

test('a client-only task and alert refresh obey the client boundary', async () => {
  const taskId='77777777-7777-4777-8777-777777777771';
  backend.tables.tasks.push({id:taskId,client_id:CLIENT_OTHER,case_id:null,title:'Other client task',status:'open',due_date:'2026-08-01',archived_at:null});
  backend.tables.clients.find(row=>row.id===CLIENT_OTHER).passport_expiration='2026-09-01';
  const ownerCookie=await signIn('owner@caseflow.test');await narrowToOwnClient(ownerCookie);const staffCookie=await signIn('staff@caseflow.test');
  const changed=await request({method:'PATCH',path:`/api/v1/tasks/${taskId}`,headers:browserHeaders({cookie:staffCookie}),body:{status:'completed'}});
  assert.equal(changed.status,404);assert.equal(backend.tables.tasks[0].status,'open');
  const beforeAlerts=backend.tables.alerts.length;
  const refreshed=await request({method:'POST',path:'/api/v1/alerts/refresh',headers:browserHeaders({cookie:staffCookie}),body:{}});
  assert.equal(refreshed.status,200,refreshed.raw);assert.equal(backend.tables.alerts.length,beforeAlerts,'no cross-client alert is created');
});

test('legal holds cannot be read, placed, or released across the client boundary', async () => {
  const holdId='88888888-8888-4888-8888-888888888881';backend.tables.legal_holds.push({id:holdId,client_id:CLIENT_OTHER,case_id:null,active:true,reason:'Other hold'});
  const ownerCookie=await signIn('owner@caseflow.test');await narrowToOwnClient(ownerCookie);const staffCookie=await signIn('staff@caseflow.test');
  const listed=await request({path:'/api/v1/legal-holds',headers:{cookie:staffCookie}});assert.equal(listed.status,200);assert.deepEqual(listed.body.data,[]);
  const placed=await request({method:'POST',path:'/api/v1/legal-holds',headers:browserHeaders({cookie:staffCookie}),body:{client_id:CLIENT_OTHER,reason:'Injected'}});assert.equal(placed.status,404);assert.equal(backend.tables.legal_holds.length,1);
  const released=await request({method:'POST',path:`/api/v1/legal-holds/${holdId}/release`,headers:browserHeaders({cookie:staffCookie}),body:{}});assert.equal(released.status,404);assert.equal(backend.tables.legal_holds[0].active,true);
});

test('authorization filters execute before LIMIT for restricted case and client pages', async () => {
  const ownerCookie=await signIn('owner@caseflow.test');
  const restricted=await request({method:'POST',path:'/api/v1/access/record-grants',headers:browserHeaders({cookie:ownerCookie}),body:{subject_type:'user',subject_id:staff.id,resource_type:'client',resource_id:CLIENT_OTHER,effect:'restrict'}});assert.equal(restricted.status,201,restricted.raw);
  for(let index=0;index<6;index+=1){backend.tables.clients.push({id:`90000000-0000-4000-8000-00000000000${index}`,legal_name:`Allowed ${index}`,archived_at:null,updated_at:`2026-07-${String(index+1).padStart(2,'0')}T00:00:00Z`});backend.tables.cases.push({id:`91000000-0000-4000-8000-00000000000${index}`,client_id:CLIENT_OTHER,client_name:'Restricted',case_type:'I-130',service_code:'I-130',status:'active',created_at:`2026-09-${String(index+1).padStart(2,'0')}T00:00:00Z`})}
  const staffCookie=await signIn('staff@caseflow.test');
  const clients=await request({path:'/api/v1/clients?limit=2',headers:{cookie:staffCookie}});assert.equal(clients.status,200);assert.equal(clients.body.data.length,2);assert.ok(clients.body.data.every(row=>row.id!==CLIENT_OTHER));
  const cases=await request({path:'/api/v1/cases?limit=2',headers:{cookie:staffCookie}});assert.equal(cases.status,200);assert.equal(cases.body.data.length,1);assert.equal(cases.body.data[0].id,CASE_MINE);
});

test('Owner diagnostics identify unconfigured global staff without including Owner', async () => {
  const ownerCookie=await signIn('owner@caseflow.test');const response=await request({path:'/api/v1/access',headers:{cookie:ownerCookie}});assert.equal(response.status,200,response.raw);
  assert.ok(response.body.data.diagnostics.unconfigured_global_staff.some(row=>row.id===staff.id));
  assert.equal(response.body.data.diagnostics.unconfigured_global_staff.some(row=>row.id===owner.id),false);
});

test('authorization configuration rejects orphan subjects, orphan resources, duplicates, conflicts, and wildcards', async () => {
  const ownerCookie=await signIn('owner@caseflow.test'),headers=browserHeaders({cookie:ownerCookie});
  for(const body of [
    {subject_type:'user',subject_id:'99999999-9999-4999-8999-999999999999',scopes:{cases:'global'}},
    {subject_type:'user',subject_id:staff.id,grants:['cases.view','cases.view']},
    {subject_type:'user',subject_id:staff.id,grants:['cases.view'],restrictions:['cases.view']},
    {subject_type:'user',subject_id:staff.id,grants:['*']},
  ])assert.equal((await request({method:'PUT',path:'/api/v1/access/policies',headers,body})).status,400);
  assert.equal((await request({method:'POST',path:'/api/v1/access/record-grants',headers,body:{subject_type:'user',subject_id:staff.id,resource_type:'case',resource_id:'99999999-9999-4999-8999-999999999999',effect:'grant'}})).status,400);
});

test('bootstrap authorization fails closed when canonical application-user state is unavailable', async () => {
  delete backend.tables.app_users;
  const response=await request({method:'POST',path:'/api/v1/auth/login',headers:browserHeaders(),body:{email:'staff@caseflow.test',password:'correct-horse-battery'}});
  assert.equal(response.status,503,'JWT role metadata must not replace unavailable canonical role state');
});
