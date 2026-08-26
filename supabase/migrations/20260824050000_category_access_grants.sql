-- 20260824050000 — Authorization schema convergence and practice-area grants.
--
-- Production recovery note:
-- 20260824040000 was reported as executed, but none of its four canonical
-- public authorization tables reached the database. Because 040 is enclosed
-- in one transaction and fully qualifies every object with public, that state
-- cannot be a partial application or a different-schema outcome. This forward
-- migration therefore converges the canonical schema without renaming,
-- replacing, truncating or deleting any object or row.
--
-- Safe to run after a successful 040 or after the observed rolled-back/missing
-- 040 state. Every object has one canonical public name and every operation is
-- additive and idempotent.

begin;

-- Canonical authorization objects required by the running application.
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

create unique index if not exists access_policies_subject_key
  on public.access_policies(subject_type, subject_id);

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

-- Converge an earlier compatible table in place.
alter table public.record_access_grants add column if not exists resource_key text;

-- Constraints are added NOT VALID first: existing production rows are never
-- rewritten. They are validated when compliant and otherwise remain enforced
-- for every new or changed row pending explicit review of preserved history.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.access_policies'::regclass
      and conname = 'access_policies_subject_type_check'
  ) then
    alter table public.access_policies
      add constraint access_policies_subject_type_check
      check (subject_type in ('role', 'team', 'user')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.record_access_grants'::regclass
      and conname = 'record_access_grants_subject_type_check'
  ) then
    alter table public.record_access_grants
      add constraint record_access_grants_subject_type_check
      check (subject_type in ('user', 'team')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.record_access_grants'::regclass
      and conname = 'record_access_grants_resource_type_check'
  ) then
    alter table public.record_access_grants
      add constraint record_access_grants_resource_type_check
      check (resource_type in ('case', 'client', 'category', 'service')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.record_access_grants'::regclass
      and conname = 'record_access_grants_target_check'
  ) then
    alter table public.record_access_grants
      add constraint record_access_grants_target_check
      check (
        (resource_type in ('case', 'client') and resource_id is not null and resource_key is null)
        or
        (resource_type in ('category', 'service') and resource_id is null
          and resource_key is not null and btrim(resource_key) <> '')
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.record_access_grants'::regclass
      and conname = 'record_access_grants_effect_check'
  ) then
    alter table public.record_access_grants
      add constraint record_access_grants_effect_check
      check (effect in ('grant', 'restrict')) not valid;
  end if;
end;
$$;

do $$
declare
  constraint_name text;
begin
  foreach constraint_name in array array[
    'access_policies_subject_type_check',
    'record_access_grants_subject_type_check',
    'record_access_grants_resource_type_check',
    'record_access_grants_target_check',
    'record_access_grants_effect_check'
  ]
  loop
    begin
      if constraint_name = 'access_policies_subject_type_check' then
        execute format('alter table public.access_policies validate constraint %I', constraint_name);
      else
        execute format('alter table public.record_access_grants validate constraint %I', constraint_name);
      end if;
    exception when check_violation then
      raise notice 'Constraint % remains NOT VALID because preserved rows require review', constraint_name;
    end;
  end loop;
end;
$$;

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

-- Remaining additive 040 objects. These are no-ops where 040 persisted.
alter table public.cases
  add column if not exists team_id uuid references public.teams(id) on delete set null;
create index if not exists cases_team_id_idx on public.cases(team_id);

alter table public.documents add column if not exists deleted_at timestamptz;
alter table public.documents add column if not exists deleted_by uuid;
create index if not exists documents_live_idx
  on public.documents(case_id) where deleted_at is null;

alter table public.cases add column if not exists filing_deadline date;
create index if not exists cases_filing_deadline_idx
  on public.cases(filing_deadline) where filing_deadline is not null;

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

create index if not exists audit_events_access_idx
  on public.audit_events(entity_type, created_at desc)
  where entity_type in ('access_policy', 'record_access_grant', 'team', 'team_member', 'client_access');

-- Data API boundary: only the application server receives table privileges.
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.access_policies enable row level security;
alter table public.record_access_grants enable row level security;

revoke all on public.teams, public.team_members, public.access_policies,
  public.record_access_grants from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete
  on public.teams, public.team_members, public.access_policies,
  public.record_access_grants to service_role;

do $$
declare
  protected_table text;
begin
  foreach protected_table in array array[
    'teams', 'team_members', 'access_policies', 'record_access_grants'
  ]
  loop
    if not exists (
      select 1 from pg_policies
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

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

notify pgrst, 'reload schema';

commit;
