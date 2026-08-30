import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('staff forms migration is additive, server-only, idempotent and syntactically valid for policies',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260829010000_staff_forms_platform.sql',import.meta.url),'utf8');
  for(const destructive of [/\bdrop\s+(table|column|constraint|trigger|function)\b/i,/\btruncate\b/i,/\bdelete\s+from\b/i])assert.doesNotMatch(sql,destructive);
  assert.doesNotMatch(sql,/create\s+restrictive\s+policy/i);
  assert.doesNotMatch(sql,/\$(?:f|b)\$/i);
  assert.doesNotMatch(sql,/execute\s+\$(?:f|b)\$/i);
  assert.doesNotMatch(sql,/using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql,/with\s+check\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql,/on\s+delete\s+cascade/i);
  assert.match(sql,/create or replace function public\.protect_form_instance_pin\(\)\s+returns trigger\s+language plpgsql\s+set search_path = public\s+as \$\$/i);
  assert.match(sql,/where tgname = 'protect_form_instance_pin_trigger'\s+and tgrelid = 'public\.form_instances'::regclass\s+and not tgisinternal/i);
  assert.match(sql,/create trigger protect_form_instance_pin_trigger\s+before update on public\.form_instances\s+for each row\s+execute function public\.protect_form_instance_pin\(\);/i);
  const tables=['person_history_records','family_relationships','participant_match_reviews','form_registry','form_versions','form_definitions','form_instances','form_rules','form_answers','form_findings','background_jobs','generated_artifacts','ai_review_runs','ai_findings','controlled_document_templates','form_update_alerts'];
  for(const table of tables){
    assert.match(sql,new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(sql,new RegExp(`alter table public\\.${table} force row level security;`));
    assert.match(sql,new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`));
    assert.match(sql,new RegExp(`grant select, insert, update on table public\\.${table} to service_role;`));
    assert.match(sql,new RegExp(`create policy ${table}_server_only on public\\.${table} as restrictive for all to anon, authenticated using \\(false\\) with check \\(false\\);`));
  }
  assert.match(sql,/on delete restrict/i);
  assert.match(sql,/on delete set null/i);
});
