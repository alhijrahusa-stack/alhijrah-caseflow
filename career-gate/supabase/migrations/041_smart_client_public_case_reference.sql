-- Stable public case reference for Smart Client intake and pre-approval status access.
-- The same CG reference is carried into clients.ref on approval.

alter table public.client_import_cases
  add column if not exists public_ref text;

update public.client_import_cases
set public_ref = public.next_client_ref()
where public_ref is null;

alter table public.client_import_cases
  alter column public_ref set default public.next_client_ref(),
  alter column public_ref set not null;

alter table public.client_import_cases
  drop constraint if exists client_import_cases_public_ref_ck;

alter table public.client_import_cases
  add constraint client_import_cases_public_ref_ck
  check (public_ref ~ '^CG-[0-9]{4}-[0-9]{6}$');

create unique index if not exists client_import_cases_public_ref_uidx
  on public.client_import_cases (upper(public_ref));

alter table public.otp_requests
  add column if not exists import_case_id uuid
  references public.client_import_cases(id) on delete cascade;

create index if not exists otp_requests_import_case_id_idx
  on public.otp_requests(import_case_id);

alter table public.status_sessions
  add column if not exists import_case_id uuid
  references public.client_import_cases(id) on delete cascade;

alter table public.status_sessions
  alter column client_id drop not null;

alter table public.status_sessions
  drop constraint if exists status_sessions_subject_ck;

alter table public.status_sessions
  add constraint status_sessions_subject_ck
  check (num_nonnulls(client_id, import_case_id) = 1);

create index if not exists status_sessions_import_case_id_idx
  on public.status_sessions(import_case_id);
