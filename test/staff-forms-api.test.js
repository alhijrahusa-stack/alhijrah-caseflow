import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PDFDocument}from'pdf-lib';
import {addUser,backend,browserHeaders,cookieHeader,driver,putObject,resetBackend} from './helpers/harness.js';
import {handle,invalidateAccessCache,respondToError} from '../src/server.js';
import {resetLoginThrottle} from '../src/auth.js';

const request=driver(handle,respondToError),caseId='11111111-1111-4111-8111-111111111111',clientId='22222222-2222-4222-8222-222222222222';
async function session(){const response=await request({method:'POST',path:'/api/v1/auth/login',headers:browserHeaders(),body:{email:'manager@caseflow.test',password:'correct-horse-battery'}});assert.equal(response.status,200,response.raw);return cookieHeader(response.cookies)}
async function sessionFor(email){const response=await request({method:'POST',path:'/api/v1/auth/login',headers:browserHeaders(),body:{email,password:'correct-horse-battery'}});assert.equal(response.status,200,response.raw);return cookieHeader(response.cookies)}
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

test('canonical autofill requires human confirmation and pins the exact verified fact',async()=>{
  const cookie=await session(),headers={...browserHeaders(),cookie},registryId=crypto.randomUUID(),versionId=crypto.randomUUID(),definitionId=crypto.randomUUID(),factId=crypto.randomUUID();
  const definition={fields:[{path:'applicant.name',canonical_field_path:'client.legal_name',official_label:'Legal Name',part:'1',item_number:'1',type:'text',required:true}],pdf_mapping:[{pdf_field:'name',canonical_field_path:'applicant.name'}]};
  backend.tables.form_registry.push({id:registryId,authority:'USCIS',form_code:'I-90'});backend.tables.form_versions.push({id:versionId,registry_id:registryId,edition_date:'2026-01-01',official_pdf_source:'https://www.uscis.gov/i-90',source_sha256:'b'.repeat(64),verified_at:new Date().toISOString(),mapping_version:1,mapping_test_status:'passed',status:'active'});backend.tables.form_definitions.push({id:definitionId,form_version_id:versionId,mapping_version:1,status:'active',definition});
  backend.tables.verified_canonical_fields.push({id:factId,client_id:clientId,subject_type:'client',subject_id:clientId,field_path:'legal_name',field_value:'Amina Yusuf',revision:1,status:'current'});
  const started=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms`,headers,body:{authority:'USCIS',form_code:'I-90'}}),instance=started.body.data;
  const preview=await request({method:'GET',path:`/api/v1/cases/${caseId}/forms/${instance.id}/canonical-autofill`,headers});assert.equal(preview.status,200,preview.raw);assert.equal(preview.body.data.human_confirmation_required,true);assert.equal(backend.tables.form_answers.length,0);
  const denied=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms/${instance.id}/canonical-autofill`,headers,body:{field_paths:['applicant.name']}});assert.equal(denied.status,400);assert.equal(backend.tables.form_answers.length,0);
  const saved=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms/${instance.id}/canonical-autofill`,headers,body:{confirmed:true,field_paths:['applicant.name']}});assert.equal(saved.status,200,saved.raw);assert.equal(saved.body.data.answers[0].verified_canonical_field_id,factId);assert.equal(saved.body.data.answers[0].verification_status,'verified');assert.equal(backend.tables.form_answer_revisions.length,1);assert.equal(backend.tables.form_instances.find(item=>item.id===instance.id).revision,2);
  const manual=await request({method:'PATCH',path:`/api/v1/cases/${caseId}/forms/${instance.id}/answers/applicant.name`,headers,body:{value:'Human correction',expected_revision:1,verification_status:'verified'}});assert.equal(manual.status,200,manual.raw);assert.equal(manual.body.data.verification_status,'unverified');assert.equal(manual.body.data.verified_canonical_field_id,null);assert.equal(backend.tables.form_answer_revisions.length,2);
});

test('verified form provenance rejects forged canonical facts and values before mutation',async()=>{
  const cookie=await session(),headers={...browserHeaders(),cookie},instanceId=crypto.randomUUID(),definitionId=crypto.randomUUID(),foreignClient=crypto.randomUUID(),factId=crypto.randomUUID();
  backend.tables.form_instances.push({id:instanceId,case_id:caseId,participant_id:null,form_definition_id:definitionId,revision:1});backend.tables.form_definitions.push({id:definitionId,definition:{fields:[{path:'applicant.name',canonical_field_path:'client.legal_name',official_label:'Legal Name',part:'1',item_number:'1',type:'text'}]}});backend.tables.verified_canonical_fields.push({id:factId,client_id:foreignClient,subject_type:'client',subject_id:foreignClient,field_path:'legal_name',field_value:'Foreign Client',revision:1,status:'current'});
  const forged=await request({method:'PATCH',path:`/api/v1/cases/${caseId}/forms/${instanceId}/answers/applicant.name`,headers,body:{value:'Foreign Client',expected_revision:0,source_type:'verified_field',source_record_id:factId}});assert.equal(forged.status,409,forged.raw);assert.equal(forged.body.error,'ANSWER_SOURCE_NOT_IN_CASE');assert.equal(backend.tables.form_answers.length,0);
});

test('reverse ingestion recomputes immutable PDF bytes and writes only after human confirmation',async()=>{
  const cookie=await session(),headers={...browserHeaders(),cookie},instanceId=crypto.randomUUID(),definitionId=crypto.randomUUID(),documentId=crypto.randomUUID(),objectKey=`cases/${caseId}/synthetic-filled.pdf`;
  const pdf=await PDFDocument.create(),page=pdf.addPage(),pdfField=pdf.getForm().createTextField('legal_name');pdfField.addToPage(page);pdfField.setText('Amina Yusuf');const bytes=Buffer.from(await pdf.save()),checksum=crypto.createHash('sha256').update(bytes).digest('hex');putObject(objectKey,{body:bytes,contentType:'application/pdf'});
  backend.tables.documents.push({id:documentId,case_id:caseId,client_id:clientId,object_key:objectKey,file_name:'synthetic-filled.pdf',content_type:'application/pdf',size_bytes:bytes.length,content_checksum:checksum,archived_at:null});backend.tables.form_instances.push({id:instanceId,case_id:caseId,participant_id:null,form_definition_id:definitionId,revision:1});backend.tables.form_definitions.push({id:definitionId,definition:{fields:[{path:'applicant.name',canonical_field_path:'client.legal_name',official_label:'Legal Name',part:'1',item_number:'1',type:'text'}],pdf_mapping:[{pdf_field:'legal_name',canonical_field_path:'applicant.name'}]}});
  const preview=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms/${instanceId}/reverse-ingest`,headers,body:{document_id:documentId}});assert.equal(preview.status,200,preview.raw);assert.equal(preview.body.data.answers[0].value,'Amina Yusuf');assert.equal(backend.tables.form_answers.length,0);
  const saved=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms/${instanceId}/reverse-ingest`,headers,body:{document_id:documentId,confirmed:true,field_paths:['applicant.name']}});assert.equal(saved.status,200,saved.raw);assert.equal(saved.body.data.answers[0].verification_status,'review_required');assert.equal(saved.body.data.answers[0].source_document_id,documentId);assert.ok(backend.tables.audit_events.some(event=>event.action==='official_pdf_reverse_ingest_confirmed'));
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

test('Client A cannot read or mutate Client B staff-form data',async()=>{
  const otherClientId=crypto.randomUUID(),otherCaseId=crypto.randomUUID();
  backend.tables.clients.push({id:otherClientId,legal_name:'Client B'});
  backend.tables.cases.push({id:otherCaseId,client_id:otherClientId,client_name:'Client B',case_type:'Family',status:'active'});
  const clientA=addUser({email:'client-a@caseflow.test',roles:['client_owner']});
  backend.tables.client_access.push({client_id:clientId,auth_user_id:clientA.id,access_role:'owner',status:'active'});
  invalidateAccessCache();
  const cookie=await sessionFor('client-a@caseflow.test'),headers={...browserHeaders(),cookie};
  const read=await request({method:'GET',path:`/api/v1/cases/${otherCaseId}/forms`,headers});
  const mutate=await request({method:'POST',path:`/api/v1/cases/${otherCaseId}/forms`,headers,body:{authority:'USCIS',form_code:'N-400'}});
  assert.equal(read.status,403);
  assert.equal(mutate.status,403);
  assert.equal(backend.tables.form_instances.length,0);
});

test('staff, participant, form-answer, finding, artifact and job data remain case-scoped',async()=>{
  const manager=backend.tables.app_users.find(row=>row.email==='manager@caseflow.test'),otherClientId=crypto.randomUUID(),otherCaseId=crypto.randomUUID(),foreignPersonId=crypto.randomUUID(),foreignInstanceId=crypto.randomUUID(),foreignFindingId=crypto.randomUUID(),foreignArtifactId=crypto.randomUUID();
  backend.tables.clients.push({id:otherClientId,legal_name:'Client B'});
  backend.tables.cases.push({id:otherCaseId,client_id:otherClientId,client_name:'Client B',case_type:'Family',status:'active'});
  backend.tables.case_assignments.push({case_id:caseId,auth_user_id:manager.auth_user_id,active:true});
  backend.tables.access_policies.push({subject_type:'user',subject_id:manager.auth_user_id,grants:[],restrictions:[],scopes:{cases:'assigned',documents:'assigned'}});
  backend.tables.people.push({id:foreignPersonId,legal_name:'Foreign Participant'});
  backend.tables.case_people.push({case_id:otherCaseId,person_id:foreignPersonId,case_role:'beneficiary'});
  backend.tables.form_instances.push({id:foreignInstanceId,case_id:otherCaseId,form_definition_id:crypto.randomUUID(),form_version_id:crypto.randomUUID(),status:'draft'});
  backend.tables.form_findings.push({id:foreignFindingId,case_id:otherCaseId,form_instance_id:foreignInstanceId,status:'open',severity:'warning'});
  backend.tables.background_jobs.push({id:crypto.randomUUID(),case_id:otherCaseId,status:'queued'});
  backend.tables.generated_artifacts.push({id:foreignArtifactId,case_id:otherCaseId,object_key:`cases/${otherCaseId}/foreign.pdf`,form_code:'N-400'});
  invalidateAccessCache();
  const cookie=await session(),headers={...browserHeaders(),cookie};
  const ownWorkspace=await request({method:'GET',path:`/api/v1/cases/${caseId}/forms`,headers});
  assert.equal(ownWorkspace.status,200,ownWorkspace.raw);
  assert.deepEqual(ownWorkspace.body.data,{instances:[],findings:[],jobs:[],artifacts:[]});
  const foreignWorkspace=await request({method:'GET',path:`/api/v1/cases/${otherCaseId}/forms`,headers});
  assert.equal(foreignWorkspace.status,404);
  const foreignParticipant=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms`,headers,body:{authority:'USCIS',form_code:'N-400',participant_id:foreignPersonId}});
  assert.equal(foreignParticipant.status,409);
  assert.equal(foreignParticipant.body.error,'PARTICIPANT_NOT_IN_CASE');
  const answerBypass=await request({method:'PATCH',path:`/api/v1/cases/${caseId}/forms/${foreignInstanceId}/answers/applicant.name`,headers,body:{value:'Bypass',expected_revision:0}});
  assert.equal(answerBypass.status,404);
  assert.equal(answerBypass.body.error,'FORM_INSTANCE_NOT_FOUND');
  assert.equal(backend.tables.form_answers.length,0);
  const artifactBypass=await request({method:'POST',path:`/api/v1/artifacts/${foreignArtifactId}/download-url`,headers});
  assert.equal(artifactBypass.status,404);
});

test('AI findings remain Owner-authorized and cannot be resolved by staff-supplied UUID',async()=>{
  const findingId=crypto.randomUUID();
  backend.tables.ai_findings.push({id:findingId,case_id:caseId,resolution:null,requires_owner_approval:true});
  const staffCookie=await session(),staffAttempt=await request({method:'PATCH',path:`/api/v1/ai-review/findings/${findingId}`,headers:{...browserHeaders(),cookie:staffCookie},body:{resolution:'accepted'}});
  assert.equal(staffAttempt.status,403);
  assert.equal(backend.tables.ai_findings[0].resolution,null);
  addUser({email:'owner@caseflow.test',roles:['owner']});
  invalidateAccessCache();
  const ownerCookie=await sessionFor('owner@caseflow.test'),ownerReview=await request({method:'PATCH',path:`/api/v1/ai-review/findings/${findingId}`,headers:{...browserHeaders(),cookie:ownerCookie},body:{resolution:'accepted'}});
  assert.equal(ownerReview.status,200,ownerReview.raw);
  assert.equal(backend.tables.ai_findings[0].resolution,'accepted');
});
