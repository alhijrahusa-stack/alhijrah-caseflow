-- Realtime for smart import cases.
--
-- The staff client file and the import review surfaces derive an affected
-- resource from each row change. Import cases were the one entity in that
-- graph with no realtime publication, so an import change could only be seen
-- through a full route refresh. Adding the table closes that gap.
--
-- Additive and idempotent. RLS still applies to postgres_changes subscribers:
-- publication membership grants no read a policy does not already allow.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'client_import_cases'
    ) then
      alter publication supabase_realtime add table public.client_import_cases;
    end if;
  end if;
end $$;
