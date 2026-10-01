begin;

-- ---------------------------------------------------------------------------
-- Requirements Engine: one canonical operational requirement record per client/key.
-- ---------------------------------------------------------------------------
create table if not exists public.requirements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requirement_key text not null check (length(trim(requirement_key)) > 0),
  stage text,
  title text not null check (length(trim(title)) > 0),
  why text,
  source text not null default 'workflow' check (source in ('workflow','document','task','staff','system')),
  completion_rule text,
  related_document_id uuid references public.documents(id) on delete set null,
  related_task_id uuid references public.tasks(id) on delete set null,
  due_at timestamptz,
  status text not null default 'missing' check (status in ('complete','missing','pending_review','rejected','expired','not_applicable')),
  created_by uuid references public.staff(id),
  updated_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id, requirement_key)
);
create index if not exists requirements_client_status_idx on public.requirements(client_id,status,updated_at desc);
create index if not exists requirements_due_idx on public.requirements(due_at) where status in ('missing','pending_review','rejected','expired');
create trigger requirements_touch before update on public.requirements
for each row execute function public.touch_updated_at();

alter table public.requirements enable row level security;
grant select,insert,update on public.requirements to authenticated;
create policy requirements_read on public.requirements for select to authenticated
using(public.cg_can_access_client(client_id));
create policy requirements_insert on public.requirements for insert to authenticated
with check(public.cg_can_access_client(client_id));
create policy requirements_update on public.requirements for update to authenticated
using(public.cg_can_access_client(client_id)) with check(public.cg_can_access_client(client_id));

-- Existing post-hire work becomes first-class requirements without changing its authority/history.
insert into public.requirements(client_id,requirement_key,stage,title,why,source,completion_rule,status,updated_at)
select p.client_id,
       'post_hire:' || p.item,
       'post_interview_completion',
       initcap(replace(p.item,'_',' ')),
       'Existing post-hire requirement',
       'workflow',
       'Complete the corresponding post-hire item',
       case p.status
         when 'completed' then 'complete'
         when 'not_required' then 'not_applicable'
         when 'confirmed' then 'pending_review'
         else 'missing'
       end,
       p.updated_at
from public.post_hire_items p
on conflict(client_id,requirement_key) do nothing;

create or replace function public.sync_post_hire_requirement()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.requirements(
    client_id,requirement_key,stage,title,why,source,completion_rule,status,updated_by
  ) values (
    new.client_id,
    'post_hire:' || new.item,
    'post_interview_completion',
    initcap(replace(new.item,'_',' ')),
    'Post-hire workflow requirement',
    'workflow',
    'Complete the corresponding post-hire item',
    case new.status
      when 'completed' then 'complete'
      when 'not_required' then 'not_applicable'
      when 'confirmed' then 'pending_review'
      else 'missing'
    end,
    new.staff_id
  )
  on conflict(client_id,requirement_key) do update
    set status=excluded.status,updated_by=excluded.updated_by,updated_at=now();
  return new;
end;
$$;

drop trigger if exists post_hire_requirement_sync on public.post_hire_items;
create trigger post_hire_requirement_sync
after insert or update of status,item on public.post_hire_items
for each row execute function public.sync_post_hire_requirement();

create or replace view public.client_readiness
with (security_invoker = true)
as
select c.id as client_id,
       count(r.id) filter (where r.status <> 'not_applicable')::int as total_requirements,
       count(r.id) filter (where r.status = 'complete')::int as completed_requirements,
       case
         when count(r.id) filter (where r.status <> 'not_applicable') = 0 then null
         else round(
           100.0 * count(r.id) filter (where r.status = 'complete') /
           nullif(count(r.id) filter (where r.status <> 'not_applicable'),0),
           0
         )::int
       end as readiness_percent
from public.clients c
left join public.requirements r on r.client_id=c.id
where c.deleted_at is null
group by c.id;
revoke all on public.client_readiness from public, anon;
grant select on public.client_readiness to authenticated;

