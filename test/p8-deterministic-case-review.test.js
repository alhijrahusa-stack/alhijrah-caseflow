import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {addUser,backend,browserHeaders,cookieHeader,driver,resetBackend} from './helpers/harness.js';
import {handle,respondToError} from '../src/server.js';
import {resetLoginThrottle} from '../src/auth.js';

const request=driver(handle,respondToError);
const caseId='18888888-1111-4111-8111-111111111111';
const clientId='28888888-2222-4222-8222-222222222222';

async function session(){
  const response=await request({method:'POST',path:'/api/v1/auth/login',headers:browserHeaders(),body:{email:'p8-manager@caseflow.test',password:'correct-horse-battery'}});
  assert.equal(response.status,200,response.raw);
  return cookieHeader(response.cookies);
}

function seedForm(formCode,value,hashCharacter){
  const registryId=crypto.randomUUID(),versionId=crypto.randomUUID(),definitionId=crypto.randomUUID(),instanceId=crypto.randomUUID(),answerId=crypto.randomUUID();
  const definition={fields:[{path:'applicant.name',canonical_field_path:'client.legal_name',official_label:'Legal Name',part:'1',item_number:'1',type:'text',required:true}],pdf_mapping:[{pdf_field:'name',canonical_field_path:'applicant.name'}]};
  backend.tables.form_registry.push({id:registryId,authority:'USCIS',form_code:formCode});
  backend.tables.form_versions.push({id:versionId,registry_id:registryId,edition_date:'2026-01-01',official_pdf_source:`https://www.uscis.gov/${formCode.toLowerCase()}`,source_sha256:hashCharacter.repeat(64),verified_at:new Date().toISOString(),mapping_version:1,mapping_test_status:'passed',status:'active'});
  backend.tables.form_definitions.push({id:definitionId,form_version_id:versionId,mapping_version:1,status:'active',definition});
  backend.tables.form_instances.push({id:instanceId,case_id:caseId,participant_id:null,form_version_id:versionId,form_definition_id:definitionId,pinned_authority:'USCIS',pinned_form_code:formCode,pinned_edition_date:'2026-01-01',pinned_mapping_version:1,pinned_source_sha256:hashCharacter.repeat(64),status:'draft',revision:1});
  backend.tables.form_answers.push({id:answerId,form_instance_id:instanceId,field_path:'applicant.name',canonical_field_path:'client.legal_name',answer_value:value,source_type:'manual',verification_status:'unverified',revision:1,last_changed_source:'STAFF_ASSISTED'});
  return {instanceId,answerId};
}

beforeEach(()=>{
  resetBackend();
  resetLoginThrottle();
  addUser({email:'p8-manager@caseflow.test',roles:['case_manager']});
  backend.tables.clients.push({id:clientId,legal_name:'P8 Client'});
  backend.tables.cases.push({id:caseId,client_id:clientId,client_name:'P8 Client',case_type:'Family',service_code:'I-130',status:'active',workflow_stage:'intake'});
});

test('case review persists cross-form blockers, reuses deterministic identity, and resolves stale findings',async()=>{
  const first=seedForm('I-130','Amina Yusuf','a');
  const second=seedForm('I-485','Amina Youssef','b');
  const headers={...browserHeaders(),cookie:await session()};

  const blocked=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms/${first.instanceId}/validate`,headers,body:{}});
  assert.equal(blocked.status,200,blocked.raw);
  assert.equal(blocked.body.data.filing_ready,false);
  assert.ok(blocked.body.data.blockers.some(item=>item.category==='CROSS_FORM_CONFLICT'));

  const open=backend.tables.form_findings.filter(item=>item.case_id===caseId&&item.created_by_type==='deterministic'&&item.status==='open'&&item.category==='CROSS_FORM_CONFLICT');
  assert.equal(open.length,1);
  assert.match(open[0].rule_source.deterministic_key,/^[0-9a-f]{64}$/);
  const findingId=open[0].id;

  const repeated=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms/${first.instanceId}/validate`,headers,body:{}});
  assert.equal(repeated.status,200,repeated.raw);
  assert.equal(backend.tables.form_findings.filter(item=>item.id===findingId&&item.status==='open').length,1);
  assert.equal(backend.tables.form_findings.filter(item=>item.case_id===caseId&&item.created_by_type==='deterministic'&&item.status==='open'&&item.category==='CROSS_FORM_CONFLICT').length,1);

  backend.tables.form_answers.find(item=>item.id===second.answerId).answer_value='Amina Yusuf';
  const ready=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms/${first.instanceId}/validate`,headers,body:{}});
  assert.equal(ready.status,200,ready.raw);
  assert.equal(ready.body.data.filing_ready,true);
  assert.equal(backend.tables.form_findings.find(item=>item.id===findingId).status,'resolved');
  assert.equal(backend.tables.form_findings.filter(item=>item.case_id===caseId&&item.created_by_type==='deterministic'&&item.status==='open').length,0);
});

test('verified active rules fail closed and block the target form',async()=>{
  const form=seedForm('I-130','Amina Yusuf','c');
  backend.tables.form_rules.push({id:crypto.randomUUID(),authority:'USCIS',rule_code:'P8-NAME-RULE',rule_version:1,official_source:'https://www.uscis.gov/i-130',verified_at:new Date().toISOString(),status:'active',rule_definition:{assert:{field:'applicant.name',operator:'equals',value:'Different Name'},severity:'blocker',category:'RULE_VIOLATION',field_path:'applicant.name',claim:'The deterministic rule is not satisfied.'}});
  const headers={...browserHeaders(),cookie:await session()};

  const result=await request({method:'POST',path:`/api/v1/cases/${caseId}/forms/${form.instanceId}/validate`,headers,body:{}});
  assert.equal(result.status,200,result.raw);
  assert.equal(result.body.data.filing_ready,false);
  assert.ok(result.body.data.blockers.some(item=>item.category==='RULE_VIOLATION'));
  const persisted=backend.tables.form_findings.find(item=>item.case_id===caseId&&item.category==='RULE_VIOLATION'&&item.status==='open');
  assert.ok(persisted);
  assert.equal(persisted.rule_source.rule_code,'P8-NAME-RULE');
  assert.match(persisted.rule_source.deterministic_key,/^[0-9a-f]{64}$/);
});
