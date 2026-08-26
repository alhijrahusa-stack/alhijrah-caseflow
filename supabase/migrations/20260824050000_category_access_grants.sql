-- 20260824050000 — record grants addressed to a practice area.
--
-- Extends 20260824040000 so the Owner can authorise a staff member for a
-- whole case category (or a single service code) rather than enumerating
-- every case. case/client targets stay addressed by uuid; category/service
-- targets are text, so they need their own column.
--
-- NON-DESTRUCTIVE. Adds one nullable column and relaxes two constraints.
-- No row is written, altered or deleted, so no existing grant changes meaning
-- and nobody's effective access moves.
--
-- Forward-only and idempotent.

begin;

alter table public.record_access_grants add column if not exists resource_key text;

-- resource_id was NOT NULL because every target used to be a uuid. A category
-- target has no uuid, so the column becomes nullable and a check enforces that
-- exactly the right identifier is present for the target kind.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'record_access_grants'
      and column_name = 'resource_id' and is_nullable = 'NO'
  ) then
    alter table public.record_access_grants alter column resource_id drop not null;
  end if;
end $$;

alter table public.record_access_grants drop constraint if exists record_access_grants_resource_type_check;
do $$
begin
  alter table public.record_access_grants
    add constraint record_access_grants_resource_type_check
    check (resource_type in ('case', 'client', 'category', 'service'));
exception
  when duplicate_object then null;
  when check_violation then
    raise notice 'record_access_grants_resource_type_check not applied: existing rows hold other values';
end $$;

do $$
begin
  alter table public.record_access_grants
    add constraint record_access_grants_target_check
    check (
      (resource_type in ('case', 'client') and resource_id is not null)
      or (resource_type in ('category', 'service') and resource_key is not null and btrim(resource_key) <> '')
    );
exception
  when duplicate_object then null;
  when check_violation then
    raise notice 'record_access_grants_target_check not applied: existing rows do not satisfy it';
end $$;

-- The old uniqueness index only covered uuid targets. Replace it with one that
-- treats the two target shapes as a single key, so a grant cannot be recorded
-- twice for the same subject and resource.
drop index if exists public.record_access_grants_unique;
create unique index if not exists record_access_grants_unique
  on public.record_access_grants(
    subject_type,
    subject_id,
    resource_type,
    coalesce(resource_id::text, resource_key),
    effect
  );

commit;
