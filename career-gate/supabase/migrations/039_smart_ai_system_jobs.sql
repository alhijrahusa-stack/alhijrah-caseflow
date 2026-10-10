begin;

-- 039 — Auditable Smart Client AI extraction telemetry.
-- Additive only. The browser never reads or writes this table directly.

create table if not exists public.system_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  status text not null,
  import_case_id uuid references public.client_import_cases(id) on delete cascade,
  source_name text,
  provider text not null,
  confidence jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid not null references public.staff(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint system_jobs_status_ck check (status in ('COMPLETED','FAILED')),
  constraint system_jobs_job_type_ck check (length(trim(job_type)) > 0)
);

create index if not exists system_jobs_import_case_idx
  on public.system_jobs(import_case_id, created_at desc);
create index if not exists system_jobs_type_status_idx
  on public.system_jobs(job_type, status, created_at desc);

alter table public.system_jobs enable row level security;
revoke all on table public.system_jobs from anon, authenticated;
create policy system_jobs_direct_api_deny on public.system_jobs
for all to anon, authenticated using (false) with check (false);

commit;
