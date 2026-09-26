import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('document extraction evidence is readable by scoped managers and reviewers while canonical commit stays review-only',()=>{
  const sql=fs.readFileSync(new URL('../supabase/migrations/20260904130000_document_review_authorization.sql',import.meta.url),'utf8');
  assert.match(sql,/drop policy if exists document_extractions_read_floor/i);
  assert.match(sql,/caseflow_can_case\(case_id,'documents\.manage'\)[\s\S]*or public\.caseflow_can_case\(case_id,'documents\.review'\)/i);
  assert.match(sql,/drop policy if exists document_extracted_fields_read_floor/i);
  assert.match(sql,/caseflow_can_case\(e\.case_id,'documents\.manage'\)[\s\S]*or public\.caseflow_can_case\(e\.case_id,'documents\.review'\)/i);
  assert.doesNotMatch(sql,/commit_verified_identity_extraction\s*\(/i);
  assert.doesNotMatch(sql,/using\s*\(\s*true\s*\)/i);
});
