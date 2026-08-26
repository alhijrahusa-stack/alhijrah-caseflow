-- 20260824050000 — record grants addressed to a practice area.
--
-- Extends 20260824040000 so the Owner can authorise a staff member for a
-- whole case category (or a single service code) rather than enumerating
-- every case. case/client targets stay addressed by uuid; category/service
-- targets are text, so they need their own column.
--
-- NON-DESTRUCTIVE. Ensures the nullable key column, checks and uniqueness
-- index created by the preceding authorization migration. No row is written,
-- altered or deleted, so no existing grant changes meaning and nobody's
-- effective access moves.
--
-- Forward-only and idempotent.

begin;

alter table public.record_access_grants add column if not exists resource_key text;

-- The preceding authorization migration creates the final nullable identifier
-- shape and complete checks. These guarded statements keep this migration
-- independently idempotent without dropping or rewriting existing objects.
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
      (resource_type in ('case', 'client') and resource_id is not null and resource_key is null)
      or (resource_type in ('category', 'service') and resource_id is null and resource_key is not null and btrim(resource_key) <> '')
    );
exception
  when duplicate_object then null;
  when check_violation then
    raise notice 'record_access_grants_target_check not applied: existing rows do not satisfy it';
end $$;

-- Both target shapes share one key, preventing duplicate grants.
create unique index if not exists record_access_grants_unique
  on public.record_access_grants(
    subject_type,
    subject_id,
    resource_type,
    coalesce(resource_id::text, resource_key),
    effect
  );

notify pgrst, 'reload schema';

commit;
