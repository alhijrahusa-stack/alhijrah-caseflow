import test,{beforeEach}from'node:test';
import assert from'node:assert/strict';
import{addUser,backend,browserHeaders,cookieHeader,driver,resetBackend}from'./helpers/harness.js';
import{handle,respondToError}from'../src/server.js';
import{resetAuthProvisioningCache,resetLoginThrottle}from'../src/auth.js';

const request=driver(handle,respondToError);
const CLIENT_A='11111111-1111-4111-8111-111111111111',CLIENT_B='22222222-2222-4222-8222-222222222222';
const CASE_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',CASE_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',CASE_C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PERSON_A='31111111-1111-4111-8111-111111111111',PERSON_B='32222222-2222-4222-8222-222222222222',PERSON_C='33333333-3333-4333-8333-333333333333';
let owner,beneficiary,employer;

beforeEach(()=>{
  resetBackend();resetLoginThrottle();resetAuthProvisioningCache();
  owner=addUser({email:'owner@caseflow.test',roles:['owner'],fullName:'Owner'});
  beneficiary=addUser({email:'beneficiary@test.invalid',roles:['beneficiary_portal'],fullName:'Beneficiary'});
  employer=addUser({email:'employer@test.invalid',roles:['employer_portal'],fullName:'Employer'});
  backend.tables.clients.push({id:CLIENT_A,legal_name:'Client A',archived_at:null},{id:CLIENT_B,legal_name:'Client B',archived_at:null});
  backend.tables.cases.push(
    {id:CASE_A,client_id:CLIENT_A,case_type:'I-130',service_code:'I-130',archived_at:null,updated_at:'2026-01-01'},
    {id:CASE_B,client_id:CLIENT_B,case_type:'I-140',service_code:'I-140',archived_at:null,updated_at:'2026-01-02'},
    {id:CASE_C,client_id:CLIENT_B,case_type:'I-129',service_code:'I-129',archived_at:null,updated_at:'2026-01-03'});
  backend.tables.people.push({id:PERSON_A,legal_name:'Person A'},{id:PERSON_B,legal_name:'Person B'},{id:PERSON_C,legal_name:'Person C'});
  backend.tables.case_people.push({case_id:CASE_A,person_id:PERSON_A,case_role:'beneficiary'},{case_id:CASE_A,person_id:PERSON_C,case_role:'derivative_beneficiary'},{case_id:CASE_B,person_id:PERSON_B,case_role:'beneficiary'});
  backend.tables.portal_case_access.push(
    {case_id:CASE_A,auth_user_id:beneficiary.id,portal_type:'beneficiary',person_id:PERSON_A,status:'active'},
    {case_id:CASE_B,auth_user_id:employer.id,portal_type:'employer',person_id:null,status:'active'});
  backend.tables.appointments.push(
    {id:'appointment-b',case_id:CASE_B,client_id:CLIENT_B,client_visible:true,title:'B'},
    {id:'appointment-c',case_id:CASE_C,client_id:CLIENT_B,client_visible:true,title:'C'},
    {id:'appointment-client',case_id:null,client_id:CLIENT_B,client_visible:true,title:'Client'});
  backend.tables.invoices.push(
    {id:'invoice-b',case_id:CASE_B,client_id:CLIENT_B,client_visible:true,status:'issued'},
    {id:'invoice-c',case_id:CASE_C,client_id:CLIENT_B,client_visible:true,status:'issued'},
    {id:'invoice-client',case_id:null,client_id:CLIENT_B,client_visible:true,status:'issued'});
  backend.tables.alerts.push(
    {id:'alert-b',case_id:CASE_B,client_id:CLIENT_B,client_visible:true,status:'open'},
    {id:'alert-c',case_id:CASE_C,client_id:CLIENT_B,client_visible:true,status:'open'},
    {id:'alert-client',case_id:null,client_id:CLIENT_B,client_visible:true,status:'open'});
});

async function login(email){const r=await request({method:'POST',path:'/api/v1/auth/login',headers:browserHeaders(),body:{email,password:'correct-horse-battery'}});assert.equal(r.status,200,r.raw);return cookieHeader(r.cookies)}

test('beneficiary and employer portals are isolated to explicit cases and participant context',async()=>{
  const b=await login('beneficiary@test.invalid');
  const portal=await request({path:'/api/v1/portal',headers:browserHeaders({cookie:b})});
  assert.equal(portal.status,200,portal.raw);
  assert.deepEqual(portal.body.data.cases.map(x=>x.id),[CASE_A]);
  assert.deepEqual(portal.body.data.participants.map(x=>x.id),[PERSON_A]);
  assert.equal((await request({path:`/api/v1/portal/cases/${CASE_B}`,headers:browserHeaders({cookie:b})})).status,404);
  const e=await login('employer@test.invalid');
  const employerPortal=await request({path:'/api/v1/portal',headers:browserHeaders({cookie:e})});
  assert.deepEqual(employerPortal.body.data.cases.map(x=>x.id),[CASE_B]);
  assert.deepEqual(employerPortal.body.data.participants,[]);
  assert.deepEqual(employerPortal.body.data.clients,[],'case-specific access must not widen to the whole client record');
  assert.deepEqual(employerPortal.body.data.appointments.map(x=>x.id),['appointment-b']);
  assert.deepEqual(employerPortal.body.data.billing.map(x=>x.id),['invoice-b']);
  assert.deepEqual(employerPortal.body.data.notifications.map(x=>x.id),['alert-b']);
});

test('revocation is immediate and a foreign beneficiary UUID is rejected before mutation',async()=>{
  const ownerCookie=await login('owner@caseflow.test');
  const forged=await request({method:'POST',path:`/api/v1/cases/${CASE_A}/portal-access`,headers:browserHeaders({cookie:ownerCookie}),body:{auth_user_id:beneficiary.id,portal_type:'beneficiary',person_id:PERSON_B}});
  assert.equal(forged.status,409,forged.raw);
  assert.equal(backend.tables.portal_case_access.filter(x=>x.case_id===CASE_A&&x.auth_user_id===beneficiary.id).length,1);
  const removed=await request({method:'DELETE',path:`/api/v1/cases/${CASE_A}/portal-access/${beneficiary.id}`,headers:browserHeaders({cookie:ownerCookie}),body:{}});
  assert.equal(removed.status,200,removed.raw);
  const rebound=await request({method:'POST',path:`/api/v1/cases/${CASE_A}/portal-access`,headers:browserHeaders({cookie:ownerCookie}),body:{auth_user_id:beneficiary.id,portal_type:'beneficiary',person_id:PERSON_C}});
  assert.equal(rebound.status,409,rebound.raw);
  const b=await login('beneficiary@test.invalid');
  const portal=await request({path:'/api/v1/portal',headers:browserHeaders({cookie:b})});
  assert.deepEqual(portal.body.data.cases,[]);
});
