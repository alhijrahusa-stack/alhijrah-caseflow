begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.manager_inbox add column import_case_id uuid references public.client_import_cases(id) on delete restrict,
  add column resolution_target jsonb;
alter table public.manager_inbox drop constraint manager_inbox_kind_check;
alter table public.manager_inbox add constraint manager_inbox_kind_check check(kind in ('client','report','import')),
  add constraint manager_import_source check((kind='import')=(import_case_id is not null)),
  add constraint manager_import_no_client_pointer check(kind<>'import' or (client_id is null and related_client_id is null)),
  add constraint manager_resolution_target_size check(resolution_target is null or octet_length(resolution_target::text)<2048);
alter table public.manager_inbox drop constraint manager_duplicate_pair;
alter table public.manager_inbox add constraint manager_duplicate_pair check(
  case when kind='import' then (request_type='duplicate')=(snapshot->'selected_target' is not null and snapshot->'selected_target'<>'null'::jsonb)
  else (request_type='duplicate')=(related_client_id is not null) end);
create unique index manager_inbox_open_import on public.manager_inbox(import_case_id) where status='open' and import_case_id is not null;
alter table public.client_import_cases add column manager_review_id uuid references public.manager_inbox(id) on delete restrict;
create index import_cases_active_review_queue on public.client_import_cases(created_at desc,id) where archived_at is null and status<>'APPROVED_FILE' and manager_review_id is null;

-- Import records have no canonical client_id. Keep their audit separate from
-- the mandatory client activity ledger, immutable and server-mediated.
create table public.import_review_events (
 id uuid primary key default gen_random_uuid(),
 import_case_id uuid not null references public.client_import_cases(id) on delete restrict,
 review_id uuid references public.manager_inbox(id) on delete restrict,
 event text not null check(event in ('requested','resolved','restored')),
 actor_id uuid not null references public.staff(id) on delete restrict,
 actor_name text not null,
 recorded_at timestamptz not null default now(),
 details jsonb not null default '{}' check(octet_length(details::text)<4096),
 trace_id text
);
create index import_review_events_case on public.import_review_events(import_case_id,recorded_at desc);
alter table public.import_review_events enable row level security;
create policy import_review_events_direct_api_deny on public.import_review_events for all to anon,authenticated using(false) with check(false);
revoke all on public.import_review_events from public,anon,authenticated;
create function career_gate_private.guard_import_review_events() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'import_review_history_is_immutable' using errcode='42501'; end $$;
create trigger import_review_events_immutable before update or delete on public.import_review_events for each row execute function career_gate_private.guard_import_review_events();
revoke all on function career_gate_private.guard_import_review_events() from public,anon,authenticated;

create function career_gate_private.import_review_name(value text) returns text language sql immutable parallel safe security invoker set search_path='' as $$
 select btrim(regexp_replace(career_gate_private.normalize_search(coalesce(value,'')),'[^[:alnum:]]+',' ','g'))
