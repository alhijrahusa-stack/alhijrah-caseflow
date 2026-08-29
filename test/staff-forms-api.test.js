import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {addUser,backend,browserHeaders,cookieHeader,driver,putObject,resetBackend} from './helpers/harness.js';
import {handle,respondToError} from '../src/server.js';
import {resetLoginThrottle} from '../src/auth.js';

const request=driver(handle,respondToError),caseId='11111111-1111-4111-8111-111111111111',clientId='22222222-2222-4222-8222-222222222222';
async function session(){const response=await request({method:'POST',path:'/api/v1/auth/login',headers:browserHeaders(),body:{email:'manager@caseflow.test',password:'correct-horse-battery'}});assert.equal(response.status,200,response.raw);return cookieHeader(response.cookies)}
beforeEach(()=>{resetBackend();resetLoginThrottle();addUser({email:'manager@caseflow.test',roles:['case_manager']});backend.tables.clients.push({id:clientId,legal_name:'Amina Yusuf'});backend.tables.cases.push({id:caseId,client_id:clientId,client_name:'Amina Yusuf',case_type:'Naturalization',service_code:'N-400',status:'active',workflow_stage:'intake'});});

test('staff creates participants and histories with case-scoped audit provenance',async()=>{
  const cookie=await session(),headers={...browserHeaders(),cookie};
  const created=await request({method:'POST',path:`/api/v1/cases/${caseId}/participants`,headers,body:{case_role:'beneficiary',legal_name:'Amina Yusuf',date_of_birth:'1990-01-02',passport_number:'P123'}});
  assert.equal(created.status,201,created.raw);const personId=created.body.data.person_id;assert.ok(backend.tables.case_people.some(x=>x.case_id===caseId&&x.person_id===personId));
  const history=await request({method:'POST',path:`/api/v1/cases/${caseId}/histories`,headers,body:{person_id:personId,history_type:'address',starts_on:'2020-01-01',details:{city:'Arlington'}}});
  assert.equal(history.status,201,history.raw);assert.equal(history.body.data.verification_status,'unverified');assert.ok(backend.tables.audit_events.some(x=>x.case_id===caseId&&x.metadata?.action_source==='STAFF_ASSISTED'));
});

test('forms pin verified versions, autosave with conflict control, and block incomplete filing',async()=>{
  const cookie=await session(),headers={...browserHeaders(),cookie},registryId=crypto.randomUUID(),versionId=crypto.randomUUID(),definitionId=crypto.randomUUID();
  const definition={fields:[{path:'applicant.name',canonical_field_path:'person.legal_name',official_label:'Legal Name',part:'1',item_number:'1',required:true}],pdf_mapping:[{pdf_field:'name',canonical_field_path:'applicant.name'}]};
  backend.tables.form_registry.push({id:registryId,authority:'USCIS',form_code:'N-400'});backend.tables.form_versions.push({id:versionId,registry_id:registryId,edition_date:'2026-01-01',official_pdf_source:'https://www.uscis.gov/n-400',source_sha256:'a'.repeat(64),verified_at:new Date().toISOString(),mapping_version:1,mapping_test_status:'passed',status:'active'});backend.tables.form_definitions.push({id:definitionId,form_version_id:versionId,mapping_version:1,status:'active',definition});
  const started=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms`,headers,body:{authority:'USCIS',form_code:'N-400'}});assert.equal(started.status,201,started.raw);const instance=started.body.data;assert.equal(instance.pinned_source_sha256,'a'.repeat(64));
  const blocked=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms/${instance.id}/validate`,headers,body:{}});assert.equal(blocked.status,200);assert.equal(blocked.body.data.filing_ready,false);
  const saved=await request({method:'PATCH',path:`/api/v1/cases/${caseId}/forms/${instance.id}/answers/applicant.name`,headers,body:{value:'Amina Yusuf',expected_revision:0}});assert.equal(saved.status,200,saved.raw);assert.equal(saved.body.data.revision,1);
  const conflict=await request({method:'PATCH',path:`/api/v1/cases/${caseId}/forms/${instance.id}/answers/applicant.name`,headers,body:{value:'Different',expected_revision:0}});assert.equal(conflict.status,409);assert.equal(conflict.body.error,'AUTOSAVE_CONFLICT');
  const invented=await request({method:'PATCH',path:`/api/v1/cases/${caseId}/forms/${instance.id}/answers/invented.field`,headers,body:{value:'Unmapped',expected_revision:0}});assert.equal(invented.status,400);assert.equal(invented.body.error,'FORM_FIELD_NOT_DEFINED');
  const ready=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms/${instance.id}/validate`,headers,body:{}});assert.equal(ready.body.data.filing_ready,true);
});

test('unverified forms and unavailable AI provider do not fabricate results',async()=>{
  const cookie=await session(),headers={...browserHeaders(),cookie},registryId=crypto.randomUUID();backend.tables.form_registry.push({id:registryId,authority:'USCIS',form_code:'I-130'});
  const form=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms`,headers,body:{authority:'USCIS',form_code:'I-130'}});assert.equal(form.status,409);assert.equal(form.body.error,'NO_ACTIVE_VERIFIED_FORM_EDITION');
  const ai=await request({method:'POST',path:'/api/v1/ai-review',headers,body:{case_id:caseId,idempotency_key:'test'}});assert.equal(ai.status,403,'non-owner cannot invoke AI review');
  assert.equal(backend.tables.ai_findings.length,0);
});

test('intake and document linkage reject cross-case identifiers supplied by the browser',async()=>{
  const cookie=await session(),headers={...browserHeaders(),cookie},otherClient=crypto.randomUUID();
  const intake=await request({method:'GET',path:`/api/v1/intakes/${crypto.randomUUID()}/N-400`,headers});assert.equal(intake.status,404);
  const key=`cases/${caseId}/proof.pdf`;putObject(key,{size:3,contentType:'application/pdf'});
  const confirm=await request({method:'POST',path:'/api/v1/documents/confirm',headers,body:{case_id:caseId,client_id:otherClient,key,filename:'proof.pdf',content_type:'application/pdf',size_bytes:3}});assert.equal(confirm.status,409);assert.equal(confirm.body.error,'DOCUMENT_CLIENT_MISMATCH');assert.equal(backend.tables.documents.length,0);
});
