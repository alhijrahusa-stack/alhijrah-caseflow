import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('staff forms migration is additive, server-only, idempotent and syntactically valid for policies',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260829010000_staff_forms_platform.sql',import.meta.url),'utf8');
  for(const destructive of [/\bdrop\s+(table|column|constraint|trigger|function)\b/i,/\btruncate\b/i,/\bdelete\s+from\b/i])assert.doesNotMatch(sql,destructive);
  assert.doesNotMatch(sql,/create\s+restrictive\s+policy/i);
  assert.match(sql,/create policy %I on public\.%I as restrictive/i);
  for(const table of ['form_registry','form_versions','form_definitions','form_instances','form_answers','background_jobs','generated_artifacts','ai_review_runs','ai_findings'])assert.match(sql,new RegExp(`create table if not exists public\\.${table}`));
  assert.match(sql,/force row level security/i);assert.match(sql,/revoke all on public\.%I from anon, authenticated/i);assert.match(sql,/grant select, insert, update on public\.%I to service_role/i);
});
