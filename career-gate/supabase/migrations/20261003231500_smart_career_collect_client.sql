create table if not exists public.client_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('CSV','XLSX','GOOGLE_SHEETS','MOBILE')),
  source_file_hash text,
  created_by uuid not null references public.staff(id),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.client_import_cases (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.client_import_batches(id) on delete cascade,
  source_type text not null check (source_type in ('CSV','XLSX','GOOGLE_SHEETS','MOBILE')),
  source_row integer,
  status text not null default 'PENDING' check (status in ('PENDING','UNDER_REVIEW','MISSING_DOCUMENT','APPROVED_FILE')),
  raw_input jsonb not null default '{}'::jsonb,
  mapped_draft jsonb not null default '{}'::jsonb,
  missing_fields jsonb not null default '[]'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  field_evidence jsonb not null default '[]'::jsonb,
  verification_result jsonb not null default '{}'::jsonb,
  reviewer_id uuid references public.staff(id),
  review_started_at timestamptz,
  reviewed_at timestamptz,
  document_match_confirmed boolean not null default false,
  information_match_confirmed boolean not null default false,
  approved_by uuid references public.staff(id),
  approved_at timestamptz,
  created_client_id uuid unique references public.clients(id),
  created_by uuid not null references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'APPROVED_FILE') = (created_client_id is not null)),
  check (approved_at is null or approved_by is not null)
);

create table if not exists public.client_import_documents (
  id uuid primary key default gen_random_uuid(),
  import_case_id uuid not null references public.client_import_cases(id) on delete cascade,
  storage_reference text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  sha256 text not null,
  detected_document_type text,
  extraction_metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid not null references public.staff(id),
  created_at timestamptz not null default now(),
  unique(import_case_id, sha256)
);

create index if not exists client_import_cases_status_created_idx on public.client_import_cases(status, created_at desc);
create index if not exists client_import_cases_reviewer_idx on public.client_import_cases(reviewer_id, status, created_at desc) where reviewer_id is not null;
create index if not exists client_import_cases_batch_idx on public.client_import_cases(batch_id, source_row);
create index if not exists client_import_cases_created_client_idx on public.client_import_cases(created_client_id) where created_client_id is not null;
create index if not exists client_import_documents_case_idx on public.client_import_documents(import_case_id, created_at);
create index if not exists client_import_batches_created_idx on public.client_import_batches(created_at desc);
create index if not exists client_import_batches_source_idx on public.client_import_batches(source_type, created_at desc);

alter table public.client_import_batches enable row level security;
alter table public.client_import_cases enable row level security;
alter table public.client_import_documents enable row level security;

revoke all on public.client_import_batches from anon;
revoke all on public.client_import_cases from anon;
revoke all on public.client_import_documents from anon;

grant select, insert, update, delete on public.client_import_batches to authenticated;
grant select, insert, update, delete on public.client_import_cases to authenticated;
grant select, insert, update, delete on public.client_import_documents to authenticated;

drop policy if exists client_import_batches_management on public.client_import_batches;
create policy client_import_batches_management on public.client_import_batches
  for all to authenticated
  using (public.cg_staff_role() in ('admin','manager'))
  with check (public.cg_staff_role() in ('admin','manager'));

drop policy if exists client_import_cases_management on public.client_import_cases;
create policy client_import_cases_management on public.client_import_cases
  for all to authenticated
  using (public.cg_staff_role() in ('admin','manager'))
  with check (public.cg_staff_role() in ('admin','manager'));

drop policy if exists client_import_documents_management on public.client_import_documents;
create policy client_import_documents_management on public.client_import_documents
  for all to authenticated
  using (public.cg_staff_role() in ('admin','manager'))
  with check (public.cg_staff_role() in ('admin','manager'));

revoke truncate, references, trigger on public.client_import_batches from authenticated;
revoke truncate, references, trigger on public.client_import_cases from authenticated;
revoke truncate, references, trigger on public.client_import_documents from authenticated;

create or replace function public.cg_client_import_touch()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.cg_client_import_touch() from public, anon, authenticated;

drop trigger if exists client_import_cases_touch on public.client_import_cases;
create trigger client_import_cases_touch before update on public.client_import_cases
for each row execute function public.cg_client_import_touch();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'client_import_cases'
  ) then
    alter publication supabase_realtime add table public.client_import_cases;
  end if;
end $$;
