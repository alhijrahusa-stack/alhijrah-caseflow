import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const filename=new URL('../supabase/migrations/20260830140000_immutable_document_versioning.sql',import.meta.url);
const migration=fs.readFileSync(filename,'utf8');

test('immutable document versioning extends the canonical document model without replacement tables',()=>{
  assert.match(migration,/create or replace function public\.protect_document_byte_version\(\)/i);
  assert.match(migration,/before insert or update or delete on public\.documents/i);
  assert.match(migration,/documents_one_replacement_idx/i);
  assert.match(migration,/verified SHA-256 checksum is required/i);
  assert.doesNotMatch(migration,/create table/i);
  assert.doesNotMatch(migration,/\b(drop table|truncate|delete from)\b/i);
  assert.doesNotMatch(migration,/disable row level security/i);
});
