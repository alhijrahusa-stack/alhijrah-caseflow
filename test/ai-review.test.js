import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredAiProvider,evaluateAiReview,runConstrainedAiReview} from '../src/ai-review.js';

test('AI provider is optional and incomplete or unsafe configuration fails closed',()=>{
  assert.equal(configuredAiProvider({},fetch),null);
  assert.throws(()=>configuredAiProvider({AI_PROVIDER:'x'},fetch),/INCOMPLETE/);
  assert.throws(()=>configuredAiProvider({AI_PROVIDER:'x',AI_PROVIDER_URL:'http://localhost',AI_PROVIDER_MODEL:'m',AI_PROVIDER_API_KEY:'k'},fetch),/NOT_ALLOWED/);
});

test('AI review permits only allow-listed read tools and validates traceable output',async()=>{
  const finding={finding_id:'f1',category:'MISSING_DATA',severity:'blocker',case_id:'c1',claim:'Missing',source_references:['answer:a1'],reason:'Required',suggested_action:'Review',requires_owner_approval:true,timestamp:new Date().toISOString(),provider:'test',model_version:'v1'};
  const provider={name:'test',model:'v1',review:async()=>[finding]};
  const result=await runConstrainedAiReview({provider,principal:{id:'u1'},caseId:'c1',toolNames:['get_case_summary'],executeTool:async()=>({id:'c1'})});
  assert.equal(result.findings.length,1);assert.equal(evaluateAiReview({expectedDefects:['MISSING_DATA:'],findings:[finding]}).pass,true);
  await assert.rejects(()=>runConstrainedAiReview({provider,principal:{id:'u1'},caseId:'c1',toolNames:['delete_case'],executeTool:async()=>{}}),/AI_TOOL_NOT_ALLOWED/);
});
