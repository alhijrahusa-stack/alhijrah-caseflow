import test,{beforeEach}from'node:test';
import assert from'node:assert/strict';
import crypto from'node:crypto';
import fs from'node:fs';
import{serviceCatalog,serviceWorkflowFor}from'../src/platform.js';
import{backend,resetBackend,addUser,browserHeaders,cookieHeader,driver}from'./helpers/harness.js';
import{resetLoginThrottle}from'../src/auth.js';
import{handle,respondToError,invalidateAccessCache}from'../src/server.js';

const clientId='a3000000-0000-4000-8000-000000000001';
let user;
const request=driver(handle,respondToError);
async function signIn(account=user){const email=typeof account==='string'?account:account.email,response=await request({method:'POST',path:'/api/v1/auth/login',headers:browserHeaders(),body:{email,password:'correct-horse-battery'}});assert.equal(response.status,200,response.raw);return cookieHeader(response.cookies);}

beforeEach(()=>{resetBackend();resetLoginThrottle();invalidateAccessCache();user=addUser({email:'convergence@caseflow.test',roles:['admin']});backend.tables.clients.push({id:clientId,legal_name:'Convergence Client',archived_at:null});});

test('every supported service exposes one versioned operational workflow',()=>{
  for(const service of serviceCatalog){const workflow=serviceWorkflowFor(service.code);assert.equal(workflow.service_code,service.code);assert.equal(workflow.version,1);assert.ok(workflow.documents.length>0,service.code);assert.ok(Array.isArray(workflow.participant_roles));assert.ok(Array.isArray(workflow.forms));assert.deepEqual(workflow.review_gates,['participants_complete','documents_verified','forms_valid','evidence_complete','deadlines_resolved']);}
});

test('case creation pins the selected service plan and materializes requirements',async()=>{
  const cookie=await signIn(user.email),headers=browserHeaders({cookie});
  const registryId=crypto.randomUUID(),versionId=crypto.randomUUID(),definitionId=crypto.randomUUID();backend.tables.form_registry.push({id:registryId,authority:'USCIS',form_code:'N-400'});backend.tables.form_versions.push({id:versionId,registry_id:registryId,status:'active',official_pdf_source:'https://www.uscis.gov/n-400.pdf',source_sha256:'a'.repeat(64),verified_at:new Date().toISOString(),edition_date:'2026-01-01',mapping_version:1,mapping_test_status:'passed'});backend.tables.form_definitions.push({id:definitionId,form_version_id:versionId,status:'active',definition:{fields:[{path:'applicant.name',official_label:'Name',part:'1',item_number:'1',canonical_field_path:'client.legal_name',type:'text'}],pdf_mapping:[]}});
  const verifiedFieldId=crypto.randomUUID();backend.tables.verified_canonical_fields.push({id:verifiedFieldId,client_id:clientId,subject_type:'client',subject_id:clientId,field_path:'legal_name',field_value:'Convergence Client',revision:1,status:'current'});
  const created=await request({method:'POST',path:'/api/v1/cases',headers,body:{client_id:clientId,service_code:'N-400',priority:'normal'}});
  assert.equal(created.status,201,created.raw);assert.equal(created.body.service_plan.service_code,'N-400');assert.equal(created.body.service_plan.version,1);
  const caseRecord=backend.tables.cases[0];assert.equal(caseRecord.service_workflow_version,1);assert.equal(caseRecord.service_plan_snapshot.service_code,'N-400');
  assert.deepEqual(new Set(backend.tables.document_requests.map(item=>item.requirement_code)),new Set(['CLIENT_IDENTITY','PERMANENT_RESIDENT_CARD','TRAVEL_HISTORY']));
  assert.ok(backend.tables.document_requests.every(item=>item.case_id===caseRecord.id&&item.source==='service_workflow'));
  assert.equal(backend.tables.form_instances.length,1);assert.equal(backend.tables.form_instances[0].pinned_form_code,'N-400');
  assert.equal(backend.tables.form_answers[0].answer_value,'Convergence Client');assert.equal(backend.tables.form_answers[0].verified_canonical_field_id,verifiedFieldId);
  const workspace=await request({path:`/api/v1/cases/${caseRecord.id}/workspace`,headers});assert.equal(workspace.status,200,workspace.raw);assert.equal(workspace.body.data.readiness.state,'ACTION_REQUIRED');assert.ok(workspace.body.data.readiness.blockers.some(item=>item.type==='form'&&item.key==='USCIS:N-400'));
  const invalid=await request({method:'POST',path:'/api/v1/cases',headers,body:{client_id:clientId,service_code:'NOT-A-SERVICE',case_type:'Invented'}});assert.equal(invalid.status,400);assert.equal(invalid.body.error,'ACTIVE_SERVICE_REQUIRED');
});

