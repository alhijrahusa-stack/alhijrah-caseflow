begin;

-- A single persisted location expression drives every operational queue and count.
create or replace function career_gate_private.workflow_location(status text, stage text)
returns text language sql immutable security invoker set search_path='' as $$
  select case
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

alter table public.manager_inbox
  add column request_type text not null default 'review' check(request_type in ('review','duplicate')),
  add column related_client_id uuid references public.clients(id) on delete restrict,
  add column original_location text,
  add column resolved_by_name_snapshot text,
  add column resolution_action text not null default 'approve' check(resolution_action in ('approve','return','delete','not_duplicate')),
  add constraint manager_duplicate_pair check((request_type='duplicate')=(related_client_id is not null)),
  add constraint manager_duplicate_distinct check(related_client_id is null or related_client_id<>client_id);
alter table public.manager_inbox drop constraint manager_inbox_destination_check;
alter table public.manager_inbox add constraint manager_inbox_destination_check check(destination in ('keep_current','new_intake','account_setup','job_ready','appointments','payment_required','paperwork_pending','completed','urgent'));
grant insert(request_type,related_client_id,original_location) on public.manager_inbox to authenticated;
grant update(resolution_action) on public.manager_inbox to authenticated;

alter table public.clients
  add column is_urgent boolean not null default false,
  add column manager_review_id uuid references public.manager_inbox(id) on delete restrict,
  add column operational_location text generated always as (
    case when deleted_at is not null then 'deleted'
      when manager_review_id is not null then 'manager'
      when current_status='completed' then 'completed'
      when current_status='cancelled' then 'cancelled'
      when is_urgent then 'urgent'
      else career_gate_private.workflow_location(current_status,pipeline_stage) end
  ) stored;

-- Existing open requests become held files; existing decisions remain untouched.
update public.clients c set manager_review_id=i.id from public.manager_inbox i
where i.client_id=c.id and i.status='open' and c.deleted_at is null;
create index clients_operational_location_idx on public.clients(operational_location,updated_at desc,id) where deleted_at is null;
create index manager_inbox_status_order_idx on public.manager_inbox(status,submitted_at,id);
create index manager_inbox_related_idx on public.manager_inbox(related_client_id) where related_client_id is not null;
create index manager_inbox_review_stamp_idx on public.manager_inbox(client_id,resolved_at desc,id) where status='resolved';

-- Cross-row checks deliberately use an internal, non-exposed trigger so a staff
-- user's inability to read another sender's review cannot bypass a held file.
create or replace function career_gate_private.guard_client_dispatch()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_request public.manager_inbox%rowtype;
begin
  if tg_op='INSERT' then
    if new.manager_review_id is not null then raise exception 'invalid_review_pointer' using errcode='42501'; end if;
    return new;
  end if;
  if old.manager_review_id is not null then
    select * into old_request from public.manager_inbox where id=old.manager_review_id;
    if old_request.status='open' and (
      new.manager_review_id is distinct from old.manager_review_id
      or row(new.current_status,new.pipeline_stage,new.assigned_staff,new.is_urgent,new.deleted_at)
        is distinct from row(old.current_status,old.pipeline_stage,old.assigned_staff,old.is_urgent,old.deleted_at)
    ) then raise exception 'manager_review_pending' using errcode='P0001'; end if;
  end if;
  if new.manager_review_id is distinct from old.manager_review_id and new.manager_review_id is not null
    and not exists(select 1 from public.manager_inbox i where i.id=new.manager_review_id and i.status='open'
      and (i.client_id=new.id or i.related_client_id=new.id))
  then raise exception 'invalid_review_pointer' using errcode='42501'; end if;
  if new.deleted_at is distinct from old.deleted_at and public.cg_staff_role() not in ('admin','manager') then
    raise exception 'management_delete_required' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function career_gate_private.guard_client_dispatch() from public,anon;
create trigger clients_dispatch_guard before insert or update on public.clients
for each row execute function career_gate_private.guard_client_dispatch();

