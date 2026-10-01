-- Reconcile verified Career Gate production changes that existed in Supabase
-- after the canonical Git migration chain. This migration is idempotent so it
-- can be applied safely to the existing production database and can reproduce
-- the same schema in a fresh environment after migration 013.

begin;

alter table public.client_preferences
  add column if not exists dispatch_mode text not null default 'auto',
  add column if not exists manual_dispatch_at timestamptz,
  add column if not exists manual_dispatch_by uuid references public.staff(id);

alter table public.client_preferences
  drop constraint if exists client_preferences_shift_period_check;

alter table public.client_preferences
  add constraint client_preferences_shift_period_check
  check (shift_period in ('morning', 'evening', 'night', 'needs_manual_review'));

alter table public.client_preferences
  drop constraint if exists client_preferences_dispatch_mode_check;

alter table public.client_preferences
  add constraint client_preferences_dispatch_mode_check
  check (dispatch_mode in ('auto', 'manual'));

create or replace function public.cg_shift_period(
  p_site_code text,
  p_shift_code text,
  p_shift_name text,
  p_hours text
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  code text := upper(trim(coalesce(p_shift_code, '')));
  name text := lower(trim(coalesce(p_shift_name, '')));
  m text[];
  h integer;
  marker text;
begin
  if nullif(trim(coalesce(p_site_code, '')), '') is null
     or nullif(code, '') is null then
    return 'needs_manual_review';
  end if;

  if code in ('FHN', 'BHN', 'RT') or name ~ '(^|[^a-z])night([^a-z]|$)' then
    return 'night';
  end if;
  if code in ('FHD', 'BHD', 'DON') or name ~ '(^|[^a-z])day([^a-z]|$)' then
    return 'morning';
  end if;
  if code = 'RTS' or name ~ '(^|[^a-z])evening([^a-z]|$)' then
    return 'evening';
  end if;

  m := regexp_match(
    coalesce(p_hours, ''),
    '([0-9]{1,2}):[0-9]{2}[[:space:]]*(ص|م|AM|PM|am|pm)?'
  );
  if m is null then
    return 'needs_manual_review';
  end if;

  h := m[1]::integer;
  marker := lower(coalesce(m[2], ''));
  if h > 23 then
    return 'needs_manual_review';
  end if;
  if marker in ('م', 'pm') and h < 12 then h := h + 12; end if;
  if marker in ('ص', 'am') and h = 12 then h := 0; end if;

  if h >= 5 and h < 12 then return 'morning'; end if;
  if h >= 12 and h < 22 then return 'evening'; end if;
  return 'night';
end;
$$;

create or replace function public.dispatch_client_preference()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.dispatch_mode = 'manual' then
    new.auto_dispatched_at := null;
    new.manual_dispatch_at := coalesce(new.manual_dispatch_at, now());
    return new;
  end if;

  new.dispatch_mode := 'auto';
  new.manual_dispatch_at := null;
  new.manual_dispatch_by := null;
  new.shift_period := public.cg_shift_period(new.site_code, new.shift_code, new.shift_name, new.hours);

  if tg_op = 'INSERT'
     or new.site_code is distinct from old.site_code
     or new.shift_code is distinct from old.shift_code
     or new.shift_name is distinct from old.shift_name
     or new.hours is distinct from old.hours
     or new.dispatch_mode is distinct from old.dispatch_mode then
    new.auto_dispatched_at := now();
  else
    new.auto_dispatched_at := coalesce(new.auto_dispatched_at, old.auto_dispatched_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists client_preferences_dispatch on public.client_preferences;
create trigger client_preferences_dispatch
before insert or update of site_code, shift_code, shift_name, hours, dispatch_mode, shift_period
on public.client_preferences
for each row execute function public.dispatch_client_preference();

update public.client_preferences
set shift_period = public.cg_shift_period(site_code, shift_code, shift_name, hours),
    auto_dispatched_at = coalesce(auto_dispatched_at, now()),
    dispatch_mode = 'auto',
    manual_dispatch_at = null,
    manual_dispatch_by = null
where dispatch_mode = 'auto';

create index if not exists client_preferences_dispatch_mode_idx
  on public.client_preferences (site_code, shift_period, dispatch_mode, preference_order, client_id)
  where rank = 'primary';

alter table public.documents
  add column if not exists upload_key text,
  add column if not exists upload_confirmed_at timestamptz;

create unique index if not exists documents_client_upload_key_uidx
  on public.documents (client_id, upload_key)
  where upload_key is not null;

create index if not exists documents_client_uploaded_idx
  on public.documents (client_id, uploaded_at desc)
  where upload_confirmed_at is not null;

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
         p.dispatch_mode,
         p.auto_dispatched_at,
         p.manual_dispatch_at
  from public.client_preferences p
  join public.clients c on c.id = p.client_id and c.deleted_at is null
  where p.rank = 'primary'
  order by p.client_id, p.preference_order, p.created_at
),
locations as (
  select coalesce(nullif(site_code, ''), 'NEEDS-LOCATION') site_code,
         max(coalesce(nullif(site_name, ''), 'Location not selected')) site_name,
         max(site_address) site_address
  from chosen
  group by coalesce(nullif(site_code, ''), 'NEEDS-LOCATION')
)
select coalesce(jsonb_agg(
  jsonb_build_object(
    'site_code', l.site_code,
    'site_name', l.site_name,
    'site_address', l.site_address,
    'morning', coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
      select c.id client_id,c.ref,c.full_name,c.phone,c.pipeline_stage,c.assigned_staff,c.updated_at,
             ch.shift_code,ch.shift_name,ch.days,ch.hours,ch.dispatch_mode,ch.auto_dispatched_at,ch.manual_dispatch_at
      from chosen ch join public.clients c on c.id=ch.client_id
      where coalesce(nullif(ch.site_code,''),'NEEDS-LOCATION')=l.site_code and ch.shift_period='morning'
    ) x), '[]'::jsonb),
    'evening', coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
      select c.id client_id,c.ref,c.full_name,c.phone,c.pipeline_stage,c.assigned_staff,c.updated_at,
             ch.shift_code,ch.shift_name,ch.days,ch.hours,ch.dispatch_mode,ch.auto_dispatched_at,ch.manual_dispatch_at
      from chosen ch join public.clients c on c.id=ch.client_id
      where coalesce(nullif(ch.site_code,''),'NEEDS-LOCATION')=l.site_code and ch.shift_period='evening'
    ) x), '[]'::jsonb),
    'night', coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
      select c.id client_id,c.ref,c.full_name,c.phone,c.pipeline_stage,c.assigned_staff,c.updated_at,
             ch.shift_code,ch.shift_name,ch.days,ch.hours,ch.dispatch_mode,ch.auto_dispatched_at,ch.manual_dispatch_at
      from chosen ch join public.clients c on c.id=ch.client_id
      where coalesce(nullif(ch.site_code,''),'NEEDS-LOCATION')=l.site_code and ch.shift_period='night'
    ) x), '[]'::jsonb),
    'needs_manual_review', coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
      select c.id client_id,c.ref,c.full_name,c.phone,c.pipeline_stage,c.assigned_staff,c.updated_at,
             ch.shift_code,ch.shift_name,ch.days,ch.hours,ch.dispatch_mode,ch.auto_dispatched_at,ch.manual_dispatch_at
      from chosen ch join public.clients c on c.id=ch.client_id
      where coalesce(nullif(ch.site_code,''),'NEEDS-LOCATION')=l.site_code and ch.shift_period='needs_manual_review'
    ) x), '[]'::jsonb)
  ) order by l.site_code
), '[]'::jsonb)
from locations l;
$$;

