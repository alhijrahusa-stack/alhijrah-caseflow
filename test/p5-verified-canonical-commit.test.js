import test from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';

test('P5 canonical commits are atomic, human-reviewed, versioned, RLS-scoped, and source-pinned',()=>{
  const sql=fs.readFileSync(new URL('../supabase/migrations/20260830170000_verified_canonical_commit_layer.sql',import.meta.url),'utf8');
  assert.match(sql,/create table if not exists public\.verified_canonical_fields/i);
  assert.match(sql,/create or replace function public\.commit_verified_identity_extraction/i);
  assert.match(sql,/security definer set search_path=public,pg_temp/i);
  assert.match(sql,/where id=p_extraction_id for update/i);
  assert.match(sql,/extraction\.status<>'reviewing'/i);
  assert.match(sql,/proposal\.reviewed_value is distinct from new\.field_value/i);
  assert.match(sql,/source_sha256/i);
  assert.match(sql,/status='superseded'/i);
  assert.match(sql,/alter table public\.verified_canonical_fields force row level security/i);
  assert.match(sql,/revoke all on public\.verified_canonical_fields from public,anon,authenticated/i);
  assert.match(sql,/revoke all on function public\.commit_verified_identity_extraction\(uuid,text,uuid,jsonb\) from public,anon/i);
  assert.doesNotMatch(sql,/grant (?:insert|update|delete)[^;]+verified_canonical_fields[^;]+authenticated/i);
  assert.doesNotMatch(sql,/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
});