-- ---------------------------------------------------------------------------
-- Immutable client payment ledger. client_accounts remains a compatibility
-- projection; financial truth is payment_transactions.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.client_accounts(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('payment','refund','adjustment','waiver')),
  direction text not null check (direction in ('credit','debit')),
  amount numeric(10,2) not null check (amount > 0),
  status text not null default 'confirmed' check (status in ('pending','confirmed','failed','voided','refunded')),
  payment_method text check (payment_method is null or payment_method in ('zelle','bank_transfer','cash','card','other')),
  occurred_at timestamptz not null default now(),
  transaction_reference text,
  receipt_document_id uuid references public.documents(id) on delete set null,
  reason text,
  source text not null default 'staff' check (source in ('staff','import','webhook','system')),
  recorded_by uuid references public.staff(id),
  idempotency_key text not null unique check(length(trim(idempotency_key)) > 0),
  created_at timestamptz not null default now(),
  check (
    (transaction_type in ('payment','waiver') and direction='credit') or
    (transaction_type='refund' and direction='debit') or
    transaction_type='adjustment'
  )
);
create index if not exists payment_transactions_account_idx on public.payment_transactions(account_id,created_at desc);
create index if not exists payment_transactions_client_idx on public.payment_transactions(client_id,created_at desc);
create trigger payment_transactions_append_only before update or delete on public.payment_transactions
for each row execute function public.reject_mutation();

alter table public.payment_transactions enable row level security;
grant select,insert on public.payment_transactions to authenticated;
create policy payment_transactions_read on public.payment_transactions for select to authenticated
using(public.cg_can_access_client(client_id));
create policy payment_transactions_insert on public.payment_transactions for insert to authenticated
with check(public.cg_staff_role() in ('admin','manager') and public.cg_can_access_client(client_id));

-- Backfill only facts already present in the legacy account projection.
insert into public.payment_transactions(
  account_id,client_id,transaction_type,direction,amount,status,payment_method,occurred_at,
  receipt_document_id,reason,source,recorded_by,idempotency_key
)
select a.id,a.client_id,'payment','credit',a.fee_amount,'confirmed',a.payment_method,
       coalesce(a.paid_at,a.payment_date::timestamptz,a.updated_at),a.receipt_document_id,
       'Backfilled from verified legacy paid account','import',a.updated_by,'legacy-payment:'||a.id::text
from public.client_accounts a
where a.payment_status in ('paid','refunded')
on conflict(idempotency_key) do nothing;

insert into public.payment_transactions(
  account_id,client_id,transaction_type,direction,amount,status,payment_method,occurred_at,
  receipt_document_id,reason,source,recorded_by,idempotency_key
)
select a.id,a.client_id,'refund','debit',a.fee_amount,'confirmed',a.payment_method,
       coalesce(a.updated_at,a.paid_at,a.payment_date::timestamptz),a.receipt_document_id,
       'Backfilled from verified legacy refunded account','import',a.updated_by,'legacy-refund:'||a.id::text
from public.client_accounts a
where a.payment_status='refunded'
on conflict(idempotency_key) do nothing;

create or replace view public.client_account_balances
with (security_invoker = true)
as
select a.id as account_id,
       a.client_id,
       a.fee_amount,
       coalesce(sum(t.amount) filter (where t.status='confirmed' and t.direction='credit' and t.transaction_type='payment'),0)::numeric(10,2) as amount_paid,
       coalesce(sum(t.amount) filter (where t.status='confirmed' and t.transaction_type='refund'),0)::numeric(10,2) as refund_amount,
       coalesce(sum(case when t.status='confirmed' and t.direction='credit' then t.amount when t.status='confirmed' and t.direction='debit' then -t.amount else 0 end),0)::numeric(10,2) as net_credits,
       (a.fee_amount - coalesce(sum(case when t.status='confirmed' and t.direction='credit' then t.amount when t.status='confirmed' and t.direction='debit' then -t.amount else 0 end),0))::numeric(10,2) as balance,
       case
         when a.payment_status='refunded' and coalesce(sum(case when t.status='confirmed' and t.direction='credit' then t.amount when t.status='confirmed' and t.direction='debit' then -t.amount else 0 end),0) <= 0 then 'refunded'
         when coalesce(sum(case when t.status='confirmed' and t.direction='credit' then t.amount when t.status='confirmed' and t.direction='debit' then -t.amount else 0 end),0) <= 0 then 'unpaid'
         when coalesce(sum(case when t.status='confirmed' and t.direction='credit' then t.amount when t.status='confirmed' and t.direction='debit' then -t.amount else 0 end),0) < a.fee_amount then 'partially_paid'
         else 'paid'
       end as payment_status
from public.client_accounts a
left join public.payment_transactions t on t.account_id=a.id
group by a.id,a.client_id,a.fee_amount,a.payment_status;
revoke all on public.client_account_balances from public, anon;
grant select on public.client_account_balances to authenticated;

