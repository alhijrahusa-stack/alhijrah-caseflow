begin;

create table if not exists public.verified_canonical_fields(
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  case_id uuid references public.cases(id) on delete restrict,
  person_id uuid references public.people(id) on delete restrict,
  subject_type text not null check(subject_type in('client','person')),
  subject_id uuid not null,
  field_path text not null check(field_path ~ '^[a-z][a-z0-9_]{0,119}$'),
  field_value jsonb not null,
  revision integer not null check(revision>0),
  status text not null default 'current' check(status in('current','superseded')),
  source_extraction_id uuid not null references public.document_extractions(id) on delete restrict,
  source_field_id uuid not null unique references public.document_extracted_fields(id) on delete restrict,
  source_document_id uuid references public.documents(id) on delete restrict,
  source_document_version integer,
  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  verification_method text not null default 'human_review' check(verification_method='human_review'),
  verified_by uuid not null references public.app_users(auth_user_id) on delete restrict,
  verified_at timestamptz not null default now(),
  superseded_by uuid references public.verified_canonical_fields(id) on delete restrict deferrable initially deferred,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  check((subject_type='client' and subject_id=client_id and person_id is null)
    or(subject_type='person' and subject_id=person_id and person_id is not null)),
  check((source_document_id is null and source_document_version is null and case_id is null)
    or(source_document_id is not null and source_document_version is not null and case_id is not null)),
  check((status='current' and superseded_by is null and superseded_at is null)
    or(status='superseded' and superseded_by is not null and superseded_at is not null))
);

create unique index if not exists verified_canonical_fields_current_idx
  on public.verified_canonical_fields(subject_type,subject_id,field_path) where status='current';
create index if not exists verified_canonical_fields_client_idx
  on public.verified_canonical_fields(client_id,verified_at desc);
create index if not exists verified_canonical_fields_case_idx
  on public.verified_canonical_fields(case_id,verified_at desc) where case_id is not null;

create or replace function public.protect_verified_canonical_field()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare extraction public.document_extractions%rowtype; proposal public.document_extracted_fields%rowtype;
begin
  if tg_op='DELETE' then raise exception 'Verified canonical provenance is immutable'; end if;
  if tg_op='UPDATE' then
    if old.status<>'current' or new.status<>'superseded'
       or new.superseded_by is null or new.superseded_at is null
       or (to_jsonb(old)-'status'-'superseded_by'-'superseded_at')
          is distinct from (to_jsonb(new)-'status'-'superseded_by'-'superseded_at') then
      raise exception 'Verified canonical provenance is immutable';
    end if;
    return new;
  end if;
  select * into extraction from public.document_extractions where id=new.source_extraction_id;
  select * into proposal from public.document_extracted_fields where id=new.source_field_id;
  if not found or proposal.extraction_id<>new.source_extraction_id or proposal.field_path<>new.field_path
     or proposal.verification_status<>'accepted' or proposal.reviewed_value is distinct from new.field_value
     or proposal.reviewed_by is distinct from new.verified_by or proposal.reviewed_at is distinct from new.verified_at then
    raise exception 'Canonical value must match its accepted reviewed proposal';
  end if;
  if extraction.id is null or extraction.status<>'confirmed' or extraction.reviewed_by is distinct from new.verified_by
     or extraction.reviewed_at is distinct from new.verified_at
     or extraction.source_sha256<>new.source_sha256
     or extraction.document_id is distinct from new.source_document_id
     or extraction.document_version is distinct from new.source_document_version
     or extraction.case_id is distinct from new.case_id or extraction.client_id is distinct from
       (case when new.source_document_id is null then null else new.client_id end) then
    raise exception 'Canonical value must match its confirmed extraction';
  end if;
  if new.subject_type='client' and new.client_id<>new.subject_id then
    raise exception 'Canonical client subject mismatch';
  end if;
  if new.subject_type='person' and not exists(select 1 from public.case_people cp
      where cp.case_id=new.case_id and cp.person_id=new.person_id)
  then raise exception 'Canonical participant is not linked to the extraction case'; end if;
  return new;
end;
$$;

do $$ begin
  if not exists(select 1 from pg_trigger where tgname='verified_canonical_fields_provenance_pin'
      and tgrelid='public.verified_canonical_fields'::regclass and not tgisinternal) then
    create trigger verified_canonical_fields_provenance_pin before insert or update or delete
      on public.verified_canonical_fields for each row execute function public.protect_verified_canonical_field();
  end if;
