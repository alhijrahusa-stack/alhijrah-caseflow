begin;

-- ---------------------------------------------------------------------------
-- 033 — Application completion ownership, client discount, and the commission
--       owner rule.
--
-- LOCKED BUSINESS RULE
--   COMMISSION_OWNER = APPLICATION_COMPLETED_BY
--
-- The commission for a paid client account belongs to the employee who
-- completed that client's application. It is never derived from the current
-- assignment, the staff member who recorded the payment, who uploaded the
-- receipt, who operated the Accounting screen, or who last edited the client.
-- Before this migration no column recorded application completion at all, so
-- `app/api/staff/accounting` attributed the commission to `assigned_staff`,
-- which transfers on reassignment. These columns are the missing fact.
--
-- Additive only. No existing column is dropped, renamed or re-typed, and no
-- existing row's financial value is changed.
-- ---------------------------------------------------------------------------

-- 1. Application completion ownership on the client ------------------------
alter table public.clients
  add column if not exists application_status text not null default 'not_started',
  add column if not exists application_completed_by uuid references public.staff(id) on delete restrict,
  add column if not exists application_completed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='clients_application_status_ck') then
    alter table public.clients
      add constraint clients_application_status_ck
      check (application_status in ('not_started','in_progress','completed'));
  end if;
  -- Completion is a single indivisible fact: the state, the owner and the
  -- timestamp are recorded together or not at all.
  if not exists (select 1 from pg_constraint where conname='clients_application_completion_ck') then
    alter table public.clients
      add constraint clients_application_completion_ck
      check (
        (application_status='completed')
          = (application_completed_by is not null and application_completed_at is not null)
      );
  end if;
end $$;

create index if not exists clients_application_completed_by_idx
  on public.clients (application_completed_by)
  where application_completed_by is not null;

-- Completion ownership may not be erased or moved once a commission has been
-- derived from it; that would leave a paid commission pointing at an owner the
-- record no longer claims. Correct such a case by cancelling the commission.
create or replace function public.guard_application_completion_ownership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.application_status='completed'
     and (new.application_status is distinct from 'completed'
          or new.application_completed_by is distinct from old.application_completed_by)
     and exists (
       select 1 from public.commissions
       where client_id=old.id and status not in ('cancelled','reversed')
     )
  then
    raise exception 'application_completion_locked_by_commission' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_application_completion_ownership() from public, anon;

drop trigger if exists clients_application_completion_guard on public.clients;
create trigger clients_application_completion_guard
before update of application_status, application_completed_by
on public.clients
for each row execute function public.guard_application_completion_ownership();

-- 2. Client discount on the account ----------------------------------------
-- `fee_amount` stays the gross contracted fee. The discount is stored beside
-- it so the reduction is auditable rather than hidden in a lower fee.
alter table public.client_accounts
  add column if not exists discount_amount numeric(10,2) not null default 0,
  add column if not exists discount_reason text,
  add column if not exists discount_updated_by uuid references public.staff(id) on delete restrict,
  add column if not exists discount_updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='client_accounts_discount_bounds_ck') then
    alter table public.client_accounts
      add constraint client_accounts_discount_bounds_ck
      check (discount_amount >= 0 and discount_amount <= fee_amount);
  end if;
  -- A discount with no recorded reason and no recorded author is not auditable.
  if not exists (select 1 from pg_constraint where conname='client_accounts_discount_audit_ck') then
    alter table public.client_accounts
      add constraint client_accounts_discount_audit_ck
      check (
        discount_amount = 0
          or (length(trim(coalesce(discount_reason,''))) > 0
              and discount_updated_by is not null
              and discount_updated_at is not null)
      );
  end if;
end $$;

