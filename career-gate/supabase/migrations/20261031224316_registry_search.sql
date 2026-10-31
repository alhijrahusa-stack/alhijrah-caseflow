-- Indexed multilingual search over canonical identity and already retained extraction fields.
-- No additional OCR/source text or private document bytes are retained by this migration.
create or replace function career_gate_private.normalize_search(value text)
returns text language sql immutable parallel safe strict security invoker
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    pg_catalog.translate(pg_catalog.lower(value), 'أإآٱى', 'ااااي'),
    '[ـً-ٰٟۖ-ۭ]', '', 'g'
  )
$$;
revoke all on function career_gate_private.normalize_search(text) from public, anon;
grant execute on function career_gate_private.normalize_search(text) to authenticated, service_role;

create index clients_normalized_name_trgm on public.clients
  using gin (career_gate_private.normalize_search(full_name) gin_trgm_ops)
  where deleted_at is null;
create index document_extractions_search_trgm on public.document_extractions
  using gin (career_gate_private.normalize_search(fields::text) gin_trgm_ops)
  where status='succeeded';
create index document_extractions_client_succeeded on public.document_extractions(client_id)
  where status='succeeded';

-- Saved filters belong to one active staff account, including management accounts.
create table public.staff_saved_filters (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  filters jsonb not null check (jsonb_typeof(filters)='object' and pg_column_size(filters)<=4096),
  created_at timestamptz not null default now(),
  unique(staff_id,name)
);
alter table public.staff_saved_filters enable row level security;
revoke all on public.staff_saved_filters from public, anon;
grant select,insert,update,delete on public.staff_saved_filters to authenticated;
grant all on public.staff_saved_filters to service_role;
create policy staff_saved_filters_read on public.staff_saved_filters for select to authenticated
  using (staff_id=(select public.cg_staff_id()));
create policy staff_saved_filters_insert on public.staff_saved_filters for insert to authenticated
  with check (staff_id=(select public.cg_staff_id()));
create policy staff_saved_filters_update on public.staff_saved_filters for update to authenticated
  using (staff_id=(select public.cg_staff_id())) with check (staff_id=(select public.cg_staff_id()));
create policy staff_saved_filters_delete on public.staff_saved_filters for delete to authenticated
  using (staff_id=(select public.cg_staff_id()));
