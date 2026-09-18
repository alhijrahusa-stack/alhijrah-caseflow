import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../supabase/migrations/20260830180000_deterministic_form_engine.sql',import.meta.url),'utf8');

test('P6 migration pins provenance and preserves immutable answer history',()=>{
  assert.match(sql,/verified_canonical_field_id uuid references public\.verified_canonical_fields/);
  assert.match(sql,/fact\.field_value is distinct from new\.answer_value/);
  assert.match(sql,/canonical_value_sha256<>encode\(digest/);
  assert.match(sql,/form answer revision history is immutable/i);
  assert.match(sql,/update public\.form_instances set revision=revision\+1/);
});

test('P6 answer history uses forced least-privilege RLS',()=>{
  assert.match(sql,/alter table public\.form_answer_revisions enable row level security/);
  assert.match(sql,/alter table public\.form_answer_revisions force row level security/);
  assert.match(sql,/revoke all on public\.form_answer_revisions from public,anon,authenticated/);
  assert.doesNotMatch(sql,/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql,/grant\s+(insert|update|delete|all).*authenticated/i);
});
