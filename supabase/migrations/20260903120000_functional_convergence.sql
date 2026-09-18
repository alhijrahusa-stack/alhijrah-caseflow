begin;

alter table public.service_catalog
  add column if not exists workflow_version integer not null default 1;

alter table public.cases
  add column if not exists service_workflow_version integer,
  add column if not exists service_plan_snapshot jsonb;

alter table public.document_requests
  add column if not exists requirement_code text,
  add column if not exists participant_role text,
  add column if not exists source text;

alter table public.tasks add column if not exists automation_key text;

alter table public.documents
  add column if not exists automation_status text not null default 'NOT_QUEUED',
  add column if not exists classification text,
  add column if not exists quality_status text,
  add column if not exists processing_error text;

do $$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.service_catalog'::regclass and conname='service_catalog_workflow_version_positive') then
    alter table public.service_catalog add constraint service_catalog_workflow_version_positive check(workflow_version>0);
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.cases'::regclass and conname='cases_service_plan_shape') then
    alter table public.cases add constraint cases_service_plan_shape check(
      (service_workflow_version is null and service_plan_snapshot is null)
      or(service_workflow_version>0 and jsonb_typeof(service_plan_snapshot)='object'
        and service_plan_snapshot->'version'=to_jsonb(service_workflow_version)
        and service_plan_snapshot->>'service_code'=service_code)
    ) not valid;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.document_requests'::regclass and conname='document_requests_requirement_code_shape') then
    alter table public.document_requests add constraint document_requests_requirement_code_shape check(requirement_code is null or requirement_code ~ '^[A-Z0-9][A-Z0-9_]{0,79}$');
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.documents'::regclass and conname='documents_automation_status_allowed') then
    alter table public.documents add constraint documents_automation_status_allowed check(automation_status in('NOT_QUEUED','QUEUED','PROCESSING','REVIEW_REQUIRED','RECAPTURE_REQUIRED','CONFLICT','VERIFIED','FAILED'));
  end if;
end;
$$;

alter table public.cases validate constraint cases_service_plan_shape;

create unique index if not exists document_requests_service_requirement_uidx
  on public.document_requests(case_id,requirement_code)
  where requirement_code is not null;
create unique index if not exists tasks_automation_key_uidx
  on public.tasks(automation_key)
  where automation_key is not null;
create index if not exists documents_automation_queue_idx
  on public.documents(automation_status,created_at)
  where archived_at is null and automation_status in('NOT_QUEUED','QUEUED','PROCESSING','FAILED');

comment on column public.cases.service_plan_snapshot is
  'Immutable-per-case snapshot of the selected versioned service workflow; operational routing only, never an eligibility decision.';
comment on column public.document_requests.requirement_code is
  'Stable requirement identity used to materialize a service plan idempotently.';
comment on column public.documents.automation_status is
  'Deterministic document processing state surfaced to staff and portals.';

-- A background extraction is requested by the uploader, but any authorized
-- document reviewer must be able to make the human decision. Case permission,
-- not requester identity, is therefore the review boundary for case documents.
create or replace function public.commit_verified_identity_extraction(
  p_extraction_id uuid,
  p_subject_type text,
  p_subject_id uuid,
  p_reviewed_fields jsonb)
