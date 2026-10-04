-- Career Gate 026: Smart Client Import v3 additive identity/lifecycle support.
-- Business workflow statuses remain unchanged. This migration adds only scoped
-- import metadata required for human-readable case identity and soft lifecycle actions.

create sequence if not exists public.client_import_case_number_seq;

create or replace function public.cg_next_client_import_case_number()
returns text
language sql
volatile
set search_path = public, pg_temp
as $$
  select 'CG-' || to_char(current_timestamp, 'YYMM') || '-' || lpad(nextval('public.client_import_case_number_seq')::text, 5, '0');
$$;

alter table public.client_import_cases
  add column if not exists case_number text,
  add column if not exists fingerprint text,
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.client_import_cases
  alter column case_number set default public.cg_next_client_import_case_number();

update public.client_import_cases
set case_number = public.cg_next_client_import_case_number()
where case_number is null;

alter table public.client_import_cases
  alter column case_number set not null;

create unique index if not exists client_import_cases_case_number_uidx
  on public.client_import_cases(case_number);

create index if not exists client_import_cases_fingerprint_idx
  on public.client_import_cases(fingerprint, created_at desc)
  where fingerprint is not null and deleted_at is null;

create index if not exists client_import_cases_queue_v3_idx
  on public.client_import_cases(status, archived_at, deleted_at, created_at desc, id desc);

alter table public.client_import_cases
  drop constraint if exists client_import_cases_case_number_format_ck;
alter table public.client_import_cases
  add constraint client_import_cases_case_number_format_ck
  check (case_number ~ '^CG-[0-9]{4}-[0-9A-Z]{5,}$');

comment on column public.client_import_cases.case_number is
  'Stable non-PII human-readable Smart Client Import identifier allocated server-side.';
comment on column public.client_import_cases.fingerprint is
  'Non-display normalized identity fingerprint for duplicate advisory checks; distinct from idempotency_key.';
comment on column public.client_import_cases.archived_at is
  'Soft archive timestamp. Archived imports remain retained and auditable.';
comment on column public.client_import_cases.deleted_at is
  'Soft delete timestamp for import staging records only; canonical client data is never deleted here.';

revoke execute on function public.cg_next_client_import_case_number() from public, anon, authenticated;
