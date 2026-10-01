-- Financial domain evolution.
-- Preserve client_accounts as the existing service/account identity while moving
-- financial history to an append-only ledger and commissions to independent,
-- versioned-rule records.

begin;

alter table public.client_accounts
  add column if not exists service_code text not null default 'career_gate_employment_support',
  add column if not exists due_date date,
  add column if not exists account_note text;

create table if not exists public.account_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.client_accounts(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  transaction_type text not null check (transaction_type in (
    'charge','payment','refund','adjustment_debit','adjustment_credit','waiver','reversal_debit','reversal_credit'
  )),
  amount numeric(12,2) not null check (amount > 0),
  payment_method text check (payment_method is null or payment_method in ('zelle','bank_transfer','cash','card','other')),
  transaction_reference text,
  receipt_document_id uuid references public.documents(id) on delete set null,
  related_transaction_id uuid references public.account_transactions(id) on delete restrict,
  occurred_at timestamptz not null,
  note text,
  idempotency_key text not null unique,
  recorded_by uuid references public.staff(id),
  source text not null default 'staff' check (source in ('staff','migration','automation','provider','system')),
  trace_id text,
  created_at timestamptz not null default now(),
  check (account_id is not null and client_id is not null)
);

create index if not exists account_transactions_account_time_idx
  on public.account_transactions(account_id,occurred_at,id);
create index if not exists account_transactions_client_time_idx
  on public.account_transactions(client_id,occurred_at desc);
create index if not exists account_transactions_related_idx
  on public.account_transactions(related_transaction_id) where related_transaction_id is not null;

-- Ledger rows are immutable. Corrections are new adjustment/reversal rows.
create or replace function public.reject_account_transaction_mutation()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  raise exception 'account_transactions is append-only; post an adjustment or reversal';
end;
$$;

drop trigger if exists account_transactions_append_only on public.account_transactions;
create trigger account_transactions_append_only
before update or delete on public.account_transactions
for each row execute function public.reject_account_transaction_mutation();

create or replace function public.validate_account_transaction()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_client uuid;
  v_related record;
begin
  select client_id into v_client from public.client_accounts where id=new.account_id;
  if v_client is null or v_client <> new.client_id then
    raise exception 'account/client mismatch';
  end if;

  if new.transaction_type='payment' and new.payment_method is null then
    raise exception 'payment requires payment_method';
  end if;

  if new.related_transaction_id is not null then
    select account_id,client_id,transaction_type,amount into v_related
      from public.account_transactions where id=new.related_transaction_id;
    if v_related is null or v_related.account_id <> new.account_id or v_related.client_id <> new.client_id then
      raise exception 'related transaction must belong to the same account and client';
    end if;
    if new.amount > v_related.amount then
      raise exception 'related transaction amount exceeds source transaction';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists account_transactions_validate on public.account_transactions;
create trigger account_transactions_validate
before insert on public.account_transactions
for each row execute function public.validate_account_transaction();

-- Deterministic backfill: one original service charge per existing account.
insert into public.account_transactions(
  account_id,client_id,transaction_type,amount,occurred_at,idempotency_key,recorded_by,source,note
)
select a.id,a.client_id,'charge',a.fee_amount,a.created_at,'legacy-charge:'||a.id::text,a.updated_by,'migration','Backfilled from client_accounts fee'
from public.client_accounts a
where a.fee_amount > 0
on conflict(idempotency_key) do nothing;

-- Preserve confirmed legacy payment facts. Do not invent transaction references.
insert into public.account_transactions(
  account_id,client_id,transaction_type,amount,payment_method,receipt_document_id,occurred_at,idempotency_key,recorded_by,source,note
)
select a.id,a.client_id,'payment',a.fee_amount,a.payment_method,a.receipt_document_id,
       coalesce(a.paid_at,a.payment_date::timestamptz,a.updated_at),
       'legacy-payment:'||a.id::text,a.updated_by,'migration','Backfilled from confirmed client_accounts payment'
from public.client_accounts a
where a.payment_status in ('paid','refunded') and a.fee_amount > 0 and a.payment_method is not null
on conflict(idempotency_key) do nothing;

-- A legacy refunded account means the prior payment was returned. Preserve both
-- facts instead of deleting or mutating the payment.
insert into public.account_transactions(
  account_id,client_id,transaction_type,amount,related_transaction_id,occurred_at,idempotency_key,recorded_by,source,note
)
select a.id,a.client_id,'refund',a.fee_amount,p.id,a.updated_at,
       'legacy-refund:'||a.id::text,a.updated_by,'migration','Backfilled from refunded client_accounts state'
from public.client_accounts a
join public.account_transactions p on p.idempotency_key='legacy-payment:'||a.id::text
where a.payment_status='refunded' and a.fee_amount > 0
on conflict(idempotency_key) do nothing;

create or replace view public.client_account_balances
with (security_invoker = true)
as
select
  a.id as account_id,
  a.client_id,
  a.service_code,
  a.due_date,
  coalesce(sum(case
    when t.transaction_type in ('charge','refund','adjustment_debit','reversal_debit') then t.amount
    when t.transaction_type in ('payment','adjustment_credit','waiver','reversal_credit') then -t.amount
    else 0 end),0)::numeric(12,2) as balance,
  coalesce(sum(t.amount) filter(where t.transaction_type='charge'),0)::numeric(12,2) as total_charged,
  coalesce(sum(t.amount) filter(where t.transaction_type='payment'),0)::numeric(12,2) as total_paid,
  coalesce(sum(t.amount) filter(where t.transaction_type='refund'),0)::numeric(12,2) as total_refunded,
  case
    when coalesce(sum(case
      when t.transaction_type in ('charge','refund','adjustment_debit','reversal_debit') then t.amount
      when t.transaction_type in ('payment','adjustment_credit','waiver','reversal_credit') then -t.amount
      else 0 end),0) <= 0 then
      case when coalesce(sum(t.amount) filter(where t.transaction_type='refund'),0) > 0 then 'refunded' else 'paid' end
    when coalesce(sum(t.amount) filter(where t.transaction_type='payment'),0) > 0 then 'partially_paid'
    when a.due_date is not null and a.due_date < (now() at time zone 'America/Detroit')::date then 'overdue'
    else 'unpaid'
  end as payment_status