returns table(subject_type text,subject_id uuid,committed_fields integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor uuid:=public.caseflow_actor_id();
  extraction public.document_extractions%rowtype;
  target_client uuid;
  target_case uuid;
  target_person uuid;
  proposal public.document_extracted_fields%rowtype;
  prior public.verified_canonical_fields%rowtype;
  next_id uuid;
  next_revision integer;
  key text;
  value jsonb;
  committed integer:=0;
  commit_time timestamptz:=clock_timestamp();
  allowed constant text[]:=array['legal_name','date_of_birth','place_of_birth','nationality','current_country','passport_number','passport_country','passport_expiration'];
begin
  if actor is null or not public.caseflow_actor_active() then raise exception 'Active authenticated reviewer required'; end if;
  if p_subject_type not in('client','person') then raise exception 'Invalid canonical subject type'; end if;
  if p_reviewed_fields is null or jsonb_typeof(p_reviewed_fields)<>'object' then raise exception 'Reviewed fields must be an object'; end if;

  select * into extraction from public.document_extractions where id=p_extraction_id for update;
  if not found or extraction.status<>'reviewing' or extraction.expires_at<=now()
     or(extraction.document_id is null and extraction.requested_by<>actor)
     or(extraction.document_id is not null and not public.caseflow_can_case(extraction.case_id,'documents.review'))
  then raise exception 'Extraction is not available for commit'; end if;

  if exists(select 1 from jsonb_object_keys(p_reviewed_fields) supplied where supplied<>all(allowed)) then raise exception 'Unsupported canonical field'; end if;
  if exists(select 1 from jsonb_each(p_reviewed_fields) supplied where jsonb_typeof(supplied.value)<>'string' or length(supplied.value#>>'{}')=0 or length(supplied.value#>>'{}')>180) then raise exception 'Invalid canonical field value'; end if;
  if exists(select 1 from jsonb_object_keys(p_reviewed_fields) supplied where not exists(select 1 from public.document_extracted_fields f where f.extraction_id=extraction.id and f.field_path=supplied and f.verification_status='proposed')) then raise exception 'Reviewed field has no extraction proposal'; end if;

  if p_subject_type='client' then
    if p_subject_id is null then
      if extraction.extraction_kind<>'identity_upload' or not public.caseflow_has_permission('clients.manage') or public.caseflow_scope('clients')<>'global' then raise exception 'Client creation is not authorized'; end if;
      if nullif(trim(both '"' from coalesce(p_reviewed_fields->'legal_name','null'::jsonb)::text),'null') is null then raise exception 'Legal name is required'; end if;
      target_client:=gen_random_uuid();
      insert into public.clients(id,legal_name,date_of_birth,place_of_birth,nationality,current_country,passport_number,passport_country,passport_expiration,preferred_language,created_by,updated_by)
      values(target_client,p_reviewed_fields->>'legal_name',nullif(p_reviewed_fields->>'date_of_birth','')::date,nullif(p_reviewed_fields->>'place_of_birth',''),nullif(p_reviewed_fields->>'nationality',''),nullif(p_reviewed_fields->>'current_country',''),nullif(p_reviewed_fields->>'passport_number',''),nullif(p_reviewed_fields->>'passport_country',''),nullif(p_reviewed_fields->>'passport_expiration','')::date,'English',actor,actor);
    else
      target_client:=p_subject_id;
      if extraction.document_id is null and not public.caseflow_can_client(target_client,'clients.manage') then raise exception 'Canonical client is not authorized'; end if;
      if extraction.document_id is not null and (extraction.client_id<>target_client or not public.caseflow_can_case(extraction.case_id,'documents.review')) then raise exception 'Extraction client mismatch'; end if;
      update public.clients set
        legal_name=case when p_reviewed_fields?'legal_name' then p_reviewed_fields->>'legal_name' else legal_name end,
        date_of_birth=case when p_reviewed_fields?'date_of_birth' then nullif(p_reviewed_fields->>'date_of_birth','')::date else date_of_birth end,
        place_of_birth=case when p_reviewed_fields?'place_of_birth' then nullif(p_reviewed_fields->>'place_of_birth','') else place_of_birth end,
        nationality=case when p_reviewed_fields?'nationality' then nullif(p_reviewed_fields->>'nationality','') else nationality end,
        current_country=case when p_reviewed_fields?'current_country' then nullif(p_reviewed_fields->>'current_country','') else current_country end,
        passport_number=case when p_reviewed_fields?'passport_number' then nullif(p_reviewed_fields->>'passport_number','') else passport_number end,
        passport_country=case when p_reviewed_fields?'passport_country' then nullif(p_reviewed_fields->>'passport_country','') else passport_country end,
        passport_expiration=case when p_reviewed_fields?'passport_expiration' then nullif(p_reviewed_fields->>'passport_expiration','')::date else passport_expiration end,
        updated_by=actor,updated_at=commit_time where id=target_client;
    end if;
    if extraction.document_id is not null then target_case:=extraction.case_id; end if;
  else
    if extraction.document_id is null or p_subject_id is null or not public.caseflow_can_case(extraction.case_id,'documents.review') or not exists(select 1 from public.case_people cp where cp.case_id=extraction.case_id and cp.person_id=p_subject_id) then raise exception 'Canonical participant is not authorized for the extraction case'; end if;
    target_client:=extraction.client_id;target_case:=extraction.case_id;target_person:=p_subject_id;
    update public.people set
      legal_name=case when p_reviewed_fields?'legal_name' then p_reviewed_fields->>'legal_name' else legal_name end,
      date_of_birth=case when p_reviewed_fields?'date_of_birth' then nullif(p_reviewed_fields->>'date_of_birth','')::date else date_of_birth end,
      place_of_birth=case when p_reviewed_fields?'place_of_birth' then nullif(p_reviewed_fields->>'place_of_birth','') else place_of_birth end,
      nationality=case when p_reviewed_fields?'nationality' then nullif(p_reviewed_fields->>'nationality','') else nationality end,
      current_country=case when p_reviewed_fields?'current_country' then nullif(p_reviewed_fields->>'current_country','') else current_country end,
      passport_number=case when p_reviewed_fields?'passport_number' then nullif(p_reviewed_fields->>'passport_number','') else passport_number end,
      passport_country=case when p_reviewed_fields?'passport_country' then nullif(p_reviewed_fields->>'passport_country','') else passport_country end,
      passport_expiration=case when p_reviewed_fields?'passport_expiration' then nullif(p_reviewed_fields->>'passport_expiration','')::date else passport_expiration end,
      identity_verification_status='verified',identity_verified_at=commit_time,identity_verified_by=actor,updated_at=commit_time where id=target_person;
  end if;

  update public.document_extracted_fields set reviewed_value=case when p_reviewed_fields?field_path then p_reviewed_fields->field_path else null end,verification_status=case when p_reviewed_fields?field_path then 'accepted' else 'rejected' end,reviewed_by=actor,reviewed_at=commit_time,updated_at=commit_time where extraction_id=extraction.id and verification_status='proposed';
  update public.document_extractions set status='confirmed',reviewed_by=actor,reviewed_at=commit_time,updated_at=commit_time where id=extraction.id and status='reviewing';

  for key,value in select * from jsonb_each(p_reviewed_fields) loop
    select * into proposal from public.document_extracted_fields where extraction_id=extraction.id and field_path=key and verification_status='accepted';
    if not found then raise exception 'Accepted proposal disappeared during commit'; end if;
    select * into prior from public.verified_canonical_fields vf where vf.subject_type=p_subject_type and vf.subject_id=coalesce(target_person,target_client) and vf.field_path=key and vf.status='current' for update;
    next_id:=gen_random_uuid();next_revision:=coalesce(prior.revision,0)+1;
    if prior.id is not null then update public.verified_canonical_fields set status='superseded',superseded_by=next_id,superseded_at=commit_time where id=prior.id; end if;
    insert into public.verified_canonical_fields(id,client_id,case_id,person_id,subject_type,subject_id,field_path,field_value,revision,source_extraction_id,source_field_id,source_document_id,source_document_version,source_sha256,verified_by,verified_at)
    values(next_id,target_client,target_case,target_person,p_subject_type,coalesce(target_person,target_client),key,value,next_revision,extraction.id,proposal.id,extraction.document_id,extraction.document_version,extraction.source_sha256,actor,commit_time);
    committed:=committed+1;
  end loop;

  insert into public.audit_events(id,actor_user_id,actor_label,action,entity_type,entity_id,client_id,case_id,metadata)
  select gen_random_uuid(),actor,coalesce(u.display_name,u.email,'Authenticated user'),'verified_identity_committed',p_subject_type,coalesce(target_person,target_client),target_client,target_case,jsonb_build_object('extraction_id',extraction.id,'subject_type',p_subject_type,'committed_fields',committed,'human_confirmed',true) from public.app_users u where u.auth_user_id=actor;
  return query select p_subject_type,coalesce(target_person,target_client),committed;
end;
$$;

revoke all on function public.commit_verified_identity_extraction(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.commit_verified_identity_extraction(uuid,text,uuid,jsonb) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
