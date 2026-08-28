import test,{beforeEach}from'node:test';
import assert from'node:assert/strict';
import{addUser,backend,browserHeaders,cookieHeader,driver,resetBackend}from'./helpers/harness.js';
import{handle,respondToError}from'../src/server.js';
import{resetAuthProvisioningCache,resetLoginThrottle}from'../src/auth.js';

const request=driver(handle,respondToError);
const CLIENT_A='11111111-1111-4111-8111-111111111111',CLIENT_B='22222222-2222-4222-8222-222222222222';
const CASE_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',CASE_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let portal;

beforeEach(()=>{
  resetBackend();resetLoginThrottle();resetAuthProvisioningCache();
  portal=addUser({email:'portal-experience@caseflow.test',roles:['client_owner'],fullName:'Portal Client'});
  backend.tables.clients.push(
    {id:CLIENT_A,client_number:'AHC-2026-000001',legal_name:'Synthetic Client A',legal_name_ar:'عميل تجريبي أ',preferred_language:'Arabic',email:'a@example.test',phone:'+13135550001',archived_at:null},
    {id:CLIENT_B,client_number:'AHC-2026-000002',legal_name:'Synthetic Client B',preferred_language:'English',archived_at:null},
  );
  backend.tables.cases.push(
    {id:CASE_A,client_id:CLIENT_A,case_number:'AH-2026-000001',case_type:'Naturalization',service_code:'N-400',workflow_stage:'intake',archived_at:null,updated_at:new Date().toISOString()},
    {id:CASE_B,client_id:CLIENT_B,case_number:'AH-2026-000002',case_type:'Petition',service_code:'I-130',workflow_stage:'filed',archived_at:null,updated_at:new Date().toISOString()},
  );
  backend.tables.client_access.push({client_id:CLIENT_A,auth_user_id:portal.id,access_role:'owner',status:'active'});
});

async function signIn(){const response=await request({method:'POST',path:'/api/v1/auth/login',headers:browserHeaders(),body:{email:'portal-experience@caseflow.test',password:'correct-horse-battery'}});assert.equal(response.status,200);return cookieHeader(response.cookies);}

test('client PWA exposes only authorized visible records across every surface',async()=>{
  backend.tables.deadlines.push(
    {id:'d1111111-1111-4111-8111-111111111111',case_id:CASE_A,title:'Visible deadline',deadline_date:'2026-09-15',deadline_type:'filing',status:'open',client_visible:true},
    {id:'d2222222-2222-4222-8222-222222222222',case_id:CASE_A,title:'Internal deadline',deadline_date:'2026-09-16',deadline_type:'internal',status:'open',client_visible:false},
    {id:'d3333333-3333-4333-8333-333333333333',case_id:CASE_B,title:'Other client deadline',deadline_date:'2026-09-17',deadline_type:'filing',status:'open',client_visible:true},
  );
  backend.tables.invoices.push(
    {id:'f1111111-1111-4111-8111-111111111111',invoice_number:'SYN-A',client_id:CLIENT_A,case_id:CASE_A,currency:'USD',status:'issued',office_fee_cents:10000,government_fee_cents:0,other_fee_cents:0,client_visible:true},
    {id:'f2222222-2222-4222-8222-222222222222',invoice_number:'HIDDEN-A',client_id:CLIENT_A,case_id:CASE_A,currency:'USD',status:'issued',office_fee_cents:10000,client_visible:false},
    {id:'f3333333-3333-4333-8333-333333333333',invoice_number:'SYN-B',client_id:CLIENT_B,case_id:CASE_B,currency:'USD',status:'issued',office_fee_cents:10000,client_visible:true},
  );
  backend.tables.alerts.push(
    {id:'e1111111-1111-4111-8111-111111111111',client_id:CLIENT_A,case_id:CASE_A,title:'Visible alert',alert_type:'action',severity:'high',status:'open',client_visible:true},
    {id:'e2222222-2222-4222-8222-222222222222',client_id:CLIENT_A,case_id:CASE_A,title:'Internal alert',alert_type:'action',severity:'normal',status:'open',client_visible:false},
  );
  backend.tables.documents.push(
    {id:'c1111111-1111-4111-8111-111111111111',case_id:CASE_A,client_id:CLIENT_A,request_id:'caaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',object_key:'portal/a.pdf',file_name:'synthetic-a.pdf',content_type:'application/pdf',size_bytes:100,review_status:'approved',archived_at:null},
    {id:'c2222222-2222-4222-8222-222222222222',case_id:CASE_B,client_id:CLIENT_B,request_id:'cbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',object_key:'portal/b.pdf',file_name:'synthetic-b.pdf',content_type:'application/pdf',size_bytes:100,review_status:'approved',archived_at:null},
  );
  const cookie=await signIn();
  const portalResponse=await request({path:'/api/v1/portal',headers:browserHeaders({cookie})});
  assert.equal(portalResponse.status,200,portalResponse.raw);
  assert.deepEqual(portalResponse.body.data.cases.map(item=>item.id),[CASE_A]);
  assert.deepEqual(portalResponse.body.data.deadlines.map(item=>item.title),['Visible deadline']);
  assert.deepEqual(portalResponse.body.data.billing.map(item=>item.invoice_number),['SYN-A']);
  assert.deepEqual(portalResponse.body.data.notifications.map(item=>item.title),['Visible alert']);
  assert.deepEqual(portalResponse.body.data.documents.map(item=>item.file_name),['synthetic-a.pdf']);
  assert.equal((await request({path:'/api/v1/portal/documents/c1111111-1111-4111-8111-111111111111/url',headers:browserHeaders({cookie})})).status,200);
  assert.equal((await request({path:'/api/v1/portal/documents/c2222222-2222-4222-8222-222222222222/url',headers:browserHeaders({cookie})})).status,404);
});

test('approved client communications exclude queued and failed provider records',async()=>{
  backend.tables.outbound_communications.push(
    {id:'a1111111-1111-4111-8111-111111111111',client_id:CLIENT_A,case_id:CASE_A,language:'Arabic',subject:'Approved',body_text:'Visible',status:'sent',created_at:new Date().toISOString()},
    {id:'a2222222-2222-4222-8222-222222222222',client_id:CLIENT_A,case_id:CASE_A,language:'English',subject:'Queued',body_text:'Hidden',status:'queued',created_at:new Date().toISOString()},
  );
  const cookie=await signIn();
  const response=await request({path:`/api/v1/portal/cases/${CASE_A}`,headers:browserHeaders({cookie})});
  assert.equal(response.status,200,response.raw);
  assert.deepEqual(response.body.data.approved_communications.map(item=>item.subject),['Approved']);
});