$$;
create function career_gate_private.import_review_phone(value text) returns text language sql immutable parallel safe security invoker set search_path='' as $$
 select case when length(n)=11 and left(n,1)='1' then right(n,10) else n end from
 (select regexp_replace(translate(coalesce(value,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g') n) p
$$;

-- Only this identity projection crosses the staging/client RLS boundary.
-- Raw drafts, SSNs, documents, finances and unrelated profile fields stay private.
create function career_gate_private.import_review_record(record_kind text,record_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if record_kind='import' then
  select jsonb_build_object('kind','import','id',c.id,'ref',coalesce(c.public_ref,'IMPORT-'||left(c.id::text,8)),
    'full_name',coalesce(c.mapped_draft#>>'{profile,full_name}',''),'phone',coalesce(c.mapped_draft#>>'{profile,phone}',''),
    'location',case when c.manager_review_id is null then 'import_queue' else 'manager' end,'status',c.status,
    'version',c.updated_at::text,'held',c.manager_review_id is not null,'href','/staff/import?case='||c.id::text)
  into result from public.client_import_cases c where c.id=record_id and c.archived_at is null and c.status<>'APPROVED_FILE';
 elsif record_kind='client' then
  select jsonb_build_object('kind','client','id',c.id,'ref',c.ref,'full_name',c.full_name,'phone',c.phone,
    'location',c.operational_location,'status',c.current_status,'version',c.updated_at::text,
    'held',c.manager_review_id is not null,'href','/staff/client/'||c.id::text)
  into result from public.clients c where c.id=record_id and c.deleted_at is null;
 end if;
 return result;
end $$;

create function career_gate_private.import_review_scan(source_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare source jsonb; matches jsonb; total integer; exact_count integer; name_key text; phone_key text;
begin
 source:=career_gate_private.import_review_record('import',source_id);
 if source is null then raise exception 'import_source_unavailable' using errcode='P0001'; end if;
 name_key:=career_gate_private.import_review_name(source->>'full_name');phone_key:=career_gate_private.import_review_phone(source->>'phone');
 with candidates as (
  select 'client'::text kind,c.id from public.clients c where c.deleted_at is null
   and c.id is distinct from (select created_client_id from public.client_import_cases where id=source_id)
   and ((name_key<>'' and career_gate_private.import_review_name(c.full_name)=name_key)
     or (phone_key<>'' and career_gate_private.import_review_phone(c.phone)=phone_key))
  union all
  select 'import',c.id from public.client_import_cases c where c.id<>source_id and c.archived_at is null and c.status<>'APPROVED_FILE'
   and ((name_key<>'' and career_gate_private.import_review_name(c.mapped_draft#>>'{profile,full_name}')=name_key)
     or (phone_key<>'' and career_gate_private.import_review_phone(c.mapped_draft#>>'{profile,phone}')=phone_key))
 ), compared as (
  select career_gate_private.import_review_record(kind,id) record from candidates
 ), marked as (
  select record||jsonb_build_object('name_match',name_key<>'' and career_gate_private.import_review_name(record->>'full_name')=name_key,
   'phone_match',phone_key<>'' and career_gate_private.import_review_phone(record->>'phone')=phone_key) record from compared
 ), ranked as (
  select record||jsonb_build_object('level',case when (record->>'name_match')::boolean and (record->>'phone_match')::boolean then 'exact' else 'partial' end) record from marked
 ) select coalesce(jsonb_agg(record order by (record->>'level'='exact') desc,record->>'full_name',record->>'id'),'[]'),count(*)::int,
  count(*) filter(where record->>'level'='exact')::int into matches,total,exact_count from ranked;
 return jsonb_build_object('source',source,'matches',matches,'match_count',total,'exact_count',exact_count,'partial_count',total-exact_count,
  'level',case when exact_count>0 then 'exact' when total>0 then 'partial' when name_key='' or phone_key='' then 'insufficient' else 'none' end,
  'checked_at',now(),'fingerprint',md5(jsonb_build_object('source',source,'matches',matches)::text));
end $$;

-- One narrow, authenticated command surface. No new Data API table grants.
create function career_gate_private.import_review_command(command text,input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.staff%rowtype; source public.client_import_cases%rowtype; item public.manager_inbox%rowtype;
 result jsonb; scan jsonb; target jsonb; selected jsonb; saved jsonb; sid uuid; rid uuid; target_id uuid;
 reason text; decision text; record_kind text; term text; page_number integer; total integer;
begin
 select * into actor from public.staff where auth_user_id=auth.uid() and active;
 if not found or actor.role not in ('admin','manager','staff') then raise exception 'import_review_access_required' using errcode='42501'; end if;
 if actor.role='staff' and actor.permission_mode<>'full' and not ('add_task'=any(actor.custom_permissions)) then
  raise exception 'import_review_permission_required' using errcode='42501'; end if;
 if command in ('resolve','trash','restore') and actor.role not in ('admin','manager') then raise exception 'manager_access_required' using errcode='42501'; end if;
 if command='queue' then
  term:=left(coalesce(input->>'q',''),100);page_number:=greatest(1,least(100000,coalesce((input->>'page')::integer,1)));
  select count(*)::int into total from public.client_import_cases c where c.archived_at is null and c.status<>'APPROVED_FILE' and c.manager_review_id is null
   and (term='' or strpos(lower(coalesce(c.mapped_draft#>>'{profile,full_name}','')||' '||coalesce(c.mapped_draft#>>'{profile,phone}','')||' '||coalesce(c.public_ref,c.id::text)),lower(term))>0);
  select coalesce(jsonb_agg(career_gate_private.import_review_record('import',q.id) order by q.created_at desc,q.id desc),'[]') into result from
   (select c.id,c.created_at from public.client_import_cases c where c.archived_at is null and c.status<>'APPROVED_FILE' and c.manager_review_id is null
    and (term='' or strpos(lower(coalesce(c.mapped_draft#>>'{profile,full_name}','')||' '||coalesce(c.mapped_draft#>>'{profile,phone}','')||' '||coalesce(c.public_ref,c.id::text)),lower(term))>0)
    order by c.created_at desc,c.id desc limit 50 offset (page_number-1)*50) q;
  return jsonb_build_object('rows',result,'total',total,'page',page_number,'page_size',50);
 elsif command='scan' then
  return career_gate_private.import_review_scan((input->>'case_id')::uuid);
 elsif command='submit' then
  sid:=(input->>'case_id')::uuid;
  select * into source from public.client_import_cases where id=sid for update;
  if not found or source.archived_at is not null or source.status='APPROVED_FILE' then raise exception 'import_source_unavailable' using errcode='P0001'; end if;
  if source.manager_review_id is not null then raise exception 'import_already_with_manager' using errcode='P0001'; end if;
  scan:=career_gate_private.import_review_scan(sid);
  if input->>'fingerprint' is distinct from scan->>'fingerprint' then raise exception 'duplicate_scan_stale' using errcode='40001'; end if;
  reason:=input->>'reason';
  if reason not in ('exact_duplicate','possible_duplicate','manager_review','incorrect_record') or reason is null then raise exception 'import_reason_required' using errcode='23514'; end if;
  if input->>'target_id' is not null then
   select m into selected from jsonb_array_elements(scan->'matches') m where m->>'id'=input->>'target_id' and m->>'kind'=input->>'target_kind';
   if selected is null then raise exception 'duplicate_target_unverified' using errcode='23514'; end if;
  end if;
  if reason='exact_duplicate' and coalesce(selected->>'level','')<>'exact' then raise exception 'duplicate_target_unverified' using errcode='23514'; end if;
  if reason='possible_duplicate' and selected is null then raise exception 'duplicate_target_unverified' using errcode='23514'; end if;
  if selected is null and (scan->>'match_count')::integer>0 then raise exception 'duplicate_target_unverified' using errcode='23514'; end if;
  saved:=(scan-'matches')||jsonb_build_object('type','import_duplicate_review','selected_target',selected,'matches',case when selected is null then '[]'::jsonb else jsonb_build_array(selected) end,'reason_code',reason);
  perform set_config('cg.import_review_submit',sid::text,true);
  insert into public.manager_inbox(request_key,kind,import_case_id,request_type,original_location,title,submitted_note,source_path,snapshot,submitted_by)
   values((input->>'operation_id')::uuid,'import',sid,case when selected is null then 'review' else 'duplicate' end,'import_queue',
    left(coalesce(source.public_ref,'IMPORT-'||left(sid::text,8))||' · '||coalesce(source.mapped_draft#>>'{profile,full_name}',''),200),reason,'/staff/import?case='||sid::text,saved,actor.id) returning id into rid;
  insert into public.import_review_events(import_case_id,review_id,event,actor_id,actor_name,details,trace_id)
   values(sid,rid,'requested',actor.id,actor.display_name,jsonb_build_object('operation','import_manager_review_requested','request_id',rid,'reason',reason,'fingerprint',scan->>'fingerprint'),input->>'trace_id');
  return jsonb_build_object('id',rid,'review_id',rid,'created',true);
 elsif command='resolve' then
  rid:=(input->>'id')::uuid;
  select * into item from public.manager_inbox where id=rid for update;
  if not found or item.kind<>'import' then raise exception 'import_review_unavailable' using errcode='P0001'; end if;
  if item.status='resolved' then return jsonb_build_object('id',rid,'already_resolved',true,'client_id',null,'task_id',null); end if;
  sid:=item.import_case_id;
  -- Lock import comparison pairs in one order, even for opposite requests.
  perform c.id from public.client_import_cases c where c.id=sid or (item.snapshot#>>'{selected_target,kind}'='import' and c.id=(item.snapshot#>>'{selected_target,id}')::uuid) order by c.id for update;
  select * into source from public.client_import_cases where id=sid for update;
  if source.manager_review_id is distinct from rid or source.archived_at is not null or source.status='APPROVED_FILE' then raise exception 'import_review_changed' using errcode='40001'; end if;
  if career_gate_private.import_review_name(source.mapped_draft#>>'{profile,full_name}') is distinct from career_gate_private.import_review_name(item.snapshot#>>'{source,full_name}')
   or career_gate_private.import_review_phone(source.mapped_draft#>>'{profile,phone}') is distinct from career_gate_private.import_review_phone(item.snapshot#>>'{source,phone}') then raise exception 'import_review_changed' using errcode='40001'; end if;
  decision:=coalesce(input->>'action','return');
  if decision not in ('delete','return','not_duplicate','approve') then raise exception 'invalid_import_decision' using errcode='23514'; end if;
  selected:=null;
  if decision='delete' then
   -- Validate BOTH identities automatically; no new manual scan is required.
   if item.snapshot->'selected_target' is not null and item.snapshot->'selected_target'<>'null'::jsonb then
    if item.snapshot#>>'{selected_target,kind}'='client' then perform c.id from public.clients c where c.id=(item.snapshot#>>'{selected_target,id}')::uuid for update; end if;
    target:=career_gate_private.import_review_record(item.snapshot#>>'{selected_target,kind}',(item.snapshot#>>'{selected_target,id}')::uuid);
    if target is null or career_gate_private.import_review_name(target->>'full_name') is distinct from career_gate_private.import_review_name(item.snapshot#>>'{selected_target,full_name}')
      or career_gate_private.import_review_phone(target->>'phone') is distinct from career_gate_private.import_review_phone(item.snapshot#>>'{selected_target,phone}') then raise exception 'import_review_changed' using errcode='40001'; end if;
   end if;
   record_kind:=input->>'delete_record_kind';target_id:=(input->>'delete_record_id')::uuid;
   if record_kind='import' and target_id=sid then selected:=item.snapshot->'source';
   elsif item.snapshot#>>'{selected_target,id}'=target_id::text and item.snapshot#>>'{selected_target,kind}'=record_kind then selected:=item.snapshot->'selected_target';
   end if;
   if selected is null then raise exception 'duplicate_target_unverified' using errcode='23514'; end if;
   if record_kind='import' then perform id from public.client_import_cases where id=target_id for update;
   elsif record_kind='client' then perform id from public.clients where id=target_id for update;
   else raise exception 'duplicate_target_unverified' using errcode='23514'; end if;
   target:=career_gate_private.import_review_record(record_kind,target_id);
   if target is null or (target_id<>sid and coalesce((target->>'held')::boolean,false))
    or career_gate_private.import_review_name(target->>'full_name') is distinct from career_gate_private.import_review_name(selected->>'full_name')
    or career_gate_private.import_review_phone(target->>'phone') is distinct from career_gate_private.import_review_phone(selected->>'phone') then raise exception 'import_review_changed' using errcode='40001'; end if;
  end if;
  perform set_config('cg.manager_resolution',rid::text,true);perform set_config('cg.import_review_resolve',rid::text,true);
  update public.manager_inbox set status='resolved',destination='keep_current',resolution_action=decision,resolution_note=case when decision='delete' then 'Manager-approved recoverable deletion' else 'Returned to Import Queue' end,
   resolution_target=case when decision='delete' then jsonb_build_object('kind',record_kind,'id',target_id) else null end,
   resolved_by=actor.id,resolved_at=now() where id=rid;
  if decision='delete' then
   if record_kind='import' then update public.client_import_cases set archived_at=now(),archived_by=actor.id where id=target_id;
   else perform career_gate_private.archive_client(target_id,'Manager-approved duplicate review: '||item.submitted_note,coalesce(input->>'trace_id','import-review')); end if;
  end if;
  insert into public.import_review_events(import_case_id,review_id,event,actor_id,actor_name,details,trace_id)
   values(sid,rid,'resolved',actor.id,actor.display_name,jsonb_build_object('operation','import_manager_review_resolved','request_id',rid,'decision',decision,'target_kind',record_kind,'target_id',target_id),input->>'trace_id');
  return jsonb_build_object('id',rid,'already_resolved',false,'client_id',null,'task_id',null);
 elsif command='trash' then
  select coalesce(jsonb_agg(x order by x.archived_at desc),'[]') into result from
   (select c.id,coalesce(c.public_ref,'IMPORT-'||left(c.id::text,8)) ref,c.mapped_draft#>>'{profile,full_name}' full_name,c.mapped_draft#>>'{profile,phone}' phone,c.archived_at,s.display_name archived_by,
    (select count(*) from public.client_import_documents d where d.import_case_id=c.id) documents,
    (select i.submitted_note from public.manager_inbox i where i.kind='import' and i.resolution_target->>'kind'='import' and i.resolution_target->>'id'=c.id::text and i.resolution_action='delete' order by i.resolved_at desc limit 1) reason
    from public.client_import_cases c left join public.staff s on s.id=c.archived_by where c.archived_at is not null) x;
  return jsonb_build_object('rows',result);
 elsif command='restore' then
  sid:=(input->>'case_id')::uuid;select * into source from public.client_import_cases where id=sid for update;
  if not found then raise exception 'import_source_unavailable' using errcode='P0001'; end if;
  if source.archived_at is null then return jsonb_build_object('id',sid,'restored',true,'idempotent',true); end if;
  if source.manager_review_id is not null then raise exception 'import_already_with_manager' using errcode='P0001'; end if;
  update public.client_import_cases set archived_at=null,archived_by=null where id=sid;
  insert into public.import_review_events(import_case_id,event,actor_id,actor_name,details,trace_id)
   values(sid,'restored',actor.id,actor.display_name,jsonb_build_object('operation','import_restored'),input->>'trace_id');
  return jsonb_build_object('id',sid,'restored',true,'idempotent',false);
 end if;
 raise exception 'invalid_import_command' using errcode='23514';
end $$;

create function career_gate_private.guard_import_manager_review() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and new.import_case_id is distinct from old.import_case_id then raise exception 'manager_review_submission_is_immutable' using errcode='42501'; end if;
 if new.kind='import' then
  if current_user is distinct from (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid='career_gate_private.import_review_command(text,jsonb)'::regprocedure) then raise exception 'import_review_requires_verified_command' using errcode='42501'; end if;
  if tg_op='INSERT' and current_setting('cg.import_review_submit',true) is distinct from new.import_case_id::text then raise exception 'import_review_requires_verified_command' using errcode='42501'; end if;
  if tg_op='UPDATE' and (current_setting('cg.import_review_resolve',true) is distinct from new.id::text or new.destination<>'keep_current') then raise exception 'import_review_requires_verified_command' using errcode='42501'; end if;
 end if;
 return new;
end $$;
create trigger manager_import_command_guard before insert or update on public.manager_inbox for each row execute function career_gate_private.guard_import_manager_review();

create function career_gate_private.sync_import_manager_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if new.status='open' then
  update public.client_import_cases set manager_review_id=new.id where id=new.import_case_id and manager_review_id is null and archived_at is null and status<>'APPROVED_FILE';
  get diagnostics affected=row_count;if affected<>1 then raise exception 'import_already_with_manager' using errcode='P0001'; end if;
 else update public.client_import_cases set manager_review_id=null where id=new.import_case_id and manager_review_id=new.id;
 end if;
 return new;
end $$;
create trigger manager_import_dispatch after insert or update of status on public.manager_inbox for each row when(new.kind='import') execute function career_gate_private.sync_import_manager_review();

create function career_gate_private.guard_import_manager_hold() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.manager_review_id is not null and new.manager_review_id is distinct from old.manager_review_id and not exists
  (select 1 from public.manager_inbox i where i.id=new.manager_review_id and i.import_case_id=new.id and i.status='open') then raise exception 'invalid_import_review_pointer' using errcode='42501'; end if;
 if old.manager_review_id is not null and exists(select 1 from public.manager_inbox i where i.id=old.manager_review_id and i.status='open') then
  if tg_op='DELETE' then raise exception 'import_manager_review_pending' using errcode='P0001'; end if;
  if (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then raise exception 'import_manager_review_pending' using errcode='P0001'; end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger import_case_manager_hold before update or delete on public.client_import_cases for each row execute function career_gate_private.guard_import_manager_hold();

create function career_gate_private.verify_import_manager_resolution() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.client_import_cases where id=new.import_case_id and manager_review_id=new.id) then raise exception 'import_hold_not_released' using errcode='23514'; end if;
 if new.resolution_action='delete' and not coalesce((
  (new.resolution_target->>'kind'='import' and exists(select 1 from public.client_import_cases where id=(new.resolution_target->>'id')::uuid and archived_at is not null)) or
  (new.resolution_target->>'kind'='client' and exists(select 1 from public.clients where id=(new.resolution_target->>'id')::uuid and deleted_at is not null))),false) then raise exception 'import_deletion_not_applied' using errcode='23514'; end if;
 return new;
end $$;
create constraint trigger manager_import_atomic after update of status on public.manager_inbox deferrable initially deferred for each row when(new.kind='import' and new.status='resolved') execute function career_gate_private.verify_import_manager_resolution();

create or replace function career_gate_private.active_smart_client_count() returns integer language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(public.cg_staff_role(),'') not in ('admin','manager') then raise exception 'manager_access_required' using errcode='42501'; end if;
 return (select count(*)::integer from public.client_import_cases where archived_at is null and status<>'APPROVED_FILE' and manager_review_id is null);
end $$;

revoke all on function career_gate_private.import_review_name(text),career_gate_private.import_review_phone(text),career_gate_private.import_review_record(text,uuid),career_gate_private.import_review_scan(uuid),career_gate_private.import_review_command(text,jsonb),career_gate_private.guard_import_manager_review(),career_gate_private.sync_import_manager_review(),career_gate_private.guard_import_manager_hold(),career_gate_private.verify_import_manager_resolution() from public,anon,authenticated;
grant execute on function career_gate_private.import_review_command(text,jsonb),career_gate_private.guard_import_manager_review() to authenticated;
commit;
