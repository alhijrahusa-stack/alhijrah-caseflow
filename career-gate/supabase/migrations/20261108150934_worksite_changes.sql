begin;

insert into public.pipeline_stages(key,position,label_en,label_ar,color,terminal)
select 'worksite_change',coalesce(max(position),0)+1,'Worksite Changes','تغيير موقع العمل · قسم صلاح المريسي','#10b981',false
from public.pipeline_stages
on conflict(key) do nothing;

-- Keep the generated exclusive location column and its existing index. New
-- transfers use a real pipeline station; evidence and old decisions remain.
create or replace function career_gate_private.workflow_location(status text, stage text)
returns text language sql immutable security invoker set search_path='' as $$
  select case
    when stage='worksite_change' then 'worksite_change'
    when status in ('new_intake','needs_review') then 'new_intake'
    when status in ('ready_to_apply','application_in_progress','assessment_required') then 'account_setup'
    when status in ('shift_selected','appointment_required') then 'job_ready'
    when status='appointment_scheduled' then 'appointments'
    when status='completed' then 'completed'
    when status='cancelled' then 'cancelled'
    when stage='payment_required' then 'payment_required'
    else 'paperwork_pending' end;
$$;
revoke all on function career_gate_private.workflow_location(text,text) from public,anon;
grant execute on function career_gate_private.workflow_location(text,text) to authenticated,service_role;

alter table public.manager_inbox drop constraint manager_inbox_destination_check;
alter table public.manager_inbox add constraint manager_inbox_destination_check check(destination in
  ('keep_current','new_intake','account_setup','job_ready','appointments','payment_required','paperwork_pending','completed','urgent','worksite_change'));

do $$ declare rule record; begin
  for rule in select conname from pg_constraint where conrelid='public.staff_presence'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%workspace_section%'
  loop execute format('alter table public.staff_presence drop constraint %I',rule.conname); end loop;
end $$;
alter table public.staff_presence add constraint staff_presence_workspace_section_check check(workspace_section is null or
  (path='/staff/clients' and workspace_section in ('all','new_intake','account_setup','job_ready','appointments','payment_required','paperwork_pending','completed','urgent','worksite_change')));

