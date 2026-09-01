import test from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';

test('P4 extraction storage is backend-written, RLS-scoped, source-pinned, and human-reviewed',()=>{
  const sql=fs.readFileSync(new URL('../supabase/migrations/20260830160000_persistent_document_intelligence.sql',import.meta.url),'utf8');
  assert.match(sql,/create table if not exists public\.document_extractions/i);
  assert.match(sql,/create table if not exists public\.document_extracted_fields/i);
  assert.match(sql,/alter table public\.document_extractions force row level security/i);
  assert.match(sql,/revoke all on public\.document_extractions,public\.document_extracted_fields from public,anon,authenticated/i);
  assert.match(sql,/grant select on public\.document_extractions,public\.document_extracted_fields to authenticated/i);
  assert.doesNotMatch(sql,/grant (?:insert|update|delete)[^;]+authenticated/i);
  assert.match(sql,/Extraction source must match the immutable document byte version/i);
  assert.match(sql,/Document extraction source is immutable/i);
  assert.doesNotMatch(sql,/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
});
