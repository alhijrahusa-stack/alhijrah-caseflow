-- Finance application boundary and derived status semantics.

begin;

create or replace view public.client_account_balances
with (security_invoker = true)
as
with totals as (
  select
    a.id account_id,
    a.client_id,
    a.service_code,
    a.due_date,
    coalesce(sum(case
      when t.transaction_type in ('charge','refund','adjustment_debit','reversal_debit') then t.amount
      when t.transaction_type in ('payment','adjustment_credit','waiver','reversal_credit') then -t.amount
      else 0 end),0)::numeric(12,2) balance,
    coalesce(sum(t.amount) filter(where t.transaction_type='charge'),0)::numeric(12,2) total_charged,
    coalesce(sum(t.amount) filter(where t.transaction_type='payment'),0)::numeric(12,2) total_paid,
    coalesce(sum(t.amount) filter(where t.transaction_type='refund'),0)::numeric(12,2) total_refunded
  from public.client_accounts a
  left join public.account_transactions t on t.account_id=a.id
  group by a.id,a.client_id,a.service_code,a.due_date
)
select
  t.*,
  case
    when t.total_paid > 0 and t.total_refunded >= t.total_paid then 'refunded'
    when t.balance <= 0 then 'paid'
    when t.total_paid > t.total_refunded then 'partially_paid'
    when t.due_date is not null and t.due_date < (now() at time zone 'America/Detroit')::date then 'overdue'
    else 'unpaid'
  end as payment_status
from totals t;

revoke all on public.client_account_balances from public,anon;
grant select on public.client_account_balances to authenticated;

insert into public.permission_rules(role,resource,action,scope) values
  ('admin','account','record_payment','ALL'),
  ('manager','account','record_payment','ALL'),
  ('staff','account','record_payment','NONE'),
  ('admin','account','record_refund','ALL'),
  ('manager','account','record_refund','ALL'),
  ('staff','account','record_refund','NONE'),
  ('admin','account','record_adjustment','ALL'),
  ('manager','account','record_adjustment','ALL'),
  ('staff','account','record_adjustment','NONE'),
  ('admin','account','record_waiver','ALL'),
  ('manager','account','record_waiver','ALL'),
  ('staff','account','record_waiver','NONE'),
  ('admin','commission','manage_commission_rules','ALL'),
  ('manager','commission','manage_commission_rules','NONE'),
  ('staff','commission','manage_commission_rules','NONE'),
  ('admin','commission','approve_commission','ALL'),
  ('manager','commission','approve_commission','ALL'),
  ('staff','commission','approve_commission','NONE'),
  ('admin','commission','mark_commission_paid','ALL'),
  ('manager','commission','mark_commission_paid','ALL'),
  ('staff','commission','mark_commission_paid','NONE')
on conflict(role,resource,action) do update set scope=excluded.scope,updated_at=now();

commit;
