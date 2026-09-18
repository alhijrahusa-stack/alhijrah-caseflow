begin;

-- A documents row is the canonical immutable byte version. Replacements are
-- new rows linked through replaces_document_id; descriptive/review metadata
-- may still change without rewriting the evidence bytes.
alter table public.documents add column if not exists object_etag text;
alter table public.documents add column if not exists uploaded_by uuid;
alter table public.documents add column if not exists byte_verified_at timestamptz;

-- A browser JWT cannot prove that bytes exist in R2 or that the supplied hash
-- describes them. Metadata insertion is therefore a trusted backend commit
-- performed only after the backend reads and hashes the exact stored object.
revoke insert on table public.documents from authenticated;
alter policy documents_insert_floor on public.documents with check (false);

update public.documents
set byte_verified_at = coalesce(byte_verified_at, created_at)
where content_checksum ~ '^[0-9a-f]{64}$'
  and byte_verified_at is null;

do $$
begin
  if exists (
    select 1 from public.documents
    where replaces_document_id is not null
    group by replaces_document_id
    having count(*) > 1
  ) then
    raise exception 'Existing document replacement history branches; immutable linear versioning cannot be enabled';
  end if;
end;
$$;

create unique index if not exists documents_one_replacement_idx
  on public.documents(replaces_document_id)
  where replaces_document_id is not null;

create index if not exists documents_version_chain_idx
  on public.documents(case_id, replaces_document_id, version);

create or replace function public.protect_document_byte_version()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  case_client uuid;
  prior public.documents%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.category = 'verification'
       and old.created_at >= now() - interval '15 minutes'
       and current_user = 'service_role'
    then
      return old;
    end if;
    raise exception 'Document byte versions are immutable; archive the document instead';
  end if;

  if tg_op = 'UPDATE' then
    if old.case_id is distinct from new.case_id
       or old.client_id is distinct from new.client_id
       or old.person_id is distinct from new.person_id
       or old.request_id is distinct from new.request_id
       or old.object_key is distinct from new.object_key
       or old.content_type is distinct from new.content_type
       or old.size_bytes is distinct from new.size_bytes
       or old.content_checksum is distinct from new.content_checksum
       or old.object_etag is distinct from new.object_etag
       or old.version is distinct from new.version
       or old.replaces_document_id is distinct from new.replaces_document_id
       or old.uploaded_by is distinct from new.uploaded_by
       or old.byte_verified_at is distinct from new.byte_verified_at
       or old.created_at is distinct from new.created_at
    then
      raise exception 'Document byte version and ownership are immutable';
    end if;
    return new;
  end if;

  if new.case_id is null then
    raise exception 'Document case is required';
  end if;
  select client_id into case_client from public.cases where id = new.case_id;
  if not found then raise exception 'Document case does not exist'; end if;
  if new.client_id is distinct from case_client then
    raise exception 'Document client must match its case';
  end if;
  if new.object_key not like 'cases/' || new.case_id::text || '/%' then
    raise exception 'Document object key must be scoped to its case';
  end if;
  if new.content_checksum is null or new.content_checksum !~ '^[0-9a-f]{64}$' then
    raise exception 'A verified SHA-256 checksum is required for every new document version';
  end if;
  if new.size_bytes is null or new.size_bytes < 1 or new.size_bytes > 26214400 then
    raise exception 'Document byte length is invalid';
  end if;
  new.byte_verified_at := coalesce(new.byte_verified_at, now());
  if new.uploaded_by is null or not exists (
    select 1 from public.app_users au
    where au.auth_user_id = new.uploaded_by and au.status = 'active'
  ) then
    raise exception 'Document uploader must be an active application user';
  end if;

  if new.person_id is not null and not exists (
    select 1 from public.case_people cp
    where cp.case_id = new.case_id and cp.person_id = new.person_id
  ) then
    raise exception 'Document person is not a participant in the case';
  end if;
  if new.request_id is not null and not exists (
    select 1 from public.document_requests dr
    where dr.id = new.request_id and dr.case_id = new.case_id
      and (dr.client_id is null or dr.client_id is not distinct from new.client_id)
      and (dr.person_id is null or dr.person_id is not distinct from new.person_id)
  ) then
    raise exception 'Document request does not match document ownership';
  end if;

  if new.replaces_document_id is null then
    if coalesce(new.version, 1) <> 1 then
      raise exception 'The first document version must be version 1';
    end if;
    new.version := 1;
  else
    select * into prior from public.documents where id = new.replaces_document_id for share;
    if not found then raise exception 'Replaced document version does not exist'; end if;
    if prior.case_id is distinct from new.case_id
       or prior.client_id is distinct from new.client_id
       or prior.person_id is distinct from new.person_id
       or prior.request_id is distinct from new.request_id
    then
      raise exception 'Replacement must preserve document ownership';
    end if;
    if new.version <> prior.version + 1 then
      raise exception 'Replacement version number is not consecutive';
    end if;
    if exists (select 1 from public.documents where replaces_document_id = prior.id) then
      raise exception 'A document version can have only one replacement';
    end if;
    update public.documents
    set archived_at = coalesce(archived_at, now())
    where id = prior.id;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'documents_immutable_byte_version'
      and tgrelid = 'public.documents'::regclass
      and not tgisinternal
  ) then
    create trigger documents_immutable_byte_version
    before insert or update or delete on public.documents
    for each row execute function public.protect_document_byte_version();
  end if;
end;
$$;

comment on table public.documents is
  'Canonical document byte versions. Byte identity and ownership are immutable; replacements append a linked row and prior versions remain recoverable.';
comment on column public.documents.content_checksum is
  'Server-verified SHA-256 of the exact R2 object bytes for all versions created after immutable versioning activation.';
comment on column public.documents.byte_verified_at is
  'Time the backend verified the exact R2 byte length and SHA-256 before committing metadata.';

commit;
