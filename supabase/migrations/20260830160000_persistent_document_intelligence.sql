begin;

create table if not exists public.document_extractions(
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete restrict,
  case_id uuid references public.cases(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  document_version integer,
  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  review_token_hash text not null unique check(review_token_hash ~ '^[0-9a-f]{64}$'),
  extraction_kind text not null check(extraction_kind in('identity_upload','document_identity')),
  engine text not null,
  engine_version text not null,
  status text not null default 'pending_review' check(status in('pending_review','reviewing','confirmed','rejected','expired')),
  confidence numeric(5,2) check(confidence is null or confidence between 0 and 100),
  mrz_detected boolean not null default false,
  mrz_valid boolean not null default false,
  raw_text text,
  raw_result jsonb not null,
  requested_by uuid not null references public.app_users(auth_user_id) on delete restrict,
  reviewed_by uuid references public.app_users(auth_user_id) on delete restrict,
  expires_at timestamptz not null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(expires_at>created_at),
  check(raw_text is null or char_length(raw_text)<=20000),
  check((status in('confirmed','rejected') and reviewed_by is not null and reviewed_at is not null) or status in('pending_review','reviewing','expired')),
  check((document_id is null and case_id is null and client_id is null and document_version is null and extraction_kind='identity_upload')
    or(document_id is not null and case_id is not null and client_id is not null and document_version is not null and extraction_kind='document_identity'))
);

create table if not exists public.document_extracted_fields(
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.document_extractions(id) on delete restrict,
  field_path text not null check(field_path ~ '^[a-z][a-z0-9_]{0,119}$'),
  extracted_value jsonb not null,
  reviewed_value jsonb,
  confidence numeric(5,2) check(confidence is null or confidence between 0 and 100),
  source_locator jsonb not null default '{}'::jsonb,
  verification_status text not null default 'proposed' check(verification_status in('proposed','accepted','rejected')),
  reviewed_by uuid references public.app_users(auth_user_id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((verification_status='proposed' and reviewed_by is null and reviewed_at is null)
    or(verification_status in('accepted','rejected') and reviewed_by is not null and reviewed_at is not null)),
  unique(extraction_id,field_path)
);

create index if not exists document_extractions_document_idx on public.document_extractions(document_id,created_at desc);
create index if not exists document_extractions_case_idx on public.document_extractions(case_id,created_at desc) where case_id is not null;
create index if not exists document_extractions_expiry_idx on public.document_extractions(expires_at) where status in('pending_review','reviewing');

create or replace function public.protect_document_extraction_source()
returns trigger language plpgsql set search_path=public as $$
declare source public.documents%rowtype;
begin
  if tg_op='DELETE' then raise exception 'Document extraction provenance is immutable'; end if;
  if tg_op='UPDATE' then
    if old.document_id is distinct from new.document_id or old.case_id is distinct from new.case_id
       or old.client_id is distinct from new.client_id or old.document_version is distinct from new.document_version
       or old.source_sha256 is distinct from new.source_sha256 or old.extraction_kind is distinct from new.extraction_kind
       or old.engine is distinct from new.engine or old.engine_version is distinct from new.engine_version
       or old.raw_result is distinct from new.raw_result or old.raw_text is distinct from new.raw_text
       or old.requested_by is distinct from new.requested_by or old.review_token_hash is distinct from new.review_token_hash
       or old.created_at is distinct from new.created_at then raise exception 'Document extraction source is immutable'; end if;
    if old.status in('confirmed','rejected','expired') and old.status is distinct from new.status then raise exception 'Final extraction review is immutable'; end if;
    if old.status='pending_review' and new.status not in('pending_review','reviewing','rejected','expired') then raise exception 'Invalid extraction review transition'; end if;
    if old.status='reviewing' and new.status not in('reviewing','pending_review','confirmed','rejected','expired') then raise exception 'Invalid extraction review transition'; end if;
    return new;
  end if;
  if new.document_id is not null then
    select * into source from public.documents where id=new.document_id;
    if not found then raise exception 'Extraction source document does not exist'; end if;
    if new.case_id is distinct from source.case_id or new.client_id is distinct from source.client_id
       or new.document_version is distinct from source.version or new.source_sha256 is distinct from source.content_checksum then
      raise exception 'Extraction source must match the immutable document byte version';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_document_extracted_field()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Extracted field provenance is immutable'; end if;
  if tg_op='UPDATE' and (old.extraction_id is distinct from new.extraction_id or old.field_path is distinct from new.field_path
    or old.extracted_value is distinct from new.extracted_value or old.confidence is distinct from new.confidence
    or old.source_locator is distinct from new.source_locator or old.created_at is distinct from new.created_at) then
    raise exception 'Extracted field provenance is immutable';
  end if;
  if tg_op='UPDATE' and old.verification_status in('accepted','rejected') and (old.verification_status is distinct from new.verification_status or old.reviewed_value is distinct from new.reviewed_value) then raise exception 'Final field review is immutable'; end if;
  return new;
end;
$$;

do $$ begin
  if not exists(select 1 from pg_trigger where tgname='document_extractions_source_pin' and tgrelid='public.document_extractions'::regclass and not tgisinternal) then
    create trigger document_extractions_source_pin before insert or update or delete on public.document_extractions for each row execute function public.protect_document_extraction_source();
  end if;
  if not exists(select 1 from pg_trigger where tgname='document_extracted_fields_provenance_pin' and tgrelid='public.document_extracted_fields'::regclass and not tgisinternal) then
    create trigger document_extracted_fields_provenance_pin before update or delete on public.document_extracted_fields for each row execute function public.protect_document_extracted_field();
  end if;
end $$;

alter table public.document_extractions enable row level security;
alter table public.document_extractions force row level security;
alter table public.document_extracted_fields enable row level security;
alter table public.document_extracted_fields force row level security;

revoke all on public.document_extractions,public.document_extracted_fields from public,anon,authenticated;
grant select on public.document_extractions,public.document_extracted_fields to authenticated;
grant select,insert,update on public.document_extractions,public.document_extracted_fields to service_role;

create policy document_extractions_read_floor on public.document_extractions for select to authenticated using(
  (document_id is null and requested_by=public.caseflow_actor_id() and public.caseflow_actor_active() and public.caseflow_has_permission('clients.manage'))
  or(document_id is not null and public.caseflow_can_case(case_id,'documents.manage') and exists(
    select 1 from public.documents d where d.id=document_id and d.case_id=case_id and d.client_id=client_id
      and d.version=document_version and d.content_checksum=source_sha256))
);
create policy document_extracted_fields_read_floor on public.document_extracted_fields for select to authenticated using(exists(
  select 1 from public.document_extractions e where e.id=extraction_id and(
    (e.document_id is null and e.requested_by=public.caseflow_actor_id() and public.caseflow_actor_active() and public.caseflow_has_permission('clients.manage'))
    or(e.document_id is not null and public.caseflow_can_case(e.case_id,'documents.manage')))));

comment on table public.document_extractions is 'Persistent, immutable-provenance OCR/MRZ extraction runs. Writes are backend-only; human review is mandatory before canonical use.';
comment on table public.document_extracted_fields is 'Field-level extraction proposals and human review decisions pinned to a persistent extraction run.';

commit;
