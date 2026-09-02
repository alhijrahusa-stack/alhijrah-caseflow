import test,{beforeEach}from'node:test';
import assert from'node:assert/strict';
import{addUser,backend,browserHeaders,cookieHeader,driver,resetBackend}from'./helpers/harness.js';
import{handle,respondToError}from'../src/server.js';
import{resetAuthProvisioningCache,resetLoginThrottle}from'../src/auth.js';
const request=driver(handle,respondToError);
const CLIENT_A='11111111-1111-4111-8111-111111111111',CLIENT_B='22222222-2222-4222-8222-222222222222';
const CASE_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',CASE_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let analyst;
beforeEach(()=>{
  resetBackend();resetLoginThrottle();resetAuthProvisioningCache();
  analyst=addUser({email:'reporter@test.invalid',roles:['auditor'],fullName:'Reporter'});
  backend.tables.clients.push({id:CLIENT_A,legal_name:'A',archived_at:null},{id:CLIENT_B,legal_name:'B',archived_at:null});
  backend.tables.cases.push(
    {id:CASE_A,client_id:CLIENT_A,service_code:'I-130',workflow_stage:'filed',priority:'high',created_at:'2026-08-10T00:00:00Z',archived_at:null},
    {id:CASE_B,client_id:CLIENT_B,service_code:'I-485',workflow_stage:'intake',priority:'normal',created_at:'2026-08-11T00:00:00Z',archived_at:null});
  backend.tables.access_policies.push({id:'p12-policy',subject_type:'user',subject_id:analyst.id,grants:[],restrictions:[],scopes:{cases:'explicit_client',reports:'explicit_client'}});
  backend.tables.record_access_grants.push({id:'p12-grant',subject_type:'user',subject_id:analyst.id,resource_type:'client',resource_id:CLIENT_A,effect:'grant',permissions:[]});
  backend.tables.tasks.push({id:'t1',case_id:CASE_A,status:'completed',due_date:'2026-08-15',created_at:'2026-08-10T00:00:00Z',completed_at:'2026-08-12T00:00:00Z'},{id:'t2',case_id:CASE_B,status:'open',due_date:'2026-08-01'});
  backend.tables.deadlines.push({id:'d1',case_id:CASE_A,status:'open',deadline_date:'2026-08-20',deadline_type:'filing'});
  backend.tables.documents.push({id:'doc1',case_id:CASE_A,review_status:'approved',category:'identity',archived_at:null,created_at:'2026-08-12'});
  backend.tables.invoices.push({id:'inv1',client_id:CLIENT_A,case_id:CASE_A,status:'issued',currency:'USD',office_fee_cents:10000,government_fee_cents:5000,other_fee_cents:0,created_at:'2026-08-12'});
  backend.tables.payments.push({id:'pay1',invoice_id:'inv1',status:'recorded',amount_cents:4000,currency:'USD',received_at:'2026-08-13'});
  backend.tables.agency_requests.push({id:'rfe1',case_id:CASE_A,request_type:'rfe',status:'open',response_due_date:'2026-08-30',created_at:'2026-08-12'});
});
async function login(){const r=await request({method:'POST',path:'/api/v1/auth/login',headers:browserHeaders(),body:{email:'reporter@test.invalid',password:'correct-horse-battery'}});assert.equal(r.status,200);return cookieHeader(r.cookies)}
test('operational reports aggregate only authorized cases and export the same scope',async()=>{
  const cookie=await login(),headers=browserHeaders({cookie});
  const result=await request({path:'/api/v1/reports/summary?from=2026-08-01&to=2026-08-31',headers});
  assert.equal(result.status,200,result.raw);
  assert.equal(result.body.data.cases.total,1);
  assert.deepEqual(result.body.data.cases.by_service,{'I-130':1});
  assert.equal(result.body.data.tasks.average_completion_days,2);
  assert.equal(result.body.data.billing.billed_cents,15000);
  assert.equal(result.body.data.billing.collected_cents,4000);
  assert.equal(result.body.data.billing.outstanding_cents,11000);
  assert.equal(result.body.data.agency_requests.total,1);
  const csv=await request({path:'/api/v1/reports/export.csv?service_code=I-130',headers});
  assert.equal(csv.status,200,csv.raw);
  assert.match(csv.headers['content-type'],/text\/csv/);
  assert.match(csv.raw,/"cases","total","","1"/);
  assert.doesNotMatch(csv.raw,/I-485/);
});
test('report filters fail closed on malformed ranges and identifiers',async()=>{
  const cookie=await login(),headers=browserHeaders({cookie});
  assert.equal((await request({path:'/api/v1/reports/summary?from=2026-09-01&to=2026-08-01',headers})).status,400);
  assert.equal((await request({path:'/api/v1/reports/summary?team_id=not-a-uuid',headers})).status,400);
});
