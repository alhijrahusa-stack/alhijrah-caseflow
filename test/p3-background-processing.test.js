import test,{beforeEach}from'node:test';
import assert from'node:assert/strict';
import crypto from'node:crypto';
import fs from'node:fs';
import{backend,resetBackend}from'./helpers/harness.js';
import{runBackgroundWorkerCycle}from'../src/server.js';

beforeEach(resetBackend);

test('durable worker claims an unknown job once and fails it permanently',async()=>{
  const job={id:crypto.randomUUID(),job_type:'UNSUPPORTED_SYNTHETIC_JOB',idempotency_key:`p3-${crypto.randomUUID()}`,status:'queued',progress:0,payload:{synthetic:true},attempt_count:0,max_attempts:5,priority:100,available_at:new Date().toISOString(),input_fingerprint:'0'.repeat(64),created_at:new Date().toISOString()};
  backend.tables.background_jobs.push(job);
  assert.equal(await runBackgroundWorkerCycle(),1);
  assert.equal(job.status,'failed');
  assert.equal(job.attempt_count,1);
  assert.equal(job.failure_class,'permanent');
  assert.equal(job.lease_token,null);
  assert.equal(await runBackgroundWorkerCycle(),0);
});

test('expired leases are reclaimed and forged completion tokens are denied by the RPC boundary',async()=>{
  const job={id:crypto.randomUUID(),job_type:'UNSUPPORTED_SYNTHETIC_JOB',idempotency_key:`p3-${crypto.randomUUID()}`,status:'running',progress:0,payload:{},attempt_count:1,max_attempts:5,priority:100,available_at:new Date(Date.now()-1000).toISOString(),lease_token:crypto.randomUUID(),leased_by:'dead-worker',lease_expires_at:new Date(Date.now()-1000).toISOString(),input_fingerprint:'0'.repeat(64),created_at:new Date(Date.now()-2000).toISOString()};
  backend.tables.background_jobs.push(job);
  assert.equal(await runBackgroundWorkerCycle(),1);
  assert.equal(job.status,'failed');
  assert.equal(job.attempt_count,2);
  assert.equal(job.last_error_code,'UNSUPPORTED_JOB_TYPE');
});

test('P3 migration provides bounded atomic leasing and backend-only RPC privileges',()=>{
  const sql=fs.readFileSync(new URL('../supabase/migrations/20260830150000_durable_background_processing.sql',import.meta.url),'utf8');
  assert.match(sql,/for update skip locked/i);
  assert.match(sql,/attempt_count<max_attempts/i);
  assert.match(sql,/lease_expires_at<now\(\)/i);
  assert.match(sql,/revoke all on function public\.claim_background_jobs\(text,integer,integer\) from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.claim_background_jobs\(text,integer,integer\) to service_role/i);
  assert.doesNotMatch(sql,/grant execute[^;]+authenticated/i);
});
