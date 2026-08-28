begin;

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  file_type text not null check (file_type in ('csv','xlsx')),
  file_checksum text not null,
  status text not null default 'uploaded' check (status in ('uploaded','mapped','validated','review_required','approved','processing','completed','failed')),
  headers jsonb not null default '[]'::jsonb,
  field_mapping jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  total_rows integer not null default 0 check (total_rows >= 0),
  processed_rows integer not null default 0 check (processed_rows >= 0),
  created_clients integer not null default 0 check (created_clients >= 0),
  created_cases integer not null default 0 check (created_cases >= 0),
  skipped_rows integer not null default 0 check (skipped_rows >= 0),
  failed_rows integer not null default 0 check (failed_rows >= 0),
  uploaded_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete restrict,
  source_row_number integer not null check (source_row_number > 1),
  source_row jsonb not null,
  normalized_row jsonb not null default '{}'::jsonb,
  validation_errors jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  duplicate_classification text not null default 'new' check (duplicate_classification in ('exact','possible','new')),
  duplicate_candidates jsonb not null default '[]'::jsonb,
  review_action text check (review_action in ('approve','skip','merge')),
  merge_client_id uuid references public.clients(id) on delete restrict,
  row_status text not null default 'uploaded' check (row_status in ('uploaded','valid','review_required','approved','processing','completed','skipped','failed')),
  result_client_id uuid references public.clients(id) on delete restrict,
  result_case_id uuid references public.cases(id) on delete restrict,
  result_client_number text,
  result_case_number text,
  error_message text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, source_row_number)
);

create unique index if not exists import_batches_checksum_uploader_idx on public.import_batches(file_checksum, uploaded_by);
create index if not exists import_batches_status_idx on public.import_batches(status, updated_at);
create index if not exists import_rows_batch_status_idx on public.import_rows(batch_id, row_status, source_row_number);
create index if not exists import_rows_merge_client_idx on public.import_rows(merge_client_id) where merge_client_id is not null;
create index if not exists import_rows_result_client_idx on public.import_rows(result_client_id) where result_client_id is not null;
create index if not exists import_rows_result_case_idx on public.import_rows(result_case_id) where result_case_id is not null;

alter table public.clients add column if not exists import_batch_id uuid references public.import_batches(id) on delete restrict;
alter table public.clients add column if not exists import_row_id uuid references public.import_rows(id) on delete restrict;
alter table public.cases add column if not exists import_batch_id uuid references public.import_batches(id) on delete restrict;
alter table public.cases add column if not exists import_row_id uuid references public.import_rows(id) on delete restrict;
alter table public.deadlines add column if not exists client_visible boolean not null default false;
alter table public.invoices add column if not exists client_visible boolean not null default false;
alter table public.alerts add column if not exists client_visible boolean not null default false;

create index if not exists clients_import_batch_idx on public.clients(import_batch_id) where import_batch_id is not null;
create index if not exists cases_import_batch_idx on public.cases(import_batch_id) where import_batch_id is not null;

alter table public.import_batches enable row level security;
alter table public.import_batches force row level security;
alter table public.import_rows enable row level security;
alter table public.import_rows force row level security;

revoke all on table public.import_batches from public, anon, authenticated;
revoke all on table public.import_rows from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update on table public.import_batches to service_role;
grant select, insert, update on table public.import_rows to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'import_batches'
      and policyname = 'import_batches_server_only'
  ) then
    execute $policy$
      create policy import_batches_server_only
      on public.import_batches
      as restrictive
      for all
      to anon, authenticated
      using (false)
      with check (false)
    $policy$;
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'import_rows'
      and policyname = 'import_rows_server_only'
  ) then
    execute $policy$
      create policy import_rows_server_only
      on public.import_rows
      as restrictive
      for all
      to anon, authenticated
      using (false)
      with check (false)
    $policy$;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