end $$;

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
  reviewed_at timestamptz:=clock_timestamp();
  allowed constant text[]:=array['legal_name','date_of_birth','place_of_birth','nationality','current_country','passport_number','passport_country','passport_expiration'];
begin
  if actor is null or not public.caseflow_actor_active() then raise exception 'Active authenticated reviewer required'; end if;
  if p_subject_type not in('client','person') then raise exception 'Invalid canonical subject type'; end if;
  if p_reviewed_fields is null or jsonb_typeof(p_reviewed_fields)<>'object' then raise exception 'Reviewed fields must be an object'; end if;

  select * into extraction from public.document_extractions where id=p_extraction_id for update;
  if not found or extraction.status<>'reviewing' or extraction.requested_by<>actor
     or extraction.expires_at<=now() then raise exception 'Extraction is not available for commit'; end if;

  if exists(select 1 from jsonb_object_keys(p_reviewed_fields) supplied
      where supplied<>all(allowed)) then raise exception 'Unsupported canonical field'; end if;
  if exists(select 1 from jsonb_each(p_reviewed_fields) supplied
      where jsonb_typeof(supplied.value)<>'string' or length(supplied.value#>>'{}')=0
        or length(supplied.value#>>'{}')>180) then raise exception 'Invalid canonical field value'; end if;
  if exists(select 1 from jsonb_object_keys(p_reviewed_fields) supplied
      where not exists(select 1 from public.document_extracted_fields f
        where f.extraction_id=extraction.id and f.field_path=supplied and f.verification_status='proposed'))
  then raise exception 'Reviewed field has no extraction proposal'; end if;

  if p_subject_type='client' then
    if p_subject_id is null then
      if extraction.extraction_kind<>'identity_upload' or not public.caseflow_has_permission('clients.manage')
         or public.caseflow_scope('clients')<>'global' then raise exception 'Client creation is not authorized'; end if;
      if nullif(trim(both '"' from coalesce(p_reviewed_fields->'legal_name','null'::jsonb)::text),'null') is null
      then raise exception 'Legal name is required'; end if;
      target_client:=gen_random_uuid();
      insert into public.clients(id,legal_name,date_of_birth,place_of_birth,nationality,current_country,
        passport_number,passport_country,passport_expiration,preferred_language,created_by,updated_by)
      values(target_client,p_reviewed_fields->>'legal_name',nullif(p_reviewed_fields->>'date_of_birth','')::date,
        nullif(p_reviewed_fields->>'place_of_birth',''),nullif(p_reviewed_fields->>'nationality',''),
        nullif(p_reviewed_fields->>'current_country',''),nullif(p_reviewed_fields->>'passport_number',''),
        nullif(p_reviewed_fields->>'passport_country',''),nullif(p_reviewed_fields->>'passport_expiration','')::date,
        'English',actor,actor);
    else
      target_client:=p_subject_id;
      if not public.caseflow_can_client(target_client,'clients.manage') then raise exception 'Canonical client is not authorized'; end if;
      if extraction.document_id is not null and extraction.client_id<>target_client then raise exception 'Extraction client mismatch'; end if;
      update public.clients set
        legal_name=case when p_reviewed_fields?'legal_name' then p_reviewed_fields->>'legal_name' else legal_name end,
        date_of_birth=case when p_reviewed_fields?'date_of_birth' then nullif(p_reviewed_fields->>'date_of_birth','')::date else date_of_birth end,
        place_of_birth=case when p_reviewed_fields?'place_of_birth' then nullif(p_reviewed_fields->>'place_of_birth','') else place_of_birth end,
        nationality=case when p_reviewed_fields?'nationality' then nullif(p_reviewed_fields->>'nationality','') else nationality end,
        current_country=case when p_reviewed_fields?'current_country' then nullif(p_reviewed_fields->>'current_country','') else current_country end,
        passport_number=case when p_reviewed_fields?'passport_number' then nullif(p_reviewed_fields->>'passport_number','') else passport_number end,
        passport_country=case when p_reviewed_fields?'passport_country' then nullif(p_reviewed_fields->>'passport_country','') else passport_country end,
        passport_expiration=case when p_reviewed_fields?'passport_expiration' then nullif(p_reviewed_fields->>'passport_expiration','')::date else passport_expiration end,
        updated_by=actor,updated_at=reviewed_at where id=target_client;
    end if;
    if extraction.document_id is not null then target_case:=extraction.case_id; end if;
  else
    if extraction.document_id is null or p_subject_id is null
       or not public.caseflow_can_case(extraction.case_id,'documents.manage')
       or not exists(select 1 from public.case_people cp where cp.case_id=extraction.case_id and cp.person_id=p_subject_id)
    then raise exception 'Canonical participant is not authorized for the extraction case'; end if;
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
      identity_verification_status='verified',identity_verified_at=reviewed_at,identity_verified_by=actor,
      updated_at=reviewed_at where id=target_person;
  end if;

  update public.document_extracted_fields set
    reviewed_value=case when p_reviewed_fields?field_path then p_reviewed_fields->field_path else null end,
    verification_status=case when p_reviewed_fields?field_path then 'accepted' else 'rejected' end,
    reviewed_by=actor,reviewed_at=reviewed_at,updated_at=reviewed_at
    where extraction_id=extraction.id and verification_status='proposed';
  update public.document_extractions set status='confirmed',reviewed_by=actor,reviewed_at=reviewed_at,updated_at=reviewed_at
    where id=extraction.id and status='reviewing';

  for key,value in select * from jsonb_each(p_reviewed_fields) loop
    select * into proposal from public.document_extracted_fields
      where extraction_id=extraction.id and field_path=key and verification_status='accepted';
    if not found then raise exception 'Accepted proposal disappeared during commit'; end if;
    select * into prior from public.verified_canonical_fields
      where subject_type=p_subject_type and subject_id=coalesce(target_person,target_client) and field_path=key and status='current'
      for update;
    next_id:=gen_random_uuid();next_revision:=coalesce(prior.revision,0)+1;
    if prior.id is not null then update public.verified_canonical_fields set status='superseded',superseded_by=next_id,superseded_at=reviewed_at where id=prior.id; end if;
    insert into public.verified_canonical_fields(id,client_id,case_id,person_id,subject_type,subject_id,field_path,field_value,
      revision,source_extraction_id,source_field_id,source_document_id,source_document_version,source_sha256,verified_by,verified_at)
    values(next_id,target_client,target_case,target_person,p_subject_type,coalesce(target_person,target_client),key,value,next_revision,
      extraction.id,proposal.id,extraction.document_id,extraction.document_version,extraction.source_sha256,actor,reviewed_at);
    committed:=committed+1;
  end loop;

  insert into public.audit_events(id,actor_user_id,actor_label,action,entity_type,entity_id,client_id,case_id,metadata)
  select gen_random_uuid(),actor,coalesce(u.display_name,u.email,'Authenticated user'),'verified_identity_committed',
    p_subject_type,coalesce(target_person,target_client),target_client,target_case,
    jsonb_build_object('extraction_id',extraction.id,'subject_type',p_subject_type,'committed_fields',committed,'human_confirmed',true)
    from public.app_users u where u.auth_user_id=actor;
  return query select p_subject_type,coalesce(target_person,target_client),committed;
end;
$$;

alter table public.verified_canonical_fields enable row level security;
alter table public.verified_canonical_fields force row level security;
revoke all on public.verified_canonical_fields from public,anon,authenticated;
grant select on public.verified_canonical_fields to authenticated;
grant select,insert,update on public.verified_canonical_fields to service_role;

create policy verified_canonical_fields_read_floor on public.verified_canonical_fields for select to authenticated using(
  (subject_type='client' and public.caseflow_can_client(client_id,'clients.view'))
  or(subject_type='person' and case_id is not null and public.caseflow_can_case(case_id,'cases.view')));

revoke all on function public.commit_verified_identity_extraction(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.commit_verified_identity_extraction(uuid,text,uuid,jsonb) to authenticated,service_role;

comment on table public.verified_canonical_fields is 'Versioned human-confirmed canonical facts. Source extraction, reviewed proposal, immutable document bytes, reviewer and supersession chain are permanently pinned.';
comment on function public.commit_verified_identity_extraction(uuid,text,uuid,jsonb) is 'Authenticated atomic commit boundary from reviewed OCR proposal to canonical subject and versioned verified facts; never callable by anon.';

commit;
