do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'client_preferences'
  ) then
    alter publication supabase_realtime add table public.client_preferences;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'client_accounts'
  ) then
    alter publication supabase_realtime add table public.client_accounts;
  end if;
end $$;
