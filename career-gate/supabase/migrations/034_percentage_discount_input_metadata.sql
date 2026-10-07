begin;

-- ---------------------------------------------------------------------------
-- 034 — Preserve what the operator actually entered for a client discount.
--
-- Migration 033 established the authoritative effect, `client_accounts.
-- discount_amount`, and that stays the single financial truth. What 033 does
-- not record is whether the operator entered a dollar amount or a percentage,
-- so a 20% concession on a $150 fee is indistinguishable afterwards from a flat
-- $30 one. These two columns keep the original input beside its effect.
--
-- Additive only. `discount_amount`, `discount_reason`, `discount_updated_by`
-- and `discount_updated_at` are untouched, no existing row's financial value
-- changes, and application code built before this migration keeps working with
-- the columns present — so rolling the application back needs no schema change.
--
-- Legacy rows stay NULL. A discount recorded before this migration has no known
-- input type and is not given an invented one.
-- ---------------------------------------------------------------------------

alter table public.client_accounts
  add column if not exists discount_input_type text,
  add column if not exists discount_input_value numeric(12,4);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='client_accounts_discount_input_type_ck') then
    alter table public.client_accounts
      add constraint client_accounts_discount_input_type_ck
      check (discount_input_type is null or discount_input_type in ('amount','percentage'));
  end if;

  -- The input is one fact: the kind of input and its value are recorded
  -- together or not at all.
  if not exists (select 1 from pg_constraint where conname='client_accounts_discount_input_pair_ck') then
    alter table public.client_accounts
      add constraint client_accounts_discount_input_pair_ck
      check ((discount_input_type is null) = (discount_input_value is null));
  end if;

  -- A percentage is bounded; an amount is bounded by the fee, which
  -- `client_accounts_discount_bounds_ck` already enforces on the effect.
  if not exists (select 1 from pg_constraint where conname='client_accounts_discount_input_value_ck') then
    alter table public.client_accounts
      add constraint client_accounts_discount_input_value_ck
      check (
        discount_input_value is null
          or (discount_input_value >= 0
              and (discount_input_type <> 'percentage' or discount_input_value <= 100))
      );
  end if;
end $$;

-- The input metadata is part of the discount, so it may only be written by the
-- canonical ledger command, like the effect it explains (migration 021/033).
drop trigger if exists client_accounts_finance_projection_guard on public.client_accounts;
create trigger client_accounts_finance_projection_guard
before update of payment_status,payment_method,payment_date,receipt_document_id,
                 commission_staff_id,commission_amount,paid_at,
                 discount_amount,discount_reason,discount_updated_by,discount_updated_at,
                 discount_input_type,discount_input_value
on public.client_accounts
for each row execute function public.guard_client_account_finance_projection();

commit;