create or replace function career_gate_private.guard_manager_inbox() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'manager_review_history_is_immutable' using errcode='42501'; end if;
  if tg_op='INSERT' then
    if new.submitted_by is distinct from public.cg_staff_id() then raise exception 'manager_review_actor_mismatch' using errcode='42501'; end if;
    new.submitted_at:=now();
  else
    if row(new.request_key,new.kind,new.client_id,new.title,new.submitted_note,new.source_path,new.snapshot,new.submitted_by,new.submitted_at,new.request_type,new.related_client_id,new.original_location)
      is distinct from row(old.request_key,old.kind,old.client_id,old.title,old.submitted_note,old.source_path,old.snapshot,old.submitted_by,old.submitted_at,old.request_type,old.related_client_id,old.original_location)
    then raise exception 'manager_review_submission_is_immutable' using errcode='42501'; end if;
    if current_setting('cg.manager_resolution',true) is distinct from old.id::text then raise exception 'manager_resolution_requires_verified_command' using errcode='42501'; end if;
    if old.status<>'open' or new.status<>'resolved' or new.resolved_by is distinct from public.cg_staff_id()
    then raise exception 'manager_review_resolution_is_final' using errcode='42501'; end if;
    new.resolved_at:=now();
    select display_name into new.resolved_by_name_snapshot from public.staff where id=new.resolved_by;
  end if;
  return new;
end $$;
create trigger manager_inbox_no_delete before delete on public.manager_inbox
for each row execute function career_gate_private.guard_manager_inbox();

-- Acquiring/releasing queue ownership is in the same transaction as the review.
create function career_gate_private.sync_manager_dispatch() returns trigger
language plpgsql security invoker set search_path='' as $$
declare cid uuid; affected integer;
begin
  for cid in select x from unnest(array[new.client_id,new.related_client_id]) x where x is not null order by x loop
    if new.status='open' then
      update public.clients set manager_review_id=new.id where id=cid and deleted_at is null and manager_review_id is null;
      get diagnostics affected=row_count;
      if affected<>1 then raise exception 'client_already_under_review' using errcode='P0001'; end if;
    else
      update public.clients set manager_review_id=null where id=cid and manager_review_id=new.id;
    end if;
  end loop;
  return new;
end $$;
revoke all on function career_gate_private.sync_manager_dispatch() from public,anon;
grant execute on function career_gate_private.sync_manager_dispatch() to authenticated,service_role;
create trigger manager_inbox_dispatch after insert or update of status on public.manager_inbox
for each row execute function career_gate_private.sync_manager_dispatch();

-- Expose only actor/time/stamp to the current client reader, not private notes
-- or reports from another employee. This survives ownership reassignment.
create function career_gate_private.client_review_stamp(cid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare stamp jsonb;
begin
  if not public.cg_can_access_client(cid) then return null; end if;
  select jsonb_build_object('review_id',i.id,'reviewed_by_name',coalesce(i.resolved_by_name_snapshot,s.display_name),'reviewed_at',i.resolved_at,
    'review_pending',exists(select 1 from public.manager_inbox p where p.status='open' and (p.client_id=cid or p.related_client_id=cid)))
    into stamp from public.manager_inbox i join public.staff s on s.id=i.resolved_by
    where i.status='resolved' and (i.client_id=cid or i.related_client_id=cid)
    order by i.resolved_at desc,i.id desc limit 1;
  return stamp;
end $$;
revoke all on function career_gate_private.client_review_stamp(uuid) from public,anon;
grant execute on function career_gate_private.client_review_stamp(uuid) to authenticated,service_role;

-- Store only completed results, atomically with their mutations. A transaction
-- advisory lock serializes a repeated actor/key before work starts.
create table public.staff_operations (
  staff_id uuid not null references public.staff(id) on delete restrict,
  operation_id uuid not null,
  operation_name text not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(staff_id,operation_id)
);
alter table public.staff_operations enable row level security;
revoke all on public.staff_operations from public,anon,authenticated;
grant select,insert on public.staff_operations to authenticated;
create policy staff_operations_read on public.staff_operations for select to authenticated using(staff_id=public.cg_staff_id());
create policy staff_operations_insert on public.staff_operations for insert to authenticated with check(staff_id=public.cg_staff_id());

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
  if not found or c.current_status='cancelled' or c.manager_review_id is not null then return false; end if;
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

-- Smart Client staging remains server-mediated. Expose only the live queue's
-- aggregate to verified managers, without granting access to its raw records.
create function career_gate_private.active_smart_client_count()
returns integer language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.cg_staff_role(),'') not in ('admin','manager') then
    raise exception 'manager_access_required' using errcode = '42501';
  end if;
  return (select count(*)::integer from public.client_import_cases
    where archived_at is null and status <> 'APPROVED_FILE');
