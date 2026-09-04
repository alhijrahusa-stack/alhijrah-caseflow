begin;

alter table public.form_answers add column if not exists canonical_field_path text;
alter table public.form_answers add column if not exists verified_canonical_field_id uuid references public.verified_canonical_fields(id) on delete restrict;
alter table public.form_answers add column if not exists canonical_value_sha256 text check(canonical_value_sha256 is null or canonical_value_sha256 ~ '^[0-9a-f]{64}$');
alter table public.form_answers add column if not exists validation_errors jsonb not null default '[]'::jsonb;

create table if not exists public.form_answer_revisions(
  id uuid primary key default gen_random_uuid(),
  form_answer_id uuid not null references public.form_answers(id) on delete restrict,
  form_instance_id uuid not null references public.form_instances(id) on delete restrict,
  answer_revision integer not null check(answer_revision>0),
  field_path text not null,
  canonical_field_path text,
  answer_value jsonb,
  blank_state text,
  source_type text not null,
  source_record_id uuid,
  source_document_id uuid references public.documents(id) on delete restrict,
  verified_canonical_field_id uuid references public.verified_canonical_fields(id) on delete restrict,
  canonical_value_sha256 text,
  verification_status text not null,
  validation_errors jsonb not null default '[]'::jsonb,
  changed_by uuid references public.app_users(auth_user_id) on delete restrict,
  changed_source text not null,
  recorded_at timestamptz not null default now(),
  unique(form_answer_id,answer_revision)
);
create index if not exists form_answer_revisions_instance_idx
  on public.form_answer_revisions(form_instance_id,recorded_at desc);

create or replace function public.protect_form_answer_provenance()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  instance public.form_instances%rowtype;
  definition jsonb;
  field jsonb;
  fact public.verified_canonical_fields%rowtype;
  canonical_client uuid;
begin
  select * into instance from public.form_instances where id=new.form_instance_id;
  if not found then raise exception 'Form instance does not exist'; end if;
  select d.definition into definition from public.form_definitions d where d.id=instance.form_definition_id;
  select item into field from jsonb_array_elements(coalesce(definition->'fields','[]'::jsonb)) item where item->>'path'=new.field_path limit 1;
  if field is null then raise exception 'Form field is not in the pinned definition'; end if;
  if new.canonical_field_path is distinct from field->>'canonical_field_path' then raise exception 'Canonical form path mismatch'; end if;
  if jsonb_typeof(new.validation_errors)<>'array' then raise exception 'Validation errors must be an array'; end if;

  if new.source_document_id is not null and not exists(select 1 from public.documents d
      where d.id=new.source_document_id and d.case_id=instance.case_id and d.archived_at is null)
  then raise exception 'Form answer document is not in the form case'; end if;

  if new.source_type='verified_field' then
    if new.verified_canonical_field_id is null or new.source_record_id is distinct from new.verified_canonical_field_id
       or new.verification_status<>'verified' or new.canonical_value_sha256 is null then
      raise exception 'Verified form answer requires exact canonical provenance';
    end if;
    select * into fact from public.verified_canonical_fields where id=new.verified_canonical_field_id and status='current';
    if not found or fact.field_value is distinct from new.answer_value
       or fact.field_path<>regexp_replace(new.canonical_field_path,'^.*\.','')
       or new.canonical_value_sha256<>encode(digest(convert_to(new.answer_value::text,'UTF8'),'sha256'),'hex') then
      raise exception 'Verified form answer does not match the current canonical fact';
    end if;
    select c.client_id into canonical_client from public.cases c where c.id=instance.case_id;
    if fact.client_id<>canonical_client or (instance.participant_id is not null
       and (fact.subject_type<>'person' or fact.person_id<>instance.participant_id))
       or (instance.participant_id is null and fact.subject_type<>'client') then
      raise exception 'Verified canonical fact is outside the form subject';
    end if;
  elsif new.verified_canonical_field_id is not null or new.verification_status='verified' or new.canonical_value_sha256 is not null then
    raise exception 'Unverified answer cannot claim canonical verification';
  end if;
  return new;
end;
$$;

create or replace function public.record_form_answer_revision()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.form_answer_revisions(form_answer_id,form_instance_id,answer_revision,field_path,
    canonical_field_path,answer_value,blank_state,source_type,source_record_id,source_document_id,
    verified_canonical_field_id,canonical_value_sha256,verification_status,validation_errors,changed_by,changed_source)
  values(new.id,new.form_instance_id,new.revision,new.field_path,new.canonical_field_path,new.answer_value,
    new.blank_state,new.source_type,new.source_record_id,new.source_document_id,new.verified_canonical_field_id,
    new.canonical_value_sha256,new.verification_status,new.validation_errors,new.last_changed_by,new.last_changed_source);
  update public.form_instances set revision=revision+1,canonical_snapshot_hash=null,
    updated_by=new.last_changed_by,updated_at=clock_timestamp() where id=new.form_instance_id;
  return new;
end;
$$;

create or replace function public.protect_form_answer_revision()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'Form answer revision history is immutable';
end;
$$;

do $$ begin
  if not exists(select 1 from pg_trigger where tgname='form_answers_enforce_canonical_provenance'
      and tgrelid='public.form_answers'::regclass and not tgisinternal) then
    create trigger form_answers_enforce_canonical_provenance before insert or update on public.form_answers
      for each row execute function public.protect_form_answer_provenance();
  end if;
  if not exists(select 1 from pg_trigger where tgname='form_answers_record_revision'
      and tgrelid='public.form_answers'::regclass and not tgisinternal) then
    create trigger form_answers_record_revision after insert or update on public.form_answers
      for each row execute function public.record_form_answer_revision();
  end if;
  if not exists(select 1 from pg_trigger where tgname='form_answer_revisions_immutable'
      and tgrelid='public.form_answer_revisions'::regclass and not tgisinternal) then
    create trigger form_answer_revisions_immutable before update or delete on public.form_answer_revisions
      for each row execute function public.protect_form_answer_revision();
  end if;
end $$;

alter table public.form_answer_revisions enable row level security;
alter table public.form_answer_revisions force row level security;
revoke all on public.form_answer_revisions from public,anon,authenticated;
grant select on public.form_answer_revisions to authenticated;
grant select on public.form_answer_revisions to service_role;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='form_answer_revisions' and policyname='form_answer_revisions_read_floor') then
    create policy form_answer_revisions_read_floor on public.form_answer_revisions for select to authenticated using(exists(
      select 1 from public.form_instances f where f.id=form_instance_id and public.caseflow_can_case(f.case_id,'cases.view')));
  end if;
end $$;

comment on table public.form_answer_revisions is 'Append-only answer history tied to the pinned form definition and exact canonical provenance; writes occur only through the form answer trigger.';

commit;
