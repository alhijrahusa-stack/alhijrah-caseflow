-- 20260824040000 — Owner-controlled authorization model, plus the integrity
-- gaps 20260824030000_core_platform.sql left open.
--
-- Additive by construction. The policy tables are created EMPTY, and an empty
-- policy set resolves to global scope for staff, which is exactly the access
-- they had before. Applying this migration changes nobody's visibility;
-- narrowing anyone requires the Owner to insert a row here through the UI.
--
-- Builds on core_platform rather than duplicating it: clients, client_access,
-- case_assignments and the audit append-only triggers already exist there and
-- are reused, not redefined.
--
-- Forward-only and idempotent.

begin;

-- ---------------------------------------------------------------------------
-- Teams. The backing store for the `team` scope.
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create unique index if not exists teams_name_key on public.teams(lower(name));

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_idx on public.team_members(user_id);

alter table public.cases add column if not exists team_id uuid references public.teams(id) on delete set null;
create index if not exists cases_team_id_idx on public.cases(team_id);

-- ---------------------------------------------------------------------------
-- Access policies.
--
-- One row per subject. `grants` add permissions, `restrictions` remove them,
-- `scopes` narrows or widens per module. Subjects resolve role -> team -> user,
-- later winning, so the Owner can override a role default for one team and a
-- team decision for one person.
--
-- No rows are inserted. Absence of a row is the "unchanged" state.
-- ---------------------------------------------------------------------------
create table if not exists public.access_policies (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id text not null,
  grants text[] not null default '{}',
  restrictions text[] not null default '{}',
  scopes jsonb not null default '{}'::jsonb,
  note text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

do $$
begin
  alter table public.access_policies
    add constraint access_policies_subject_type_check
    check (subject_type in ('role', 'team', 'user'));
exception
  when duplicate_object then null;
  when check_violation then
    raise notice 'access_policies_subject_type_check not applied: existing rows hold other values';
end $$;

create unique index if not exists access_policies_subject_key
  on public.access_policies(subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- Record-level grants and restrictions.
--
-- effect='grant' hands a subject one case or client regardless of their scope;
-- effect='restrict' takes it away regardless of how wide their scope is. An
-- empty `permissions` array on a grant means "whatever this subject could
-- otherwise do with a record of this kind".
-- ---------------------------------------------------------------------------
create table if not exists public.record_access_grants (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  resource_type text not null,
  resource_id uuid,
  resource_key text,
  effect text not null,
  permissions text[] not null default '{}',
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

do $$
begin
  alter table public.record_access_grants
    add constraint record_access_grants_subject_type_check
    check (subject_type in ('user', 'team'));
exception when duplicate_object then null; when check_violation then null;
end $$;

do $$
begin
  alter table public.record_access_grants
    add constraint record_access_grants_resource_type_check
    check (resource_type in ('case', 'client', 'category', 'service'));
exception when duplicate_object then null; when check_violation then null;
end $$;

do $$
begin
  alter table public.record_access_grants
    add constraint record_access_grants_target_check
    check (
      (resource_type in ('case', 'client') and resource_id is not null and resource_key is null)
      or (resource_type in ('category', 'service') and resource_id is null and resource_key is not null and btrim(resource_key) <> '')
    );
exception when duplicate_object then null; when check_violation then null;
end $$;

do $$
begin
  alter table public.record_access_grants
    add constraint record_access_grants_effect_check
    check (effect in ('grant', 'restrict'));
exception when duplicate_object then null; when check_violation then null;
end $$;

create unique index if not exists record_access_grants_unique
  on public.record_access_grants(
    subject_type,
    subject_id,
    resource_type,
    coalesce(resource_id::text, resource_key),
    effect
  );

create index if not exists record_access_grants_subject_idx
  on public.record_access_grants(subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- Document evidence preservation.
--
-- A hard DELETE erased the record that a document ever existed, and was not
-- atomic with the R2 object delete. Soft delete keeps the row -- and therefore
-- the case history -- while the object leaves storage.
-- ---------------------------------------------------------------------------
alter table public.documents add column if not exists deleted_at timestamptz;
alter table public.documents add column if not exists deleted_by uuid;
create index if not exists documents_live_idx on public.documents(case_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Stop hard deletes from erasing the audit trail.
--
-- core_platform makes audit_events and case_events append-only against UPDATE
-- and DELETE. Cases are archived, never hard-deleted. Enforce that invariant
-- without dropping or rewriting the existing foreign keys.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_case_hard_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'cases are archive-only and cannot be hard-deleted';
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.cases'::regclass
      and tgname = 'cases_prevent_hard_delete'
      and not tgisinternal
  ) then
    execute 'create trigger cases_prevent_hard_delete before delete on public.cases for each row execute function public.prevent_case_hard_delete()';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Filing deadline is a calendar date, not an instant.
--
-- A deadline of "2026-03-01" means that day in the filing jurisdiction. Stored
-- as timestamptz it renders as the previous day west of the server, which is
-- exactly the class of error that misses a filing. The same rule applies to
-- money: numeric(12,2) or integer minor units, never float/real.
-- ---------------------------------------------------------------------------
alter table public.cases add column if not exists filing_deadline date;
create index if not exists cases_filing_deadline_idx
  on public.cases(filing_deadline) where filing_deadline is not null;

-- ---------------------------------------------------------------------------
-- RLS: same deny-all posture as every other table in this schema.
-- ---------------------------------------------------------------------------
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.access_policies enable row level security;
alter table public.record_access_grants enable row level security;

revoke all on public.teams, public.team_members, public.access_policies, public.record_access_grants
from anon, authenticated;

-- Supabase projects created with automatic Data API exposure disabled do not
-- grant newly-created tables to service_role. The application server reaches
-- Postgres exclusively through the Data API with service_role, so make that
-- server-only exposure explicit. Browser roles remain revoked above and RLS
-- remains enabled; no client credential receives access.
grant usage on schema public to service_role;
grant select, insert, update, delete
  on public.teams, public.team_members, public.access_policies, public.record_access_grants
  to service_role;

-- Direct browser access stays closed. The server uses service_role, which
-- retains its grants and bypasses RLS.
do $$
declare
  protected_table text;
begin
  foreach protected_table in array array[
    'teams', 'team_members', 'access_policies', 'record_access_grants'
  ]
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = protected_table
        and policyname = 'server_only_no_direct_access'
    ) then
      execute format(
        'create policy server_only_no_direct_access on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',
        protected_table
      );
    end if;
  end loop;
end;
$$;

-- Objects created later must not be readable by anon/authenticated by default.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Authorization changes are themselves auditable. These tables are mutable by
-- design (the Owner edits them), but every edit writes to audit_events, which
-- core_platform keeps append-only.
create index if not exists audit_events_access_idx
  on public.audit_events(entity_type, created_at desc)
  where entity_type in ('access_policy', 'record_access_grant', 'team', 'team_member', 'client_access');

notify pgrst, 'reload schema';

commit;