end;
$$;
revoke all on function career_gate_private.active_smart_client_count() from public,anon;
grant execute on function career_gate_private.active_smart_client_count() to authenticated;

create table public.staff_presence(
 staff_id uuid primary key references public.staff(id) on delete cascade,
 auth_user_id uuid not null unique,
 path text not null default '/staff' check(length(path)<=300 and path ~ '^/staff(/[A-Za-z0-9_-]+)*$'),
 active_client_id uuid references public.clients(id) on delete set null,
 workspace_section text check(workspace_section is null or (path='/staff/clients' and workspace_section in ('all','new_intake','account_setup','job_ready','appointments','payment_required','paperwork_pending','completed','urgent'))),
 state text not null check(state in ('active','idle')),visible boolean not null default true,seen_at timestamptz not null default now()
);
alter table public.staff_presence enable row level security;
revoke all on public.staff_presence from public,anon,authenticated;
grant select,insert,update on public.staff_presence to authenticated;
grant all on public.staff_presence to service_role;
create policy staff_presence_read on public.staff_presence for select to authenticated using(staff_id=public.cg_staff_id() or public.cg_staff_role() in ('admin','manager'));
create policy staff_presence_insert on public.staff_presence for insert to authenticated with check(staff_id=public.cg_staff_id() and auth_user_id=auth.uid());
create policy staff_presence_update on public.staff_presence for update to authenticated using(staff_id=public.cg_staff_id()) with check(staff_id=public.cg_staff_id() and auth_user_id=auth.uid());
create function career_gate_private.guard_staff_presence() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.staff_id is distinct from public.cg_staff_id() or new.auth_user_id is distinct from auth.uid() then raise exception 'Presence identity does not match the authenticated employee' using errcode='42501'; end if;
 if new.path ~* '^/staff/client/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(/|$)' then
  if new.active_client_id is distinct from split_part(new.path,'/',4)::uuid or not public.cg_can_access_client(new.active_client_id) or not exists(select 1 from public.clients where id=new.active_client_id and deleted_at is null) then raise exception 'Client presence scope is unavailable' using errcode='42501'; end if;
 elsif new.active_client_id is not null then raise exception 'Client presence must match the open client route' using errcode='23514'; end if;
 new.seen_at:=now();return new;
end $$;
revoke all on function career_gate_private.guard_staff_presence() from public,anon;
grant execute on function career_gate_private.guard_staff_presence() to authenticated,service_role;
create trigger staff_presence_guard before insert or update on public.staff_presence for each row execute function career_gate_private.guard_staff_presence();
do $$ begin
 if to_regclass('realtime.messages') is not null then
 execute $policy$ create policy career_team_presence_receive on realtime.messages for select to authenticated using(extension='presence' and public.cg_staff_id() is not null and (realtime.topic()='team-presence:'||auth.uid()::text or (public.cg_staff_role() in ('admin','manager') and exists(select 1 from public.staff s where s.active and 'team-presence:'||s.auth_user_id::text=realtime.topic())))) $policy$;
 execute $policy$ create policy career_team_presence_publish on realtime.messages for insert to authenticated with check(extension='presence' and public.cg_staff_id() is not null and realtime.topic()='team-presence:'||auth.uid()::text) $policy$;
 end if;
