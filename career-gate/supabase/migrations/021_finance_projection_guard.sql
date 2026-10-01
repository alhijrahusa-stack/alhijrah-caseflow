begin;

-- Legacy commission snapshot trigger is replaced by the independent commission engine.
drop trigger if exists client_accounts_commission_snapshot on public.client_accounts;

create or replace function public.guard_client_account_finance_projection()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('cg.finance_projection_sync',true),'') <> '1' then
    raise exception 'client_account_finance_projection_is_read_only' using errcode='42501';
  end if;
  return new;
end;
$$;

drop trigger if exists client_accounts_finance_projection_guard on public.client_accounts;
create trigger client_accounts_finance_projection_guard
before update of payment_status,payment_method,payment_date,receipt_document_id,commission_staff_id,commission_amount,paid_at
on public.client_accounts
for each row execute function public.guard_client_account_finance_projection();

commit;
