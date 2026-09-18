begin;

create table if not exists public.agency_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete restrict,
  source_document_id uuid,
  request_type text not null check (request_type in ('rfe','rfie','noid','noir','other')),
  title text not null check (length(btrim(title)) between 1 and 240),
  notice_date date,
  response_due_date date,
  status text not null default 'open' check (status in ('open','collecting','review','ready','filed','closed')),
  summary text,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (response_due_date is null or notice_date is null or response_due_date >= notice_date),
  unique(id,case_id)
);

create unique index if not exists documents_id_case_uidx on public.documents(id,case_id);
create unique index if not exists document_requests_id_case_uidx on public.document_requests(id,case_id);

do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.agency_requests'::regclass and conname='agency_requests_source_document_case_fk') then
    alter table public.agency_requests add constraint agency_requests_source_document_case_fk
      foreign key(source_document_id,case_id) references public.documents(id,case_id) on delete restrict;
  end if;
end $$;

create table if not exists public.evidence_requirements (
  id uuid primary key default gen_random_uuid(),
  agency_request_id uuid not null,
  case_id uuid not null,
  document_request_id uuid,
  requirement_code text not null check (length(btrim(requirement_code)) between 1 and 80),
  title text not null check (length(btrim(title)) between 1 and 240),
  description text,
  status text not null default 'missing' check (status in ('missing','requested','received','accepted','insufficient','waived')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agency_request_id,requirement_code),
  unique(id,case_id),
  foreign key(agency_request_id,case_id) references public.agency_requests(id,case_id) on delete restrict,
  foreign key(document_request_id,case_id) references public.document_requests(id,case_id) on delete restrict
);

create table if not exists public.evidence_links (
  id uuid primary key default gen_random_uuid(),
  evidence_requirement_id uuid not null,
  document_id uuid not null,
  case_id uuid not null,
  relevance_status text not null default 'proposed' check (relevance_status in ('proposed','accepted','rejected')),
  notes text,
  linked_by uuid not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(evidence_requirement_id,document_id),
  foreign key(evidence_requirement_id,case_id) references public.evidence_requirements(id,case_id) on delete restrict,
  foreign key(document_id,case_id) references public.documents(id,case_id) on delete restrict
);

create index if not exists agency_requests_case_status_idx on public.agency_requests(case_id,status,response_due_date);
create index if not exists evidence_requirements_request_status_idx on public.evidence_requirements(agency_request_id,status,sort_order);
create index if not exists evidence_links_requirement_idx on public.evidence_links(evidence_requirement_id,relevance_status);

create or replace function public.protect_agency_evidence_scope()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and (
    old.case_id is distinct from new.case_id or
    (tg_table_name='agency_requests' and (to_jsonb(old)->'source_document_id') is distinct from (to_jsonb(new)->'source_document_id')) or
    (tg_table_name='evidence_requirements' and ((to_jsonb(old)->'agency_request_id') is distinct from (to_jsonb(new)->'agency_request_id') or (to_jsonb(old)->'document_request_id') is distinct from (to_jsonb(new)->'document_request_id'))) or
    (tg_table_name='evidence_links' and ((to_jsonb(old)->'evidence_requirement_id') is distinct from (to_jsonb(new)->'evidence_requirement_id') or (to_jsonb(old)->'document_id') is distinct from (to_jsonb(new)->'document_id')))
  ) then raise exception 'Agency evidence ownership is immutable'; end if;
  new.updated_at=now();
  return new;
end;
$$;

do $$ begin
  if not exists(select 1 from pg_trigger where tgrelid='public.agency_requests'::regclass and tgname='agency_requests_protect_scope' and not tgisinternal) then
    create trigger agency_requests_protect_scope before update on public.agency_requests for each row execute function public.protect_agency_evidence_scope();
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.evidence_requirements'::regclass and tgname='evidence_requirements_protect_scope' and not tgisinternal) then
    create trigger evidence_requirements_protect_scope before update on public.evidence_requirements for each row execute function public.protect_agency_evidence_scope();
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.evidence_links'::regclass and tgname='evidence_links_protect_scope' and not tgisinternal) then
    create trigger evidence_links_protect_scope before update on public.evidence_links for each row execute function public.protect_agency_evidence_scope();
  end if;
end $$;

alter table public.agency_requests enable row level security;
alter table public.agency_requests force row level security;
alter table public.evidence_requirements enable row level security;
alter table public.evidence_requirements force row level security;
alter table public.evidence_links enable row level security;
alter table public.evidence_links force row level security;

revoke all on public.agency_requests,public.evidence_requirements,public.evidence_links from public,anon,authenticated;
grant select,insert,update on public.agency_requests,public.evidence_requirements to authenticated;
grant select,insert on public.evidence_links to authenticated;
grant all on public.agency_requests,public.evidence_requirements,public.evidence_links to service_role;

create policy agency_requests_read_floor on public.agency_requests for select to authenticated using(
  public.caseflow_can_case(case_id,'cases.view'));
create policy agency_requests_insert_floor on public.agency_requests for insert to authenticated with check(
  public.caseflow_can_case(case_id,'cases.manage') and created_by=public.caseflow_actor_id() and updated_by=public.caseflow_actor_id());
create policy agency_requests_update_floor on public.agency_requests for update to authenticated using(
  public.caseflow_can_case(case_id,'cases.manage')) with check(
  public.caseflow_can_case(case_id,'cases.manage') and updated_by=public.caseflow_actor_id());
create policy evidence_requirements_read_floor on public.evidence_requirements for select to authenticated using(
  public.caseflow_can_case(case_id,'cases.view'));
create policy evidence_requirements_insert_floor on public.evidence_requirements for insert to authenticated with check(
  public.caseflow_can_case(case_id,'cases.manage') and created_by=public.caseflow_actor_id() and updated_by=public.caseflow_actor_id());
create policy evidence_requirements_update_floor on public.evidence_requirements for update to authenticated using(
  public.caseflow_can_case(case_id,'cases.manage')) with check(
  public.caseflow_can_case(case_id,'cases.manage') and updated_by=public.caseflow_actor_id());
create policy evidence_links_read_floor on public.evidence_links for select to authenticated using(
  public.caseflow_can_case(case_id,'documents.view'));
create policy evidence_links_insert_floor on public.evidence_links for insert to authenticated with check(
  public.caseflow_can_case(case_id,'documents.manage') and linked_by=public.caseflow_actor_id());

comment on table public.agency_requests is 'Case-scoped agency notices including RFE, RFIE, NOID and NOIR; source notice bytes remain in canonical documents.';
comment on table public.evidence_requirements is 'Deterministic response checklist linked to an agency request and optional canonical client document request.';
comment on table public.evidence_links is 'Case-consistent evidence matrix linking canonical immutable documents to response requirements.';

commit;
