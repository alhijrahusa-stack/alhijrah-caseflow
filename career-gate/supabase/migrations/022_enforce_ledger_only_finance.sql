-- Remove the legacy financial snapshot as a competing write authority.
-- client_accounts remains the service/account identity; all financial events are
-- append-only account_transactions.

begin;

create or replace function public.create_account_opening_charge()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.fee_amount > 0 then
    insert into public.account_transactions(
      account_id,client_id,transaction_type,amount,occurred_at,idempotency_key,recorded_by,source,note
    ) values (
      new.id,new.client_id,'charge',new.fee_amount,new.created_at,
      'account-opening-charge:'||new.id::text,new.updated_by,'system','Opening service charge'
    ) on conflict(idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.create_account_opening_charge() from public,anon,authenticated;
grant execute on function public.create_account_opening_charge() to service_role;

drop trigger if exists client_accounts_opening_charge on public.client_accounts;
create trigger client_accounts_opening_charge
after insert on public.client_accounts
for each row execute function public.create_account_opening_charge();

create or replace function public.protect_legacy_account_financial_snapshot()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.fee_amount is distinct from old.fee_amount
     or new.payment_status is distinct from old.payment_status
     or new.payment_method is distinct from old.payment_method
     or new.payment_date is distinct from old.payment_date
     or new.receipt_document_id is distinct from old.receipt_document_id
     or new.commission_staff_id is distinct from old.commission_staff_id
     or new.commission_amount is distinct from old.commission_amount
     or new.paid_at is distinct from old.paid_at then
    raise exception 'legacy client_accounts financial snapshot is read-only; use account_transactions/commissions';
  end if;
  return new;
end;
$$;

drop trigger if exists client_accounts_financial_snapshot_guard on public.client_accounts;
create trigger client_accounts_financial_snapshot_guard
before update on public.client_accounts
for each row execute function public.protect_legacy_account_financial_snapshot();

-- The old snapshot commission trigger is no longer a financial authority.
drop trigger if exists client_accounts_commission_snapshot on public.client_accounts;

commit;
