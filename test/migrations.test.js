import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const authorizationMigration = new URL(
  '../supabase/migrations/20260824040000_authorization_model.sql',
  import.meta.url,
);

test('authorization tables are exposed only to the server Data API role', async () => {
  const sql = (await readFile(authorizationMigration, 'utf8'))
    .replace(/\s+/g, ' ')
    .toLowerCase();

  assert.match(sql, /revoke all on public\.teams, public\.team_members, public\.access_policies, public\.record_access_grants from anon, authenticated;/);
  assert.match(sql, /grant usage on schema public to service_role;/);
  assert.match(sql, /grant select, insert, update, delete on public\.teams, public\.team_members, public\.access_policies, public\.record_access_grants to service_role;/);

  for (const table of ['teams', 'team_members', 'access_policies', 'record_access_grants']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
  }
});