revoke all on function public.career_gate_location_boards() from public;
grant execute on function public.career_gate_location_boards() to authenticated;

create or replace view public.career_gate_operations_clients
with (security_invoker = true)
as
select
  c.id,
  c.ref,
  c.full_name,
  c.phone,
  c.email,
  c.pipeline_stage,
  c.current_status,
  c.next_step,
  c.assigned_staff,
  c.created_at,
  c.updated_at,
  s.display_name as assigned_name,
  s.staff_code,
  p.site_code,
  p.site_name,
  p.site_address,
  p.shift_code,
  p.shift_name,
  p.days as shift_days,
  p.hours as shift_hours,
  p.shift_period,
  p.dispatch_mode,
  p.auto_dispatched_at,
  p.manual_dispatch_at,
  p.manual_dispatch_by,
  p.pay_snapshot,
  a.payment_status,
  a.fee_amount
from public.clients c
left join public.staff s on s.id = c.assigned_staff
left join lateral (
  select
    pref.site_code,
    pref.site_name,
    pref.site_address,
    pref.shift_code,
    pref.shift_name,
    pref.days,
    pref.hours,
    pref.shift_period,
    pref.dispatch_mode,
    pref.auto_dispatched_at,
    pref.manual_dispatch_at,
    pref.manual_dispatch_by,
    pref.pay_snapshot
  from public.client_preferences pref
  where pref.client_id = c.id
  order by case pref.rank when 'primary' then 0 else 1 end, pref.preference_order, pref.created_at
  limit 1
) p on true
left join public.client_accounts a on a.client_id = c.id
where c.deleted_at is null;

revoke all on public.career_gate_operations_clients from public;
grant select on public.career_gate_operations_clients to authenticated;

create index if not exists clients_updated_at_active_idx
  on public.clients(updated_at desc)
  where deleted_at is null;

create index if not exists client_preferences_primary_lookup_idx
  on public.client_preferences(client_id, rank, preference_order, created_at);

create table if not exists public.career_gate_email_outbox (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.career_gate_applications(id) on delete cascade,
  template_key text not null,
  recipient_email text not null,
  locale text not null check (locale in ('ar','en')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sent','delivered','bounced')),
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  unique(application_id, template_key)
);

create unique index if not exists career_gate_email_outbox_provider_message_uidx
  on public.career_gate_email_outbox(provider_message_id)
  where provider_message_id is not null;

create index if not exists career_gate_email_outbox_pending_idx
  on public.career_gate_email_outbox(created_at)
  where status = 'pending';

alter table public.career_gate_email_outbox enable row level security;
revoke all on public.career_gate_email_outbox from anon, authenticated;

commit;
