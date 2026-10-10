begin;

-- Career Gate 038: every canonical Client has exactly one existing client_account.
-- Non-destructive: preserves all existing accounts, ledger rows and financial history.

create or replace function public.ensure_client_account()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.client_accounts(client_id, assigned_staff)
    values (new.id, new.assigned_staff)
    on conflict (client_id) do nothing;
    return new;
  end if;

  -- Repair a historically missing account without changing valid existing finance.
  insert into public.client_accounts(client_id, assigned_staff)
  values (new.id, new.assigned_staff)
  on conflict (client_id) do nothing;

  -- Preserve the existing assignment rule: only an unsettled legacy projection
  -- follows reassignment. Commission ownership remains independent.
  if new.assigned_staff is distinct from old.assigned_staff then
    update public.client_accounts
       set assigned_staff = new.assigned_staff
     where client_id = new.id
       and payment_status = 'pending';
  end if;

  return new;
end;
$$;

revoke execute on function public.ensure_client_account() from public, anon, authenticated;
grant execute on function public.ensure_client_account() to service_role;

drop trigger if exists clients_account_sync on public.clients;
create trigger clients_account_sync
after insert or update of pipeline_stage, assigned_staff
on public.clients
for each row execute function public.ensure_client_account();

-- Backfill only missing accounts. client_accounts.client_id is already UNIQUE,
-- so this is idempotent and cannot create a second account for a Client.
insert into public.client_accounts(client_id, assigned_staff)
select c.id, c.assigned_staff
from public.clients c
where c.deleted_at is null
  and not exists (
    select 1 from public.client_accounts a where a.client_id = c.id
  )
on conflict (client_id) do nothing;

commit;
