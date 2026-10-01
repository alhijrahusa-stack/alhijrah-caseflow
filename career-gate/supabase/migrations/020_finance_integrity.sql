begin;

alter table public.payment_transactions
  add column if not exists related_transaction_id uuid references public.payment_transactions(id) on delete restrict;
create index if not exists payment_transactions_related_idx on public.payment_transactions(related_transaction_id)
where related_transaction_id is not null;

alter table public.payment_transactions drop constraint if exists payment_transactions_refund_link_check;
alter table public.payment_transactions add constraint payment_transactions_refund_link_check
check (transaction_type <> 'refund' or related_transaction_id is not null);

-- Commission settings already used by the product become a versioned rule every time they change.
create or replace function public.sync_staff_commission_rule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_version integer;
begin
  if tg_op='UPDATE'
     and new.commission_type is not distinct from old.commission_type
     and new.commission_value is not distinct from old.commission_value then
    return new;
  end if;

  update public.commission_rules
     set active=false,ended_at=now()
   where employee_id=new.id and active;

  select coalesce(max(version),0)+1 into next_version
  from public.commission_rules where employee_id=new.id;

  insert into public.commission_rules(
    employee_id,version,name,trigger_event,commission_type,commission_value,active,effective_from
  ) values (
    new.id,next_version,'Client account paid','account_paid',new.commission_type,new.commission_value,true,now()
  );
  return new;
end;
$$;
revoke execute on function public.sync_staff_commission_rule() from public,anon,authenticated;
grant execute on function public.sync_staff_commission_rule() to service_role;

drop trigger if exists staff_commission_rule_sync on public.staff;
create trigger staff_commission_rule_sync
after insert or update of commission_type,commission_value on public.staff
for each row execute function public.sync_staff_commission_rule();

commit;
