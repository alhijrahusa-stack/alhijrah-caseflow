-- Reconciled from live Supabase migration 20260929021651 operations_data_view.
begin;

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

commit;
