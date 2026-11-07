begin;

-- Manual workflow routing is a staff decision, separate from payment/checklist evidence.
-- Retain the evidence guard for automated and ordinary status updates.
create or replace function career_gate_private.guard_client_completion()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(current_setting('cg.workflow_route',true),'')='direct'
    and public.cg_staff_role() in ('admin','manager','staff')
    and public.cg_can_access_client_row(new.assigned_staff,new.deleted_at)
  then return new; end if;
  if new.current_status='completed' and old.current_status<>'completed' and (
    not coalesce(career_gate_private.post_hire_complete(new.id),false)
    or not exists(select 1 from public.client_account_balances b where b.client_id=new.id and b.payment_status='paid')
  ) then raise exception 'completion_prerequisites_required' using errcode='P0001'; end if;
  return new;
end;
$$;
revoke all on function career_gate_private.guard_client_completion() from public,anon;
grant execute on function career_gate_private.guard_client_completion() to authenticated,service_role;

commit;