-- The discount is a financial term, so it joins the columns that may only be
-- written by the canonical ledger command (migration 021).
drop trigger if exists client_accounts_finance_projection_guard on public.client_accounts;
create trigger client_accounts_finance_projection_guard
before update of payment_status,payment_method,payment_date,receipt_document_id,
                 commission_staff_id,commission_amount,paid_at,
                 discount_amount,discount_reason,discount_updated_by,discount_updated_at
on public.client_accounts
for each row execute function public.guard_client_account_finance_projection();

-- 3. Net fee in the authoritative balance view ------------------------------
-- `net_fee` is what the client actually owes. Balance and payment status are
-- measured against it, so a discounted account can reach `paid`.
-- The view gains columns, which `create or replace` cannot do, so it is
-- replaced outright. Nothing else depends on it; the application reads it.
drop view if exists public.client_account_balances;
create view public.client_account_balances
with (security_invoker = true)
as
with ledger as (
  select a.id as account_id,
         a.client_id,
         a.fee_amount,
         a.discount_amount,
         (a.fee_amount - a.discount_amount)::numeric(10,2) as net_fee,
         a.payment_status as projected_status,
         coalesce(sum(t.amount) filter (where t.status='confirmed' and t.direction='credit' and t.transaction_type='payment'),0)::numeric(10,2) as amount_paid,
         coalesce(sum(t.amount) filter (where t.status='confirmed' and t.transaction_type='refund'),0)::numeric(10,2) as refund_amount,
         coalesce(sum(case when t.status='confirmed' and t.direction='credit' then t.amount
                           when t.status='confirmed' and t.direction='debit' then -t.amount
                           else 0 end),0)::numeric(10,2) as net_credits
  from public.client_accounts a
  left join public.payment_transactions t on t.account_id=a.id
  group by a.id,a.client_id,a.fee_amount,a.discount_amount,a.payment_status
)
select account_id,
       client_id,
       fee_amount,
       discount_amount,
       net_fee,
       amount_paid,
       refund_amount,
       net_credits,
       (net_fee - net_credits)::numeric(10,2) as balance,
       case
         when projected_status='refunded' and net_credits <= 0 then 'refunded'
         -- Settled is measured against the net fee, so a fully discounted
         -- account settles at zero instead of reading as permanently unpaid.
         when net_credits >= net_fee then 'paid'
         when net_credits <= 0 then 'unpaid'
         else 'partially_paid'
       end as payment_status
from ledger;
revoke all on public.client_account_balances from public, anon;
grant select on public.client_account_balances to authenticated;

-- 4. Audit vocabulary for the two new recorded facts ------------------------
alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log
  add constraint activity_log_action_check check (action in (
    'client_created', 'client_updated', 'client_deleted', 'preference_added', 'preference_removed',
    'status_changed', 'status_overridden', 'next_step_changed', 'staff_assigned', 'staff_reassigned',
    'pipeline_stage_changed', 'transfer_requested', 'payment_updated', 'payment_transaction_recorded',
    'commission_created', 'commission_updated', 'requirement_updated', 'bulk_staff_assigned',
    'round_robin_setting_changed', 'task_reassigned', 'client_started',
    'application_completed', 'client_discount_updated',
    'document_uploaded', 'document_processing_started', 'document_processed', 'document_verified',
    'document_rejected', 'document_reupload_requested', 'document_opened',
    'appointment_created', 'appointment_updated', 'appointment_rescheduled', 'appointment_completed',
    'note_added', 'task_added', 'task_updated', 'task_completed',
    'contact_logged', 'followup_created', 'followup_completed',
    'assessment_updated', 'post_hire_updated', 'agent_alert_created', 'agent_run',
    'notification_queued', 'notification_sent', 'notification_failed', 'notification_not_configured',
    'status_otp_requested', 'status_otp_verified',
    'gate_job_account_assigned', 'gate_job_account_ready', 'gate_job_account_updated', 'gate_job_account_disabled',
    'credential_revealed', 'credential_copied'
  )) not valid;
alter table public.activity_log validate constraint activity_log_action_check;

commit;
