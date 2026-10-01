-- Deterministic commission evaluation. No commission exists without an active
-- versioned rule, eligible employee, verified event and satisfied conditions.

begin;

alter table public.staff
  add column if not exists commission_eligible boolean not null default false;

-- Preserve current intent without fabricating eligibility: only an existing
-- positive configured commission opts a staff member in during migration.
update public.staff set commission_eligible=true
where commission_eligible=false and coalesce(commission_value,0)>0;

alter table public.commission_rules
  add column if not exists basis text not null default 'total_paid';
alter table public.commission_rules drop constraint if exists commission_rules_basis_check;
alter table public.commission_rules add constraint commission_rules_basis_check
  check (basis in ('total_charged','total_paid'));

create or replace function public.evaluate_client_commissions_internal(
  p_client uuid,
  p_event text,
  p_event_id text
)
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_staff uuid;
  v_role text;
  v_active boolean;
  v_eligible boolean;
  v_status text;
  v_account uuid;
  v_balance_status text;
  v_charged numeric(12,2):=0;
  v_paid numeric(12,2):=0;
  v_basis numeric(12,2);
  v_amount numeric(12,2);
  v_created integer:=0;
  r record;
begin
  select c.assigned_staff,c.current_status into v_staff,v_status
    from public.clients c where c.id=p_client and c.deleted_at is null;
  if v_staff is null then return 0; end if;

  select role,active,commission_eligible into v_role,v_active,v_eligible
    from public.staff where id=v_staff;
  if not coalesce(v_active,false) or not coalesce(v_eligible,false) then return 0; end if;

  select account_id,payment_status,total_charged,total_paid
    into v_account,v_balance_status,v_charged,v_paid
    from public.client_account_balances where client_id=p_client;

  for r in
    select * from public.commission_rules
     where status='active'
       and trigger_event=p_event
       and (effective_from is null or effective_from<=now())
       and (effective_to is null or effective_to>now())
     order by rule_key,version
  loop
    if cardinality(r.eligible_roles)>0 and not (v_role=any(r.eligible_roles)) then continue; end if;
    if cardinality(r.eligible_staff)>0 and not (v_staff=any(r.eligible_staff)) then continue; end if;

    if coalesce((r.conditions->>'require_account_paid')::boolean,true)
       and coalesce(v_balance_status,'unpaid')<>'paid' then continue; end if;
    if r.conditions ? 'required_client_status'
       and v_status <> r.conditions->>'required_client_status' then continue; end if;
    if coalesce((r.conditions->>'require_no_open_tasks')::boolean,false)
       and exists(select 1 from public.tasks t where t.client_id=p_client and t.status in ('pending','in_progress')) then continue; end if;

    v_basis:=case r.basis when 'total_charged' then coalesce(v_charged,0) else coalesce(v_paid,0) end;
    v_amount:=case when r.commission_type='percent'
      then round(v_basis*r.commission_value/100.0,2)
      else r.commission_value end;
    if v_amount<=0 then continue; end if;

    insert into public.commissions(
      client_id,account_id,employee_id,rule_id,trigger_event,trigger_event_id,basis_amount,amount,status,eligible_at
    ) values (
      p_client,v_account,v_staff,r.id,p_event,p_event_id,v_basis,v_amount,'eligible',now()
    ) on conflict(client_id,employee_id,rule_id,trigger_event_id) do nothing;

    if found then
      v_created:=v_created+1;
      insert into public.activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
      select p_client,'commission_created',null,'commission',cm.id,
             jsonb_build_object('employee_id',v_staff,'rule_id',r.id,'amount',v_amount,'event',p_event,'event_id',p_event_id),
             'commission-engine'
        from public.commissions cm
       where cm.client_id=p_client and cm.employee_id=v_staff and cm.rule_id=r.id and cm.trigger_event_id=p_event_id;
    end if;
  end loop;
  return v_created;
end;
$$;
revoke execute on function public.evaluate_client_commissions_internal(uuid,text,text) from public,anon,authenticated;
grant execute on function public.evaluate_client_commissions_internal(uuid,text,text) to service_role;

create or replace function public.evaluate_client_commissions_manual(p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_role text:=public.cg_staff_role();
  v_created integer:=0;
  v_status text;
  v_account uuid;
  v_payment text;
begin
  if v_role not in ('admin','manager') then raise exception 'management required' using errcode='42501'; end if;
  select current_status into v_status from public.clients where id=p_client and deleted_at is null;
  if v_status is null then raise exception 'client not found'; end if;
  if v_status='completed' then
    v_created:=v_created+public.evaluate_client_commissions_internal(p_client,'client.completed','client.completed:'||p_client::text);
  end if;
  select account_id,payment_status into v_account,v_payment from public.client_account_balances where client_id=p_client;
  if v_payment='paid' and v_account is not null then
    v_created:=v_created+public.evaluate_client_commissions_internal(p_client,'payment.satisfied','payment.satisfied:'||v_account::text);
    if v_status='completed' then
      v_created:=v_created+public.evaluate_client_commissions_internal(p_client,'client.completed','client.completed:'||p_client::text);
    end if;
  end if;
  return jsonb_build_object('created',v_created,'client_id',p_client);
end;
$$;
revoke execute on function public.evaluate_client_commissions_manual(uuid) from public,anon;
grant execute on function public.evaluate_client_commissions_manual(uuid) to authenticated,service_role;

create or replace function public.evaluate_commissions_on_client_status()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.current_status='completed' and old.current_status is distinct from 'completed' then
    perform public.evaluate_client_commissions_internal(new.id,'client.completed','client.completed:'||new.id::text);
  end if;
  return new;
end;
$$;
revoke execute on function public.evaluate_commissions_on_client_status() from public,anon,authenticated;
grant execute on function public.evaluate_commissions_on_client_status() to service_role;
drop trigger if exists clients_commission_evaluate on public.clients;
create trigger clients_commission_evaluate
after update of current_status on public.clients
for each row execute function public.evaluate_commissions_on_client_status();

create or replace function public.evaluate_commissions_on_finance()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_status text;
begin
  select payment_status into v_status from public.client_account_balances where account_id=new.account_id;
  if v_status='paid' then
    perform public.evaluate_client_commissions_internal(new.client_id,'payment.satisfied','payment.satisfied:'||new.account_id::text);
    if exists(select 1 from public.clients where id=new.client_id and current_status='completed') then
      perform public.evaluate_client_commissions_internal(new.client_id,'client.completed','client.completed:'||new.client_id::text);
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.evaluate_commissions_on_finance() from public,anon,authenticated;
grant execute on function public.evaluate_commissions_on_finance() to service_role;
drop trigger if exists account_transactions_commission_evaluate on public.account_transactions;
create trigger account_transactions_commission_evaluate
after insert on public.account_transactions
for each row execute function public.evaluate_commissions_on_finance();

insert into public.permission_rules(role,resource,action,scope) values
 ('admin','commission','evaluate_commission','ALL'),('manager','commission','evaluate_commission','ALL'),('staff','commission','evaluate_commission','NONE'),
 ('admin','commission','cancel_commission','ALL'),('manager','commission','cancel_commission','ALL'),('staff','commission','cancel_commission','NONE')
on conflict(role,resource,action) do update set scope=excluded.scope,updated_at=now();

commit;
