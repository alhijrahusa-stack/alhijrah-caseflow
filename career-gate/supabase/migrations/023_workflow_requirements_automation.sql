-- Workflow / Requirements automation. Database facts drive requirement and
-- next-action state; the UI does not need to maintain duplicate truth.

begin;

create or replace function public.apply_canonical_workflow_defaults()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_default text;
  v_allowed boolean;
begin
  if tg_op='INSERT' then
    select exists(select 1 from public.status_entry_states where status=new.current_status) into v_allowed;
    if not v_allowed then
      raise exception 'invalid entry status: %', new.current_status;
    end if;
  elsif new.current_status is distinct from old.current_status then
    if new.next_step is not distinct from old.next_step or nullif(trim(new.next_step),'') is null then
      select default_next_action into v_default
        from public.workflow_status_rules
       where status=new.current_status and active;
      if v_default is null then
        raise exception 'active workflow rule missing for status %', new.current_status;
      end if;
      new.next_step := v_default;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_apply_workflow_defaults on public.clients;
create trigger clients_apply_workflow_defaults
before insert or update of current_status,next_step on public.clients
for each row execute function public.apply_canonical_workflow_defaults();

create or replace function public.sync_post_hire_requirement()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_status text;
  v_completed timestamptz;
begin
  v_status := case new.status
    when 'confirmed' then 'complete'
    when 'completed' then 'complete'
    when 'not_required' then 'not_applicable'
    when 'pending' then 'pending_review'
    else 'missing'
  end;
  v_completed := case when v_status='complete' then new.updated_at else null end;

  insert into public.client_requirements(
    client_id,requirement_key,stage,title,reason,source,completion_rule,status,completed_at,completed_by,updated_at
  ) values (
    new.client_id,
    'post_hire:'||new.item,
    'post_interview_completion',
    initcap(replace(new.item,'_',' ')),
    new.note,
    'post_hire',
    jsonb_build_object('source_table','post_hire_items','source_item',new.item),
    v_status,
    v_completed,
    case when v_status='complete' then new.staff_id else null end,
    new.updated_at
  )
  on conflict(client_id,requirement_key) do update set
    reason=excluded.reason,
    status=excluded.status,
    completed_at=excluded.completed_at,
    completed_by=excluded.completed_by,
    updated_at=excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists post_hire_requirement_sync on public.post_hire_items;
create trigger post_hire_requirement_sync
after insert or update of status,note,staff_id,updated_at on public.post_hire_items
for each row execute function public.sync_post_hire_requirement();

create or replace function public.sync_document_requirement()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  update public.client_requirements
     set status = case new.status
       when 'verified' then 'complete'
       when 'rejected' then 'rejected'
       when 'needs_reupload' then 'missing'
       when 'needs_review' then 'pending_review'
       when 'processing' then 'pending_review'
       else status
     end,
     completed_at = case when new.status='verified' then coalesce(new.reviewed_at,now()) else null end,
     completed_by = case when new.status='verified' then new.reviewed_by else null end,
     updated_at = now()
   where related_document_id=new.id;
  return new;
end;
$$;

drop trigger if exists document_requirement_sync on public.documents;
create trigger document_requirement_sync
after update of status,reviewed_at,reviewed_by on public.documents
for each row execute function public.sync_document_requirement();

create or replace function public.sync_task_requirement()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  update public.client_requirements
     set status = case
       when new.status='completed' then 'complete'
       when new.status in ('pending','in_progress') then 'missing'
       else status end,
     due_at = new.due_at,
     completed_at = case when new.status='completed' then new.completed_at else null end,
     completed_by = case when new.status='completed' then new.completed_by else null end,
     updated_at = now()
   where related_task_id=new.id;
  return new;
end;
$$;

drop trigger if exists task_requirement_sync on public.tasks;
create trigger task_requirement_sync
after update of status,due_at,completed_at,completed_by on public.tasks
for each row execute function public.sync_task_requirement();

-- Keep operational due state aligned to actual open work. This never invents an
-- SLA: it uses the earliest real task/appointment deadline, otherwise retains an
-- explicit waiting condition.
create or replace function public.refresh_client_operational_deadline(p_client uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_due timestamptz;
  v_assigned uuid;
  v_status text;
begin
  select assigned_staff,current_status into v_assigned,v_status from public.clients where id=p_client;
  if v_status is null or v_status in ('completed','cancelled') then return; end if;
  select min(x.due_at) into v_due from (
    select t.due_at from public.tasks t where t.client_id=p_client and t.status in ('pending','in_progress') and t.due_at is not null
    union all
    select a.scheduled_at from public.appointments a where a.client_id=p_client and a.status in ('scheduled','confirmed','rescheduled') and a.scheduled_at>=now()
    union all
    select r.due_at from public.client_requirements r where r.client_id=p_client and r.status not in ('complete','not_applicable') and r.due_at is not null
  ) x;
  update public.clients
     set next_action_due_at=v_due,
         waiting_condition=case
           when v_assigned is null then 'Awaiting staff assignment'
           when v_due is null then 'Awaiting next-action deadline'
           else null end
   where id=p_client;
end;
$$;
revoke execute on function public.refresh_client_operational_deadline(uuid) from public,anon,authenticated;
grant execute on function public.refresh_client_operational_deadline(uuid) to service_role;

create or replace function public.refresh_client_deadline_from_child()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  perform public.refresh_client_operational_deadline(coalesce(new.client_id,old.client_id));
  return coalesce(new,old);
end;
$$;
revoke execute on function public.refresh_client_deadline_from_child() from public,anon,authenticated;
grant execute on function public.refresh_client_deadline_from_child() to service_role;

drop trigger if exists tasks_client_deadline_refresh on public.tasks;
create trigger tasks_client_deadline_refresh after insert or update or delete on public.tasks for each row execute function public.refresh_client_deadline_from_child();
drop trigger if exists appointments_client_deadline_refresh on public.appointments;
create trigger appointments_client_deadline_refresh after insert or update or delete on public.appointments for each row execute function public.refresh_client_deadline_from_child();
drop trigger if exists requirements_client_deadline_refresh on public.client_requirements;
create trigger requirements_client_deadline_refresh after insert or update or delete on public.client_requirements for each row execute function public.refresh_client_deadline_from_child();

commit;