-- ---------------------------------------------------------------------------
-- Versioned commission rules and independent commission lifecycle.
-- ---------------------------------------------------------------------------
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.staff(id) on delete restrict,
  version integer not null check(version > 0),
  name text not null default 'Client account paid',
  trigger_event text not null default 'account_paid' check(trigger_event in ('account_paid','client_completed')),
  commission_type text not null check(commission_type in ('fixed','percent')),
  commission_value numeric(10,2) not null check(commission_value >= 0),
  active boolean not null default true,
  effective_from timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  unique(employee_id,version)
);
create unique index if not exists commission_rules_one_active_idx on public.commission_rules(employee_id) where active;

insert into public.commission_rules(employee_id,version,commission_type,commission_value,active,effective_from)
select s.id,1,s.commission_type,s.commission_value,true,now()
from public.staff s
where not exists(select 1 from public.commission_rules r where r.employee_id=s.id)
on conflict(employee_id,version) do nothing;

create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.staff(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  account_id uuid not null references public.client_accounts(id) on delete restrict,
  trigger_event text not null default 'account_paid' check(trigger_event in ('account_paid','client_completed')),
  trigger_transaction_id uuid references public.payment_transactions(id) on delete restrict,
  rule_id uuid not null references public.commission_rules(id) on delete restrict,
  rule_version integer not null,
  calculation_basis numeric(10,2) not null check(calculation_basis >= 0),
  commission_type text not null check(commission_type in ('fixed','percent')),
  rate_value numeric(10,2) not null check(rate_value >= 0),
  amount numeric(10,2) not null check(amount >= 0),
  eligibility_date date not null default current_date,
  status text not null default 'eligible' check(status in ('pending','eligible','approved','paid','cancelled','reversed')),
  approved_by uuid references public.staff(id),
  approved_at timestamptz,
  paid_at timestamptz,
  payment_reference text,
  cancel_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id,trigger_event)
);
create index if not exists commissions_employee_status_idx on public.commissions(employee_id,status,created_at desc);
create index if not exists commissions_client_idx on public.commissions(client_id,created_at desc);
create trigger commissions_touch before update on public.commissions
for each row execute function public.touch_updated_at();

alter table public.commission_rules enable row level security;
alter table public.commissions enable row level security;
grant select on public.commission_rules to authenticated;
grant select,insert,update on public.commissions to authenticated;
create policy commission_rules_read on public.commission_rules for select to authenticated
using(public.cg_staff_id() is not null);
create policy commissions_read on public.commissions for select to authenticated
using(public.cg_staff_role() in ('admin','manager') or employee_id=public.cg_staff_id());
create policy commissions_insert on public.commissions for insert to authenticated
with check(public.cg_staff_role() in ('admin','manager'));
create policy commissions_update on public.commissions for update to authenticated
using(public.cg_staff_role() in ('admin','manager')) with check(public.cg_staff_role() in ('admin','manager'));

-- Preserve any existing earned snapshot as an independent commission record.
insert into public.commissions(
  employee_id,client_id,account_id,trigger_event,rule_id,rule_version,calculation_basis,
  commission_type,rate_value,amount,eligibility_date,status,created_at
)
select coalesce(a.commission_staff_id,a.assigned_staff),a.client_id,a.id,'account_paid',r.id,r.version,a.fee_amount,
       r.commission_type,r.commission_value,a.commission_amount,coalesce(a.payment_date,current_date),'eligible',coalesce(a.paid_at,a.updated_at)
from public.client_accounts a
join public.commission_rules r on r.employee_id=coalesce(a.commission_staff_id,a.assigned_staff) and r.active
where a.payment_status='paid' and a.commission_amount > 0 and coalesce(a.commission_staff_id,a.assigned_staff) is not null
on conflict(account_id,trigger_event) do nothing;

alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check check(action in (
'client_created','client_updated','client_deleted','preference_added','preference_removed',
'status_changed','status_overridden','next_step_changed','staff_assigned','staff_reassigned','pipeline_stage_changed',
'transfer_requested','payment_updated','payment_transaction_recorded','commission_created','commission_updated','requirement_updated',
'bulk_staff_assigned','round_robin_setting_changed','task_reassigned','client_started',
'document_uploaded','document_processing_started','document_processed','document_verified','document_rejected',
'document_reupload_requested','document_opened','appointment_created','appointment_updated','appointment_rescheduled',
'appointment_completed','note_added','task_added','task_updated','task_completed','contact_logged','followup_created',
'followup_completed','assessment_updated','post_hire_updated','agent_alert_created','agent_run','notification_queued',
'notification_sent','notification_failed','notification_not_configured','status_otp_requested','status_otp_verified'
));

commit;
