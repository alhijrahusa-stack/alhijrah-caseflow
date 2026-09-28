alter table public.client_preferences
  add column if not exists shift_period text,
  add column if not exists auto_dispatched_at timestamptz;

create or replace function public.cg_shift_period(p_hours text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  m text[];
  h integer;
begin
  m := regexp_match(coalesce(p_hours, ''), '(^|[^0-9])([01]?[0-9]|2[0-3]):[0-5][0-9]');
  if m is null then
    return 'unspecified';
  end if;
  h := m[2]::integer;
  if h < 12 then
    return 'morning';
  end if;
  return 'evening';
end;
$$;

update public.client_preferences
set shift_period = public.cg_shift_period(hours),
    auto_dispatched_at = coalesce(auto_dispatched_at, created_at, now())
where shift_period is null or auto_dispatched_at is null;

alter table public.client_preferences
  alter column shift_period set default 'unspecified',
  alter column shift_period set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_preferences_shift_period_check'
      and conrelid = 'public.client_preferences'::regclass
  ) then
    alter table public.client_preferences
      add constraint client_preferences_shift_period_check
      check (shift_period in ('morning', 'evening', 'unspecified'));
  end if;
end $$;

create or replace function public.dispatch_client_preference()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.shift_period := public.cg_shift_period(new.hours);
  if tg_op = 'INSERT'
     or new.site_code is distinct from old.site_code
     or new.shift_code is distinct from old.shift_code
     or new.hours is distinct from old.hours then
    new.auto_dispatched_at := now();
  else
    new.auto_dispatched_at := coalesce(new.auto_dispatched_at, old.auto_dispatched_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists client_preferences_dispatch on public.client_preferences;
create trigger client_preferences_dispatch
before insert or update of site_code, shift_code, hours
on public.client_preferences
for each row execute function public.dispatch_client_preference();

create or replace function public.notify_client_dispatch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_notify(
    'career_gate_dispatch',
    json_build_object(
      'client_id', new.client_id,
      'site_code', new.site_code,
      'site_name', new.site_name,
      'shift_code', new.shift_code,
      'shift_period', new.shift_period,
      'auto_dispatched_at', new.auto_dispatched_at
    )::text
  );
  return new;
end;
$$;

drop trigger if exists client_preferences_dispatch_notify on public.client_preferences;
create trigger client_preferences_dispatch_notify
after insert or update of site_code, shift_code, hours, shift_period
on public.client_preferences
for each row execute function public.notify_client_dispatch();

create index if not exists client_preferences_dispatch_idx
  on public.client_preferences (site_code, shift_period, preference_order, client_id)
  where rank = 'primary';

create index if not exists client_preferences_client_dispatch_idx
  on public.client_preferences (client_id, rank, preference_order, shift_period);

create or replace function public.career_gate_location_boards()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with chosen as (
  select distinct on (p.client_id)
         p.client_id,
         p.site_code,
         p.site_name,
         p.site_address,
         p.shift_code,
         p.shift_name,
         p.days,
         p.hours,
         p.shift_period,
         p.auto_dispatched_at
  from public.client_preferences p
  join public.clients c on c.id = p.client_id and c.deleted_at is null
  where p.rank = 'primary'
  order by p.client_id, p.preference_order, p.created_at
),
locations as (
  select site_code,
         max(site_name) as site_name,
         max(site_address) as site_address
  from chosen
  group by site_code
)
select coalesce(
  jsonb_agg(
    jsonb_build_object(
      'site_code', l.site_code,
      'site_name', l.site_name,
      'site_address', l.site_address,
      'morning', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'client_id', c.id,
            'ref', c.ref,
            'full_name', c.full_name,
            'phone', c.phone,
            'pipeline_stage', c.pipeline_stage,
            'assigned_staff', c.assigned_staff,
            'shift_code', ch.shift_code,
            'shift_name', ch.shift_name,
            'days', ch.days,
            'hours', ch.hours,
            'auto_dispatched_at', ch.auto_dispatched_at
          ) order by c.updated_at desc
        )
        from chosen ch
        join public.clients c on c.id = ch.client_id
        where ch.site_code = l.site_code and ch.shift_period = 'morning'
      ), '[]'::jsonb),
      'evening', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'client_id', c.id,
            'ref', c.ref,
            'full_name', c.full_name,
            'phone', c.phone,
            'pipeline_stage', c.pipeline_stage,
            'assigned_staff', c.assigned_staff,
            'shift_code', ch.shift_code,
            'shift_name', ch.shift_name,
            'days', ch.days,
            'hours', ch.hours,
            'auto_dispatched_at', ch.auto_dispatched_at
          ) order by c.updated_at desc
        )
        from chosen ch
        join public.clients c on c.id = ch.client_id
        where ch.site_code = l.site_code and ch.shift_period = 'evening'
      ), '[]'::jsonb),
      'unspecified', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'client_id', c.id,
            'ref', c.ref,
            'full_name', c.full_name,
            'phone', c.phone,
            'pipeline_stage', c.pipeline_stage,
            'assigned_staff', c.assigned_staff,
            'shift_code', ch.shift_code,
            'shift_name', ch.shift_name,
            'days', ch.days,
            'hours', ch.hours,
            'auto_dispatched_at', ch.auto_dispatched_at
          ) order by c.updated_at desc
        )
        from chosen ch
        join public.clients c on c.id = ch.client_id
        where ch.site_code = l.site_code and ch.shift_period = 'unspecified'
      ), '[]'::jsonb)
    ) order by l.site_code
  ),
  '[]'::jsonb
)
from locations l;
$$;

revoke all on function public.career_gate_location_boards() from public;
grant execute on function public.career_gate_location_boards() to authenticated;
