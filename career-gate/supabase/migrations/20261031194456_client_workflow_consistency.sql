begin;

insert into public.pipeline_stages(key,label_en,label_ar,position,terminal,color)
values('completed_files','Completed Files','الملفات المكتملة',110,true,'#37d6cb')
on conflict(key) do nothing;

create or replace function career_gate_private.post_hire_complete(cid uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select count(*)=11
    and bool_and(p.status in ('completed','not_required'))
    and bool_or(p.item='ready_for_first_day' and p.status='completed')
  from public.post_hire_items p where p.client_id=cid
    and p.item in ('assessment','shift_selection','pre_hire_appointment','screening','i9_available',
      'i9_completion','safety_shoes','employment_paperwork','a_to_z','start_date','ready_for_first_day');
$$;
revoke all on function career_gate_private.post_hire_complete(uuid) from public,anon;
grant execute on function career_gate_private.post_hire_complete(uuid) to authenticated,service_role;

create or replace function career_gate_private.guard_client_completion()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.current_status='completed' and old.current_status<>'completed' and (
    not coalesce(career_gate_private.post_hire_complete(new.id),false)
    or not exists(select 1 from public.client_account_balances b where b.client_id=new.id and b.payment_status='paid')
  ) then raise exception 'completion_prerequisites_required' using errcode='P0001'; end if;
  return new;
end;
$$;
revoke all on function career_gate_private.guard_client_completion() from public,anon;
grant execute on function career_gate_private.guard_client_completion() to authenticated,service_role;
create trigger client_completion_evidence_guard before update of current_status
on public.clients for each row execute function career_gate_private.guard_client_completion();

create or replace function career_gate_private.reconcile_client_completion(cid uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  c public.clients%rowtype;
  complete boolean;
  paid boolean;
  target text;
  station text;
  prior_override text := coalesce(current_setting('cg.status_override',true),'');
begin
  select * into c from public.clients where id=cid and deleted_at is null for update;
  if not found or c.current_status='cancelled' then return false; end if;
  complete := coalesce(career_gate_private.post_hire_complete(cid),false);
  select coalesce(b.payment_status='paid',false) into paid
    from public.client_account_balances b where b.client_id=cid;
  paid := coalesce(paid,false);
  if complete and paid then
    target := 'completed'; station := 'completed_files';
  elsif complete or c.current_status='completed' then
    target := 'post_hire_tasks';
    station := case when paid then 'post_interview_completion' else 'payment_required' end;
  else return false;
  end if;
  if c.current_status=target and c.pipeline_stage=station then return false; end if;
  perform set_config('cg.status_override','Evidence-based workflow reconciliation',true);
  update public.clients set current_status=target,pipeline_stage=station,
    next_step=case when target='completed' then 'File completed. Payment and all post-interview items verified.'
      when not paid then 'Verify the outstanding office payment; continue post-interview preparation.'
      else 'Complete the remaining post-interview items.' end
    where id=cid;
  perform set_config('cg.status_override',prior_override,true);
  insert into public.activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
  values(cid,'status_changed',public.cg_staff_id(),'client',cid,
    jsonb_build_object('status',c.current_status,'pipeline_stage',c.pipeline_stage),
    jsonb_build_object('status',target,'pipeline_stage',station,'reason','Verified ledger and post-interview checklist',
      'paperwork_complete',complete,'payment_verified',paid),'workflow-completion-reconciliation');
  return true;
end;
$$;
revoke all on function career_gate_private.reconcile_client_completion(uuid) from public,anon;
grant execute on function career_gate_private.reconcile_client_completion(uuid) to authenticated,service_role;

create or replace function career_gate_private.sync_workflow_completion()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform career_gate_private.reconcile_client_completion(new.client_id);
  return new;
end;
$$;
revoke all on function career_gate_private.sync_workflow_completion() from public,anon;
grant execute on function career_gate_private.sync_workflow_completion() to authenticated,service_role;

create trigger post_hire_workflow_completion after insert or update of status
on public.post_hire_items for each row execute function career_gate_private.sync_workflow_completion();
create trigger account_workflow_completion after update of payment_status
on public.client_accounts for each row execute function career_gate_private.sync_workflow_completion();

create index if not exists clients_live_status_updated_idx
on public.clients(current_status,updated_at desc,id) where deleted_at is null;

do $$ declare cid uuid; begin
  for cid in select c.id from public.clients c
    where c.deleted_at is null and c.current_status not in ('completed','cancelled')
      and career_gate_private.post_hire_complete(c.id)
  loop perform career_gate_private.reconcile_client_completion(cid); end loop;
end $$;
commit;
