import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('confirmed extraction finalizes document, request, and review task in one database transaction',()=>{
  const sql=fs.readFileSync(new URL('../supabase/migrations/20260904140000_atomic_document_review_convergence.sql',import.meta.url),'utf8');
  assert.match(sql,/create trigger document_extractions_finalize_source[\s\S]*after update of status on public\.document_extractions/i);
  assert.match(sql,/update public\.documents set[\s\S]*automation_status='VERIFIED'[\s\S]*review_status='approved'/i);
  assert.match(sql,/create trigger documents_sync_review_dependents[\s\S]*after update of review_status on public\.documents/i);
  assert.match(sql,/update public\.document_requests set[\s\S]*status=new\.review_status/i);
  assert.match(sql,/update public\.tasks set[\s\S]*status=case when new\.review_status='approved' then 'completed'/i);
  assert.match(sql,/security definer set search_path=public,pg_temp/i);
  assert.match(sql,/revoke all on function public\.sync_document_review_dependents\(\) from public,anon,authenticated/i);
  assert.match(sql,/revoke all on function public\.finalize_confirmed_document_extraction\(\) from public,anon,authenticated/i);
});