test('verified upload immediately creates a durable processing job and a real review action',async()=>{
  const cookie=await signIn(user.email),headers=browserHeaders({cookie,'content-type':'application/pdf'}),caseId=crypto.randomUUID(),personId=crypto.randomUUID(),documentRequestId=crypto.randomUUID();
  backend.tables.cases.push({id:caseId,client_id:clientId,client_name:'Convergence Client',case_type:'N-400',service_code:'N-400',status:'active',archived_at:null});
  backend.tables.people.push({id:personId,legal_name:'Case Beneficiary'});backend.tables.case_people.push({case_id:caseId,person_id:personId,case_role:'beneficiary'});backend.tables.document_requests.push({id:documentRequestId,case_id:caseId,client_id:clientId,participant_role:'beneficiary',category:'identity',status:'missing'});
  const bytes=Buffer.from('%PDF-1.4\nsynthetic immutable document\n%%EOF');
  const uploaded=await request({method:'POST',path:`/api/v1/documents/upload?case_id=${caseId}&request_id=${documentRequestId}&filename=record.pdf&size_bytes=${bytes.length}`,headers,body:bytes});
  assert.equal(uploaded.status,201,uploaded.raw);assert.equal(uploaded.body.processing.status,'QUEUED');
  assert.equal(uploaded.body.linked.person_id,personId);assert.equal(backend.tables.document_requests[0].person_id,personId);
  assert.equal(backend.tables.background_jobs.length,1);assert.equal(backend.tables.background_jobs[0].job_type,'DOCUMENT_EXTRACT');
  for(let index=0;index<100&&backend.tables.background_jobs[0].status!=='succeeded';index++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(backend.tables.background_jobs[0].status,'succeeded');assert.equal(backend.tables.documents[0].automation_status,'REVIEW_REQUIRED');assert.equal(backend.tables.documents[0].review_status,'under_review');
  assert.ok(backend.tables.tasks.some(item=>item.automation_key===`document:${backend.tables.documents[0].id}:v1`&&item.status==='open'));
});

test('an authorized reviewer commits background extraction and refreshes affected form answers',async()=>{
  const reviewer=addUser({email:'reviewer@caseflow.test',roles:['document_reviewer']}),cookie=await signIn(reviewer),headers=browserHeaders({cookie}),caseId=crypto.randomUUID(),documentId=crypto.randomUUID(),requestId=crypto.randomUUID(),extractionId=crypto.randomUUID(),fieldId=crypto.randomUUID(),instanceId=crypto.randomUUID(),definitionId=crypto.randomUUID(),versionId=crypto.randomUUID(),uploaderId=crypto.randomUUID();
  backend.tables.cases.push({id:caseId,client_id:clientId,client_name:'Convergence Client',case_type:'N-400',service_code:'N-400',status:'active',archived_at:null});backend.tables.document_requests.push({id:requestId,case_id:caseId,client_id:clientId,requirement_code:'CLIENT_IDENTITY',status:'received'});backend.tables.documents.push({id:documentId,case_id:caseId,client_id:clientId,request_id:requestId,file_name:'identity.png',content_type:'image/png',content_checksum:'b'.repeat(64),size_bytes:1000,version:1,uploaded_by:uploaderId,automation_status:'REVIEW_REQUIRED',review_status:'under_review',archived_at:null});
  backend.tables.document_extractions.push({id:extractionId,document_id:documentId,case_id:caseId,client_id:clientId,document_version:1,source_sha256:'b'.repeat(64),requested_by:uploaderId,status:'pending_review',expires_at:new Date(Date.now()+60000).toISOString(),updated_at:new Date().toISOString(),raw_result:{engine:'test',mrz:{detected:true,valid:true},fields:{legal_name:'Verified Name'}}});backend.tables.document_extracted_fields.push({id:fieldId,extraction_id:extractionId,field_path:'legal_name',extracted_value:'Verified Name',verification_status:'proposed'});
  backend.tables.form_versions.push({id:versionId});backend.tables.form_definitions.push({id:definitionId,definition:{fields:[{path:'applicant.name',canonical_field_path:'client.legal_name',type:'text'}]}});backend.tables.form_instances.push({id:instanceId,case_id:caseId,participant_id:null,form_version_id:versionId,form_definition_id:definitionId,pinned_authority:'USCIS',pinned_form_code:'N-400',status:'reviewed',revision:1});backend.tables.form_answers.push({id:crypto.randomUUID(),form_instance_id:instanceId,field_path:'applicant.name',answer_value:'Old Name',source_type:'manual',verification_status:'unverified',revision:1});backend.tables.tasks.push({id:crypto.randomUUID(),case_id:caseId,client_id:clientId,automation_key:`document:${documentId}:v1`,title:'Verify fields',status:'open'});
  const confirmed=await request({method:'POST',path:`/api/v1/documents/${documentId}/extractions/${extractionId}/confirm`,headers,body:{confirmed:true,fields:{legal_name:'Verified Name'}}});
  assert.equal(confirmed.status,200,confirmed.raw);assert.equal(backend.tables.clients[0].legal_name,'Verified Name');assert.equal(backend.tables.documents[0].automation_status,'VERIFIED');assert.equal(backend.tables.document_requests[0].status,'approved');assert.equal(backend.tables.tasks[0].status,'completed');assert.equal(backend.tables.form_answers[0].answer_value,'Verified Name');assert.equal(backend.tables.form_answers[0].verification_status,'verified');assert.equal(backend.tables.form_instances[0].status,'draft');assert.deepEqual(confirmed.body.data.synchronized_forms,[{form_instance_id:instanceId,field_paths:['applicant.name']}]);
});

test('functional convergence migration pins service state and document automation safely',()=>{
  const sql=fs.readFileSync(new URL('../supabase/migrations/20260903120000_functional_convergence.sql',import.meta.url),'utf8');
  assert.match(sql,/add column if not exists service_plan_snapshot jsonb/i);assert.match(sql,/document_requests_service_requirement_uidx/i);assert.match(sql,/tasks_automation_key_uidx/i);assert.match(sql,/automation_status in\('NOT_QUEUED','QUEUED','PROCESSING','REVIEW_REQUIRED','RECAPTURE_REQUIRED','CONFLICT','VERIFIED','FAILED'\)/i);assert.match(sql,/caseflow_can_case\(extraction\.case_id,'documents\.review'\)/i);assert.doesNotMatch(sql,/extraction\.requested_by<>actor\s+or extraction\.expires_at/i);
});
