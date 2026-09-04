import test from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260830190000_hybrid_discovery_review_integrity.sql',import.meta.url),'utf8');
test('P7 pins review inputs and makes AI evidence immutable',()=>{assert.match(sql,/input_snapshot_sha256/);assert.match(sql,/AI finding evidence and claim are immutable/);assert.match(sql,/AI finding participant is outside its case/);assert.match(sql,/AI finding form is outside its case/);assert.doesNotMatch(sql,/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i)});
