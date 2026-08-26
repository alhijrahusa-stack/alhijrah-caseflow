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
  resource_id uuid not null,
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
    check (resource_type in ('case', 'client'));
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
  on public.record_access_grants(subject_type, subject_id, resource_type, resource_id, effect);

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
-- Stop cascade deletes from erasing the audit trail.
--
-- core_platform makes audit_events and case_events append-only against UPDATE
-- and DELETE, but case_events still referenced cases with ON DELETE CASCADE:
-- a single `delete from cases` would take the history with it, through the
-- foreign key rather than through a blocked DELETE. For a matter file that has
-- to survive audit, the history outranks cascading cleanup.
-- ---------------------------------------------------------------------------
do $$
declare
  fk text;
begin
  select conname into fk from pg_constraint
  where conrelid = 'public.case_events'::regclass and contype = 'f'
    and confrelid = 'public.cases'::regclass
  limit 1;
  if fk is not null then execute format('alter table public.case_events drop constraint %I', fk); end if;
  alter table public.case_events
    add constraint case_events_case_id_fkey
    foreign key (case_id) references public.cases(id) on delete restrict;
exception when duplicate_object then null;
end $$;

do $$
declare
  fk text;
begin
  select conname into fk from pg_constraint
  where conrelid = 'public.documents'::regclass and contype = 'f'
    and confrelid = 'public.cases'::regclass
  limit 1;
  if fk is not null then execute format('alter table public.documents drop constraint %I', fk); end if;
  alter table public.documents
    add constraint documents_case_id_fkey
    foreign key (case_id) references public.cases(id) on delete restrict;
exception when duplicate_object then null;
end $$;

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

commit;
