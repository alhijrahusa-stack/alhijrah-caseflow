begin;

alter table public.client_import_cases
  add column revision bigint not null default 1 check (revision > 0);

create function public.cg_client_import_revision()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.revision := old.revision + 1;
  return new;
end
$$;

create trigger client_import_cases_revision
before update on public.client_import_cases
for each row execute function public.cg_client_import_revision();

revoke execute on function public.cg_client_import_revision() from public, anon, authenticated;

commit;
