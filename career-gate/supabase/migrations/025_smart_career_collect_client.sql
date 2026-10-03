-- Career Gate 025: Smart Career Collect Client staging.
-- Additive staging only. Canonical clients remain authoritative and are created only after approval.

create table public.client_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('csv','xlsx','google_sheets','mobile','legacy')),
  source_file_hash text not null check (source_file_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (length(btrim(idempotency_key)) between 8 and 200),
  created_by uuid not null references public.staff(id) on delete restrict,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create unique index client_import_batches_idempotency_uidx
  on public.client_import_batches(created_by, idempotency_key);
create index client_import_batches_created_idx
  on public.client_import_batches(created_at desc);
create index client_import_batches_source_idx
  on public.client_import_batches(source_type, created_at desc);

create table public.client_import_cases (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.client_import_batches(id) on delete restrict,
  source_type text not null check (source_type in ('csv','xlsx','google_sheets','mobile','legacy')),
  source_row integer check (source_row is null or source_row > 0),
  status text not null default 'PENDING' check (status in ('PENDING','UNDER_REVIEW','MISSING_DOCUMENT','APPROVED_FILE')),
  raw_input jsonb not null default '{}'::jsonb,
  mapped_draft jsonb not null default '{}'::jsonb,
  missing_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_fields) = 'array'),
  conflicts jsonb not null default '[]'::jsonb check (jsonb_typeof(conflicts) = 'array'),
  field_evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(field_evidence) = 'array'),
  verification_result jsonb not null default '{}'::jsonb check (jsonb_typeof(verification_result) = 'object'),
  reviewer_id uuid references public.staff(id) on delete restrict,
  review_started_at timestamptz,
  reviewed_at timestamptz,
  document_match_confirmed boolean not null default false,
  information_match_confirmed boolean not null default false,
  approved_by uuid references public.staff(id) on delete restrict,
  approved_at timestamptz,
  created_client_id uuid references public.clients(id) on delete restrict,
  created_by uuid not null references public.staff(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_import_cases_review_started_ck check (review_started_at is null or reviewer_id is not null),
  constraint client_import_cases_approved_ck check (
    status <> 'APPROVED_FILE'
    or (
      reviewer_id is not null
      and review_started_at is not null
      and reviewed_at is not null
      and document_match_confirmed
      and information_match_confirmed
      and approved_by is not null
      and approved_at is not null
      and created_client_id is not null
    )
  )
);

create index client_import_cases_status_idx
  on public.client_import_cases(status, created_at desc);
create index client_import_cases_created_idx
  on public.client_import_cases(created_at desc, id desc);
create index client_import_cases_reviewer_idx
  on public.client_import_cases(reviewer_id, created_at desc) where reviewer_id is not null;
create index client_import_cases_batch_idx
  on public.client_import_cases(batch_id, source_row);
create unique index client_import_cases_created_client_uidx
  on public.client_import_cases(created_client_id) where created_client_id is not null;

create table public.client_import_documents (
  id uuid primary key default gen_random_uuid(),
  import_case_id uuid not null references public.client_import_cases(id) on delete restrict,
  storage_reference text not null unique check (length(btrim(storage_reference)) > 0),
  original_filename text not null check (length(btrim(original_filename)) > 0),
  mime_type text not null check (length(btrim(mime_type)) > 0),
  size_bytes integer not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  detected_document_type text,
  extraction_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(extraction_metadata) = 'object'),
  uploaded_by uuid not null references public.staff(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index client_import_documents_case_idx
  on public.client_import_documents(import_case_id, created_at);

create or replace function public.cg_client_import_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger client_import_cases_touch
before update on public.client_import_cases
for each row execute function public.cg_client_import_touch();

create or replace function public.cg_client_import_case_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'APPROVED_FILE' then
    if new.status <> 'APPROVED_FILE'
       or new.created_client_id is distinct from old.created_client_id
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at then
      raise exception 'client_import_approved_is_terminal' using errcode = 'P0001';
    end if;
  end if;

  if old.status = 'PENDING' and new.status not in ('PENDING','UNDER_REVIEW') then
    raise exception 'client_import_invalid_transition' using errcode = 'P0001';
  end if;
  if old.status = 'UNDER_REVIEW' and new.status not in ('UNDER_REVIEW','MISSING_DOCUMENT','APPROVED_FILE') then
    raise exception 'client_import_invalid_transition' using errcode = 'P0001';
  end if;
  if old.status = 'MISSING_DOCUMENT' and new.status not in ('MISSING_DOCUMENT','UNDER_REVIEW','APPROVED_FILE') then
    raise exception 'client_import_invalid_transition' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger client_import_cases_state_guard
before update on public.client_import_cases
for each row execute function public.cg_client_import_case_guard();

alter table public.client_import_batches enable row level security;
alter table public.client_import_cases enable row level security;
alter table public.client_import_documents enable row level security;

-- Staging is server-mediated only. Staff APIs authorize the verified Career Gate session;
-- anon/authenticated cannot read or mutate staging directly through PostgREST.
revoke all on table public.client_import_batches from anon, authenticated;
revoke all on table public.client_import_cases from anon, authenticated;
revoke all on table public.client_import_documents from anon, authenticated;

create policy client_import_batches_direct_api_deny on public.client_import_batches
for all to anon, authenticated using (false) with check (false);
create policy client_import_cases_direct_api_deny on public.client_import_cases
for all to anon, authenticated using (false) with check (false);
create policy client_import_documents_direct_api_deny on public.client_import_documents
for all to anon, authenticated using (false) with check (false);

revoke execute on function public.cg_client_import_touch() from public, anon, authenticated;
revoke execute on function public.cg_client_import_case_guard() from public, anon, authenticated;
