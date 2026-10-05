begin;

alter table public.client_import_cases
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.staff(id);

commit;