from public.client_accounts a
left join public.account_transactions t on t.account_id=a.id
group by a.id,a.client_id,a.service_code,a.due_date;

revoke all on public.client_account_balances from public,anon;
grant select on public.client_account_balances to authenticated;

alter table public.account_transactions enable row level security;
drop policy if exists account_transactions_staff_read on public.account_transactions;
drop policy if exists account_transactions_management_insert on public.account_transactions;
create policy account_transactions_staff_read on public.account_transactions
  for select to authenticated using (public.cg_can_access_client(client_id));
create policy account_transactions_management_insert on public.account_transactions
  for insert to authenticated with check (
    public.cg_staff_role() in ('admin','manager') and public.cg_can_access_client(client_id)
  );
grant select,insert on public.account_transactions to authenticated;
revoke update,delete on public.account_transactions from authenticated;

-- Versioned commission rules. Existing zero-value staff commission settings are
-- preserved in staff but are not fabricated into active rules.
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null check (length(trim(rule_key)) > 0),
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','active','retired')),
  commission_type text not null check (commission_type in ('fixed','percent')),
  commission_value numeric(12,2) not null check (commission_value >= 0),
  trigger_event text not null check (length(trim(trigger_event)) > 0),
  conditions jsonb not null default '{}'::jsonb,
  eligible_roles text[] not null default array[]::text[],
  eligible_staff uuid[] not null default array[]::uuid[],
  approval_required boolean not null default true,
  effective_from timestamptz,
  effective_to timestamptz,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(rule_key,version),
  check (effective_to is null or effective_from is null or effective_to > effective_from)
);
create unique index if not exists commission_rules_one_active_idx
  on public.commission_rules(rule_key) where status='active';

create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid references public.client_accounts(id) on delete restrict,
  employee_id uuid not null references public.staff(id) on delete restrict,
  rule_id uuid not null references public.commission_rules(id) on delete restrict,
  trigger_event text not null,
  trigger_event_id text not null,
  basis_amount numeric(12,2) not null default 0 check (basis_amount >= 0),
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending','eligible','approved','paid','cancelled','reversed')),
  eligible_at timestamptz,
  approved_by uuid references public.staff(id),
  approved_at timestamptz,
  paid_at timestamptz,
  payment_reference text,
  cancelled_by uuid references public.staff(id),
  cancelled_at timestamptz,
  cancel_reason text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id,employee_id,rule_id,trigger_event_id),
  check ((status='approved') = (approved_at is not null) or status <> 'approved'),
  check (status <> 'paid' or (paid_at is not null and nullif(trim(coalesce(payment_reference,'')),'') is not null)),
  check (status not in ('cancelled','reversed') or (cancelled_at is not null and nullif(trim(coalesce(cancel_reason,'')),'') is not null))
);

create index if not exists commissions_employee_status_idx on public.commissions(employee_id,status,created_at desc);
create index if not exists commissions_client_idx on public.commissions(client_id,created_at desc);
create index if not exists commissions_account_idx on public.commissions(account_id) where account_id is not null;

create or replace function public.guard_commission_identity()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='UPDATE' and (
    new.client_id <> old.client_id or
    new.employee_id <> old.employee_id or
    new.rule_id <> old.rule_id or
    new.trigger_event <> old.trigger_event or
    new.trigger_event_id <> old.trigger_event_id or
    new.basis_amount <> old.basis_amount or
    new.amount <> old.amount
  ) then
    raise exception 'commission financial identity is immutable; cancel/reverse and create a new record';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists commissions_identity_guard on public.commissions;
create trigger commissions_identity_guard
before update on public.commissions
for each row execute function public.guard_commission_identity();

alter table public.commission_rules enable row level security;
alter table public.commissions enable row level security;

drop policy if exists commission_rules_staff_read on public.commission_rules;
drop policy if exists commission_rules_admin_write on public.commission_rules;
create policy commission_rules_staff_read on public.commission_rules
  for select to authenticated using (public.cg_staff_id() is not null);
create policy commission_rules_admin_write on public.commission_rules
  for all to authenticated using (public.cg_staff_role()='admin') with check (public.cg_staff_role()='admin');

drop policy if exists commissions_staff_read on public.commissions;
drop policy if exists commissions_management_insert on public.commissions;
drop policy if exists commissions_management_update on public.commissions;
create policy commissions_staff_read on public.commissions
  for select to authenticated using (
    employee_id=public.cg_staff_id() or public.cg_staff_role() in ('admin','manager')
  );
create policy commissions_management_insert on public.commissions
  for insert to authenticated with check (public.cg_staff_role() in ('admin','manager'));
create policy commissions_management_update on public.commissions
  for update to authenticated using (public.cg_staff_role() in ('admin','manager'))
  with check (public.cg_staff_role() in ('admin','manager'));

grant select on public.commission_rules to authenticated;
grant insert,update on public.commission_rules to authenticated;
revoke delete on public.commission_rules from authenticated;
grant select,insert,update on public.commissions to authenticated;
revoke delete on public.commissions from authenticated;

commit;
