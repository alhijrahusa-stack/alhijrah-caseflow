begin;

alter table public.staff
  add column if not exists permission_mode text not null default 'full'
    check (permission_mode in ('full', 'custom')),
  add column if not exists custom_permissions text[] not null default '{}'::text[];

create or replace function public.cg_update_staff_permissions(
  p_target_staff_id uuid,
  p_permission_mode text,
  p_custom_permissions text[],
  p_expected_updated_at timestamptz,
  p_trace_id text
) returns table(permission_mode text, custom_permissions text[], updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := public.cg_staff_id();
  actor_role text := public.cg_staff_role();
  target_role text;
  old_mode text;
  old_permissions text[];
begin
  if actor_id is null or actor_role not in ('admin', 'manager') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_permission_mode not in ('full', 'custom') then
    raise exception 'INVALID_PERMISSION_MODE' using errcode = 'P0001';
  end if;

  select s.role, s.permission_mode, s.custom_permissions
    into target_role, old_mode, old_permissions
  from public.staff s
  where s.id = p_target_staff_id and s.active
  for update;

  if target_role is null then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;
  if target_role <> 'staff' then
    raise exception 'STAFF_PERMISSION_TARGET_REQUIRED' using errcode = 'P0001';
  end if;

  update public.staff s
     set permission_mode = p_permission_mode,
         custom_permissions = case
           when p_permission_mode = 'full' then '{}'::text[]
           else coalesce((select array_agg(distinct p order by p) from unnest(coalesce(p_custom_permissions, '{}'::text[])) p), '{}'::text[])
         end
   where s.id = p_target_staff_id
     and s.updated_at = p_expected_updated_at
  returning s.permission_mode, s.custom_permissions, s.updated_at
       into permission_mode, custom_permissions, updated_at;

  if not found then
    raise exception 'STAFF_PERMISSION_CONFLICT' using errcode = 'P0001';
  end if;

  insert into public.security_events(event, staff_id, route, detail, trace_id)
  values(
    'staff_permissions_changed',
    actor_id,
    '/api/staff/operations',
    jsonb_build_object(
      'target_staff_id', p_target_staff_id,
      'old_mode', old_mode,
      'new_mode', permission_mode,
      'old_permissions', to_jsonb(coalesce(old_permissions, '{}'::text[])),
      'new_permissions', to_jsonb(custom_permissions)
    ),
    p_trace_id
  );

  return next;
end;
$$;

revoke all on function public.cg_update_staff_permissions(uuid,text,text[],timestamptz,text) from public;
grant execute on function public.cg_update_staff_permissions(uuid,text,text[],timestamptz,text) to authenticated;

commit;
