-- Secure delete / trash / restore.
--
-- Additive and reversible in meaning: nothing existing is rewritten, no column
-- changes type, and no delete rule on any existing foreign key is touched.
--
-- Deletion is modelled as its own state, deliberately separate from archiving.
-- `archived_at` is an operational state a case or document legitimately reaches
-- and stays visible in its own views; `deleted_at` means the record has left
-- the active system and now lives in Trash. Reusing `archived_at` would have
-- swept every already-archived record into Trash on the day this shipped, so
-- the two stay distinct.
--
-- `purged_at` records a permanent delete. It is a tombstone, not a row
-- removal, and that is forced by the database itself: public.cases carries
-- cases_prevent_hard_delete, case_events is append-only and references cases
-- with NO ACTION, and public.clients cascades into documents, alerts, tasks,
-- client_access and more. A raw DELETE on a client would therefore destroy
-- document rows and strand their R2 objects. Permanent delete is implemented
-- as content destruction plus an identifying tombstone so the audit trail can
-- still answer "this existed, and it was destroyed on this date by this user".

begin;

alter table public.clients add column if not exists deleted_at timestamptz;
alter table public.clients add column if not exists deleted_by uuid;
alter table public.clients add column if not exists deleted_reason text;
alter table public.clients add column if not exists purged_at timestamptz;
alter table public.clients add column if not exists purged_by uuid;

alter table public.cases add column if not exists deleted_at timestamptz;
alter table public.cases add column if not exists deleted_by uuid;
alter table public.cases add column if not exists deleted_reason text;
alter table public.cases add column if not exists purged_at timestamptz;
alter table public.cases add column if not exists purged_by uuid;

alter table public.documents add column if not exists deleted_at timestamptz;
alter table public.documents add column if not exists deleted_by uuid;
alter table public.documents add column if not exists deleted_reason text;
alter table public.documents add column if not exists purged_at timestamptz;
alter table public.documents add column if not exists purged_by uuid;

-- The Trash ledger.
--
-- It intentionally carries no foreign key to clients, cases or documents. A
-- cascading key would delete the very record of a deletion, and a restricting
-- key would block the purge it is meant to describe. The ledger has to outlive
-- the resource, so the link is by id plus a snapshot of the canonical context
-- as it stood at the moment of deletion.
create table if not exists public.trash_entries (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('client', 'case', 'document')),
  -- Images and superseded document versions are documents. The facet keeps
  -- them filterable in Trash without inventing tables that do not exist.
  resource_facet text not null default 'record' check (resource_facet in ('record', 'image', 'version')),
  resource_id uuid not null,
  client_id uuid,
  case_id uuid,
  client_number text,
  case_number text,
  display_name text not null,
  content_type text,
  deleted_by uuid,
  deleted_by_label text,
  deleted_reason text,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz,
  restored_by uuid,
  purged_at timestamptz,
  purged_by uuid,
  legal_hold_at_deletion boolean not null default false,
  retention_record_type text,
  request_id uuid
);

-- One live entry per resource. This is what makes a repeated delete idempotent
-- rather than a way to stack duplicate rows in Trash.
create unique index if not exists trash_entries_active_unique_idx
  on public.trash_entries (resource_type, resource_id)
  where restored_at is null and purged_at is null;

create index if not exists trash_entries_deleted_at_idx on public.trash_entries (deleted_at desc);
create index if not exists trash_entries_type_idx on public.trash_entries (resource_type, deleted_at desc);
create index if not exists trash_entries_client_idx on public.trash_entries (client_id, deleted_at desc);
create index if not exists trash_entries_case_idx on public.trash_entries (case_id, deleted_at desc);
create index if not exists trash_entries_actor_idx on public.trash_entries (deleted_by, deleted_at desc);

-- Active-view lookups read "not deleted" far more often than they read Trash,
-- so the partial indexes cover the common direction.
create index if not exists clients_active_idx on public.clients (created_at desc) where deleted_at is null;
create index if not exists cases_active_idx on public.cases (updated_at desc) where deleted_at is null;
create index if not exists documents_active_case_idx on public.documents (case_id, created_at desc) where deleted_at is null;

-- Same posture as every other table: reachable only through the service role.
alter table public.trash_entries enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trash_entries' and policyname = 'trash_entries_server_only'
  ) then
    create policy trash_entries_server_only on public.trash_entries
      as restrictive for all to anon, authenticated using (false) with check (false);
  end if;
end;
$$;

revoke all on public.trash_entries from anon, authenticated;

commit;
