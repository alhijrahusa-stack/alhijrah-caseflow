import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const authorizationMigration = new URL(
  '../supabase/migrations/20260824040000_authorization_model.sql',
  import.meta.url,
);
const categoryGrantMigration = new URL(
  '../supabase/migrations/20260824050000_category_access_grants.sql',
  import.meta.url,
);
const phase1Migration = new URL(
  '../supabase/migrations/20260827010000_phase1_platform.sql',
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

test('category-grant migration converges a missing authorization migration safely', async () => {
  const sql = (await readFile(categoryGrantMigration, 'utf8'))
    .replace(/\s+/g, ' ')
    .toLowerCase();

  for (const table of ['teams', 'team_members', 'access_policies', 'record_access_grants']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
  }

  assert.match(sql, /alter table public\.record_access_grants add column if not exists resource_key text;/);
  assert.match(sql, /revoke all on public\.teams, public\.team_members, public\.access_policies, public\.record_access_grants from anon, authenticated;/);
  assert.match(sql, /grant select, insert, update, delete on public\.teams, public\.team_members, public\.access_policies, public\.record_access_grants to service_role;/);
  assert.match(sql, /notify pgrst, 'reload schema';/);
  assert.doesNotMatch(sql, /\b(drop|truncate|delete from|update public\.)\b/);
});

test('Phase 1 migration is additive, server-only, and assigns immutable unique identifiers', async () => {
  const sql = (await readFile(phase1Migration, 'utf8')).replace(/\s+/g, ' ').toLowerCase();

  assert.match(sql, /create sequence if not exists public\.client_number_sequence/);
  assert.match(sql, /create sequence if not exists public\.case_number_sequence/);
  assert.match(sql, /create unique index if not exists clients_client_number_unique_idx/);
  assert.match(sql, /create unique index if not exists cases_case_number_unique_idx/);
  assert.match(sql, /create trigger clients_assign_number before insert/);
  assert.match(sql, /create trigger cases_assign_number before insert/);
  assert.match(sql, /raise exception '% is immutable'/);
  assert.match(sql, /to_jsonb\(old\) ->> number_column/);
  assert.match(sql, /to_jsonb\(new\) ->> number_column/);
  assert.doesNotMatch(sql, /old\.(client_number|case_number)/);
  assert.doesNotMatch(sql, /new\.(client_number|case_number) is distinct from old\.(client_number|case_number)/);
  assert.match(sql, /where client_number is null/);
  assert.match(sql, /where case_number is null/);
  for (const table of ['office_settings', 'communication_templates', 'outbound_communications']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /revoke all on public\.office_settings, public\.communication_templates, public\.outbound_communications from anon, authenticated/);
  assert.match(sql, /grant select, insert, update on public\.office_settings to service_role/);
  assert.match(sql, /grant select on public\.communication_templates to service_role/);
  assert.match(sql, /grant select, insert, update on public\.outbound_communications to service_role/);
  assert.doesNotMatch(sql, /grant [^;]*delete/);
  assert.doesNotMatch(sql, /\b(drop|truncate|delete from)\b/);
});
