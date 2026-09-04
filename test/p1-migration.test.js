import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync(new URL('../supabase/migrations/20260830120000_p0_p1_security_hardening.sql',import.meta.url),'utf8');

test('P1 throttle migration is additive, atomic, private, and service-role only',()=>{
  assert.match(migration,/^begin;/i);assert.match(migration,/commit;\s*$/i);
  assert.doesNotMatch(migration,/\b(drop table|truncate|delete from\s+public\.(clients|cases|documents)|alter table\s+public\.(clients|cases|documents))\b/i);
  assert.match(migration,/alter table public\.security_login_throttles enable row level security/i);
  assert.match(migration,/alter table public\.security_login_throttles force row level security/i);
  assert.match(migration,/as restrictive[\s\S]*to anon, authenticated[\s\S]*using \(false\)[\s\S]*with check \(false\)/i);
  assert.match(migration,/security definer[\s\S]*on conflict \(key_hash\) do update/i);
  assert.match(migration,/revoke all on function public\.consume_login_attempt[\s\S]*from public, anon, authenticated/i);
  assert.match(migration,/grant execute on function public\.consume_login_attempt[\s\S]*to service_role/i);
});
