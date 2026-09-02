import test from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260901130000_dual_case_portals.sql',import.meta.url),'utf8').toLowerCase();
test('dual portal migration is case scoped, participant bound and fail closed',()=>{
  assert.match(sql,/create table if not exists public\.portal_case_access/);
  assert.match(sql,/alter table public\.portal_case_access enable row level security/);
  assert.match(sql,/alter table public\.portal_case_access force row level security/);
  assert.match(sql,/beneficiary portal person must participate in the case/);
  assert.match(sql,/role_code not in \('client_owner','client_collaborator','employer_portal','beneficiary_portal'\)/);
  assert.match(sql,/portal_case_access p where p\.case_id=c\.id/);
  assert.doesNotMatch(sql,/create or replace function public\.caseflow_can_client/);
  assert.doesNotMatch(sql,/using\s*\(\s*true\s*\)/);
  assert.doesNotMatch(sql,/on delete cascade|drop table|truncate/);
});
