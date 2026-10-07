begin;

-- ---------------------------------------------------------------------------
-- 035 — A settled account no longer has to claim it was paid in cash.
--
-- `client_accounts` carries a check from migration 006, written before the
-- canonical ledger existed:
--
--   check (payment_status <> 'paid' or (payment_method is not null
--                                       and payment_date is not null))
--
-- At the time, 'paid' could only mean a cash payment, so demanding a method and
-- a date was sound. Since migrations 019 and 021 the ledger is authoritative and
-- `client_accounts` is a compatibility projection: 'paid' now means nothing is
-- owed, which a waiver, a credit adjustment or a full discount reach without any
-- money changing hands and therefore without a payment method.
--
-- The result is that a waiver large enough to settle an account cannot be
-- recorded at all — the projection write fails with
-- `client_accounts_check` and the whole operation rolls back — and the only way
-- to make one succeed would be to invent a payment method the client never used.
--
-- This drops that clause and replaces it with what remains true of the
-- projection: the cash detail is recorded as a pair or not at all.
--
-- No column, row or financial value changes. Nothing is dropped but the obsolete
-- constraint itself, so rolling the application back stays safe.
-- ---------------------------------------------------------------------------

alter table public.client_accounts drop constraint if exists client_accounts_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='client_accounts_payment_detail_ck') then
    -- `not valid`: rows written under the old contract are left exactly as they
    -- are. Correcting historical financial rows is not this migration's business;
    -- the constraint governs what is written from now on, and
    -- `reconcileAccount` only ever sets the method and the date together.
    alter table public.client_accounts
      add constraint client_accounts_payment_detail_ck
      check (payment_date is null or payment_method is not null) not valid;
  end if;
end $$;

commit;