end $$;
-- Recoverable deletion is a narrow management operation; ordinary staff and
-- general client RLS retain their existing archive visibility restrictions.
create function career_gate_private.archive_client(cid uuid,reason text,trace text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.clients%rowtype; actor uuid:=public.cg_staff_id();
begin
 if coalesce(public.cg_staff_role(),'') not in ('admin','manager') or actor is null then raise exception 'management_delete_required' using errcode='42501'; end if;
 if nullif(trim(reason),'') is null or length(reason)>500 then raise exception 'deletion_reason_required' using errcode='23514'; end if;
 select * into c from public.clients where id=cid for update;
 if not found then raise exception 'client_not_found' using errcode='P0002'; end if;
 if c.deleted_at is not null then return jsonb_build_object('id',cid,'changed',false,'archived',true); end if;
 if c.manager_review_id is not null then raise exception 'manager_review_pending' using errcode='P0001'; end if;
 update public.clients set deleted_at=now(),deleted_by=actor,delete_reason=trim(reason) where id=cid;
 insert into public.activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
 values(cid,'client_deleted',actor,'client',cid,jsonb_build_object('reason',trim(reason),'recoverable',true),trace);
 return jsonb_build_object('id',cid,'changed',true,'archived',true);
end $$;
revoke all on function career_gate_private.archive_client(uuid,text,text) from public,anon;
grant execute on function career_gate_private.archive_client(uuid,text,text) to authenticated;
-- Only the trusted server transaction prepares a decision. This private-schema
-- function is not a PostgREST RPC; it validates and locks both versions in SQL.
create function career_gate_private.prepare_manager_resolution(rid uuid,expected_primary text,expected_related text)
returns void language plpgsql security invoker set search_path='' as $$
declare i public.manager_inbox%rowtype; c public.clients%rowtype;
begin
 if coalesce(public.cg_staff_role(),'') not in ('admin','manager') then raise exception 'manager_access_required' using errcode='42501'; end if;
 select * into i from public.manager_inbox where id=rid for update;
 if not found or i.status<>'open' then raise exception 'review_not_open' using errcode='40001'; end if;
 for c in select * from public.clients where id=any(array[i.client_id,i.related_client_id]) order by id for update loop
  if c.deleted_at is not null or c.manager_review_id is distinct from rid then raise exception 'review_hold_changed' using errcode='40001'; end if;
  if (c.id=i.client_id and (expected_primary is null or c.updated_at::text<>expected_primary)) or
     (c.id=i.related_client_id and (expected_related is null or c.updated_at::text<>expected_related)) then
   raise exception 'client_changed' using errcode='40001';
  end if;
 end loop;
 perform set_config('cg.manager_resolution',rid::text,true);
end $$;
revoke all on function career_gate_private.prepare_manager_resolution(uuid,text,text) from public,anon;
grant execute on function career_gate_private.prepare_manager_resolution(uuid,text,text) to authenticated;

-- At transaction commit the recorded destination must match the actual file
-- location. A partially implemented command cannot release and stamp a file.
create function career_gate_private.verify_manager_dispatch() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.clients%rowtype; cid uuid;
begin
 if new.status<>'resolved' then return new; end if;
 for cid in select x from unnest(array[new.client_id,new.related_client_id]) x where x is not null loop
  select * into c from public.clients where id=cid;
  if c.manager_review_id=new.id then raise exception 'manager_hold_not_released' using errcode='23514'; end if;
  if c.deleted_at is null and new.resolution_action<>'return' and new.destination<>'keep_current' and c.operational_location<>new.destination then
   raise exception 'manager_destination_not_applied' using errcode='23514';
  end if;
 end loop;
 return new;
end $$;
revoke all on function career_gate_private.verify_manager_dispatch() from public,anon;
create constraint trigger manager_dispatch_atomic after update of status on public.manager_inbox
 deferrable initially deferred for each row execute function career_gate_private.verify_manager_dispatch();
commit;