-- Financial/checklist edits continue to update evidence without prematurely
-- pulling an assigned relocation out of its human-operated workspace.
create or replace function career_gate_private.reconcile_client_completion(cid uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.clients%rowtype; complete boolean; paid boolean; target text; station text;
  prior_override text := coalesce(current_setting('cg.status_override',true),'');
begin
  select * into c from public.clients where id=cid and deleted_at is null for update;
  if not found or c.current_status='cancelled' or c.manager_review_id is not null or c.pipeline_stage='worksite_change' then return false; end if;
  complete:=coalesce(career_gate_private.post_hire_complete(cid),false);
  select coalesce(b.payment_status='paid',false) into paid from public.client_account_balances b where b.client_id=cid;
  paid:=coalesce(paid,false);
  if complete and paid then target:='completed';station:='completed_files';
  elsif complete or c.current_status='completed' then
    target:='post_hire_tasks';station:=case when paid then 'post_interview_completion' else 'payment_required' end;
  else return false; end if;
  if c.current_status=target and c.pipeline_stage=station then return false; end if;
  perform set_config('cg.status_override','Evidence-based workflow reconciliation',true);
  update public.clients set current_status=target,pipeline_stage=station,
    next_step=case when target='completed' then 'File completed. Payment and all post-interview items verified.'
      when not paid then 'Verify the outstanding office payment; continue post-interview preparation.'
      else 'Complete the remaining post-interview items.' end where id=cid;
  perform set_config('cg.status_override',prior_override,true);
  insert into public.activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
    values(cid,'status_changed',public.cg_staff_id(),'client',cid,
      jsonb_build_object('status',c.current_status,'pipeline_stage',c.pipeline_stage),
      jsonb_build_object('status',target,'pipeline_stage',station,'reason','Verified ledger and post-interview checklist',
        'paperwork_complete',complete,'payment_verified',paid),'workflow-completion-reconciliation');
  return true;
end $$;
revoke all on function career_gate_private.reconcile_client_completion(uuid) from public,anon;
grant execute on function career_gate_private.reconcile_client_completion(uuid) to authenticated,service_role;

create table public.worksite_changes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','confirmed')),
  current_site_code text, current_site_name text, current_site_address text,
  requested_site_code text, requested_site_name text, requested_site_address text,
  final_site_code text, final_site_name text, final_site_address text,
  shift_days text, shift_start time, shift_end time, new_start_date date,
  confirmed_at timestamptz, recorded_at timestamptz,
  confirmed_by uuid references public.staff(id) on delete restrict,
  confirmed_by_name text,
  notification_id uuid references public.notifications(id) on delete restrict,
  created_by uuid not null references public.staff(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worksite_confirmation_complete check(status='pending' or (
    nullif(trim(current_site_code),'') is not null and nullif(trim(current_site_name),'') is not null
    and nullif(trim(requested_site_code),'') is not null and nullif(trim(requested_site_name),'') is not null
    and nullif(trim(final_site_code),'') is not null and nullif(trim(final_site_name),'') is not null
    and nullif(trim(final_site_address),'') is not null and nullif(trim(shift_days),'') is not null
    and shift_start is not null and shift_end is not null and new_start_date is not null
    and confirmed_at is not null and recorded_at is not null and confirmed_by is not null
    and confirmed_by_name is not null and notification_id is not null
  ))
);
create unique index worksite_changes_pending_client_idx on public.worksite_changes(client_id) where status='pending';
create index worksite_changes_client_history_idx on public.worksite_changes(client_id,created_at desc,id);
create index worksite_changes_confirmed_idx on public.worksite_changes(recorded_at desc,id) where status='confirmed';
create index worksite_changes_created_by_idx on public.worksite_changes(created_by);
create index worksite_changes_confirmed_by_idx on public.worksite_changes(confirmed_by) where confirmed_by is not null;
create index worksite_changes_notification_idx on public.worksite_changes(notification_id) where notification_id is not null;

alter table public.worksite_changes enable row level security;
revoke all on public.worksite_changes from public,anon,authenticated;
grant select,insert,update on public.worksite_changes to authenticated;
grant all on public.worksite_changes to service_role;
create policy worksite_changes_read on public.worksite_changes for select to authenticated
  using(public.cg_can_access_client(client_id));
create policy worksite_changes_insert on public.worksite_changes for insert to authenticated
  with check(public.cg_can_access_client(client_id) and created_by=public.cg_staff_id());
create policy worksite_changes_update on public.worksite_changes for update to authenticated
  using(public.cg_can_access_client(client_id)) with check(public.cg_can_access_client(client_id));

create function career_gate_private.guard_worksite_change() returns trigger
language plpgsql security invoker set search_path='' as $$
declare c public.clients%rowtype;
begin
  if tg_op='DELETE' then raise exception 'worksite_change_history_is_immutable' using errcode='42501'; end if;
  if current_setting('cg.worksite_change',true) is distinct from 'write' then
    raise exception 'worksite_change_requires_verified_command' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    if old.status='confirmed' then raise exception 'worksite_confirmation_is_immutable' using errcode='42501'; end if;
    if row(new.id,new.client_id,new.created_by,new.created_at) is distinct from row(old.id,old.client_id,old.created_by,old.created_at) then
      raise exception 'worksite_change_identity_is_immutable' using errcode='42501';
    end if;
  else
    if new.status<>'pending' then raise exception 'worksite_change_must_start_pending' using errcode='23514'; end if;
    new.created_by:=public.cg_staff_id(); new.created_at:=now();
  end if;
  select * into c from public.clients where id=new.client_id and deleted_at is null for update;
  if not found or c.operational_location<>'worksite_change' or c.manager_review_id is not null then
    raise exception 'worksite_change_file_not_active' using errcode='40001';
  end if;
  if new.status='confirmed' then
    new.confirmed_by:=public.cg_staff_id(); new.recorded_at:=now();
    select display_name into new.confirmed_by_name from public.staff where id=new.confirmed_by;
    if not exists(select 1 from public.notifications n where n.id=new.notification_id and n.client_id=new.client_id
      and n.template='worksite_change_confirmed' and n.payload->>'changeId'=new.id::text) then
      raise exception 'worksite_notification_mismatch' using errcode='23514';
    end if;
  else
    new.confirmed_by:=null;new.confirmed_by_name:=null;new.confirmed_at:=null;new.recorded_at:=null;
    new.notification_id:=null;
  end if;
  new.updated_at:=now(); return new;
end $$;
revoke all on function career_gate_private.guard_worksite_change() from public,anon;
grant execute on function career_gate_private.guard_worksite_change() to authenticated,service_role;
create trigger worksite_changes_guard before insert or update or delete on public.worksite_changes
for each row execute function career_gate_private.guard_worksite_change();

-- A successful provider receipt is durable even when a later webhook marks
-- delivery failed. Its immutable identity cannot be reset to resend the email.
create function career_gate_private.guard_worksite_notification_receipt() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.template='worksite_change_confirmed' and old.sent_at is not null then
    if row(new.id,new.client_id,new.channel,new.template,new.payload,new.idempotency_key,new.provider,new.provider_id,new.sent_at,new.attempts)
      is distinct from row(old.id,old.client_id,old.channel,old.template,old.payload,old.idempotency_key,old.provider,old.provider_id,old.sent_at,old.attempts)
      or new.status in ('queued','sending','not_configured') then
      raise exception 'worksite_email_receipt_is_immutable' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function career_gate_private.guard_worksite_notification_receipt() from public,anon;
grant execute on function career_gate_private.guard_worksite_notification_receipt() to authenticated,service_role;
create trigger worksite_notification_receipt_guard before update on public.notifications
for each row execute function career_gate_private.guard_worksite_notification_receipt();
alter table public.worksite_changes replica identity full;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='worksite_changes') then
      alter publication supabase_realtime add table public.worksite_changes;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end $$;
commit;
