import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {addUser,backend,browserHeaders,cookieHeader,driver,resetBackend} from './helpers/harness.js';
import {handle,respondToError} from '../src/server.js';
import {resetAuthProvisioningCache,resetLoginThrottle} from '../src/auth.js';

const request=driver(handle,respondToError);
const clientId='91000000-0000-4000-8000-000000000001';
const caseId='92000000-0000-4000-8000-000000000002';
let manager,recipient;

beforeEach(()=>{
  resetBackend();resetLoginThrottle();resetAuthProvisioningCache();
  manager=addUser({email:'manager@caseflow.test',roles:['case_manager'],fullName:'Case Manager'});
  recipient=addUser({email:'recipient@caseflow.test',roles:['case_manager'],fullName:'Assigned Staff'});
  addUser({email:'owner@caseflow.test',roles:['owner'],fullName:'Owner'});
  backend.tables.clients.push({id:clientId,client_number:'AHC-2026-000001',legal_name:'Canonical Client',archived_at:null});
  backend.tables.cases.push({id:caseId,client_id:clientId,client_name:'Canonical Client',case_number:'AH-2026-000001',case_reference:'AH-2026-000001',case_type:'N-400',workflow_stage:'intake',status:'active',priority:'high',archived_at:null,updated_at:new Date().toISOString()});
  backend.tables.case_assignments.push({case_id:caseId,auth_user_id:recipient.id,assignment_role:'lead',active:true});
});

async function signIn(email){const response=await request({method:'POST',path:'/api/v1/auth/login',headers:browserHeaders(),body:{email,password:'correct-horse-battery'}});assert.equal(response.status,200,response.raw);return cookieHeader(response.cookies)}

test('canonical client file is virtual, case-linked, and access scoped',async()=>{
  const cookie=await signIn('manager@caseflow.test');
  backend.tables.documents.push({id:crypto.randomUUID(),case_id:caseId,client_id:clientId,file_name:'passport.pdf',category:'identity',review_status:'approved',archived_at:null});
  backend.tables.tasks.push({id:crypto.randomUUID(),case_id:caseId,client_id:clientId,title:'Review',status:'open',archived_at:null});
  const response=await request({path:`/api/v1/clients/${clientId}/file`,headers:browserHeaders({cookie})});
  assert.equal(response.status,200,response.raw);assert.equal(response.body.data.client.id,clientId);assert.equal(response.body.data.cases[0].id,caseId);assert.equal(response.body.data.documents[0].client_id,clientId);assert.equal(response.body.data.tasks[0].case_id,caseId);
});

test('dashboard operations reports real scoped metrics, workload and drill-down identifiers',async()=>{
  const cookie=await signIn('manager@caseflow.test');
  backend.tables.tasks.push({id:crypto.randomUUID(),case_id:caseId,title:'Past due',status:'open',due_date:'2020-01-01',archived_at:null});
  backend.tables.documents.push({id:crypto.randomUUID(),case_id:caseId,client_id:clientId,file_name:'notice.pdf',category:null,review_status:'rejected',archived_at:null});
  const response=await request({path:'/api/v1/dashboard/operations',headers:browserHeaders({cookie})});
  assert.equal(response.status,200,response.raw);assert.equal(response.body.data.metrics.active_cases,1);assert.equal(response.body.data.metrics.overdue_tasks,1);assert.equal(response.body.data.document_health.rejected,1);assert.deepEqual(response.body.data.drilldown.case_ids,[caseId]);assert.equal(response.body.data.workload[0].auth_user_id,recipient.id);
});

test('internal chat validates canonical recipients and document case links and writes audit provenance',async()=>{
  const cookie=await signIn('manager@caseflow.test'),documentId=crypto.randomUUID();
  backend.tables.documents.push({id:documentId,case_id:caseId,client_id:clientId,file_name:'evidence.pdf',archived_at:null});
  const sent=await request({method:'POST',path:'/api/v1/communications/internal',headers:browserHeaders({cookie}),body:{case_id:caseId,recipient_user_ids:[recipient.id],document_ids:[documentId],body:'Please review the evidence.'}});
  assert.equal(sent.status,201,sent.raw);assert.equal(sent.body.data.client_id,clientId);assert.deepEqual(sent.body.data.document_ids,[documentId]);assert.ok(backend.tables.case_events.some(row=>row.event_type==='internal_message_sent'&&row.payload.message_id===sent.body.data.id));assert.ok(backend.tables.audit_events.some(row=>row.action==='internal_message_sent'&&row.case_id===caseId));
  const listed=await request({path:`/api/v1/communications/internal?case_id=${caseId}`,headers:browserHeaders({cookie})});assert.equal(listed.status,200,listed.raw);assert.equal(listed.body.data[0].sender_name,'Case Manager');assert.deepEqual(listed.body.data[0].recipient_user_ids,[recipient.id]);
});

test('owner communication center joins canonical client and case identifiers without exposing it to staff',async()=>{
  const staffCookie=await signIn('manager@caseflow.test');
  const denied=await request({path:'/api/v1/communications/center',headers:browserHeaders({cookie:staffCookie})});assert.equal(denied.status,403);
  backend.tables.outbound_communications.push({id:crypto.randomUUID(),client_id:clientId,case_id:caseId,channel:'email',recipient:'client@example.com',subject:'Update',status:'failed',failure_code:'PROVIDER_NOT_CONFIGURED',created_at:new Date().toISOString()});
  const ownerCookie=await signIn('owner@caseflow.test'),response=await request({path:'/api/v1/communications/center',headers:browserHeaders({cookie:ownerCookie})});
  assert.equal(response.status,200,response.raw);assert.equal(response.body.data[0].case_number,'AH-2026-000001');assert.equal(response.body.data[0].client_number,'AHC-2026-000001');assert.equal(response.body.adapters.whatsapp,'provider_not_configured');
});

test('global search returns only case-scoped documents and participants',async()=>{
  const cookie=await signIn('manager@caseflow.test'),personId=crypto.randomUUID(),documentId=crypto.randomUUID();
  backend.tables.documents.push({id:documentId,case_id:caseId,client_id:clientId,file_name:'Unique Passport.pdf',category:'identity',archived_at:null});
  backend.tables.people.push({id:personId,legal_name:'Unique Participant',passport_number:'P123',archived_at:null});backend.tables.case_people.push({case_id:caseId,person_id:personId,case_role:'beneficiary'});
  const docs=await request({path:'/api/v1/search?q=Unique',headers:browserHeaders({cookie})});assert.equal(docs.status,200,docs.raw);assert.equal(docs.body.data.documents[0].id,documentId);assert.equal(docs.body.data.participants[0].id,personId);
});
