-- Document lifecycle hardening. Keep processing/review status separate from
-- lifecycle so OCR success never becomes verification and existing UI/status
-- contracts remain backward compatible.

begin;

alter table public.documents
  add column if not exists expires_at timestamptz,
  add column if not exists replaces_document_id uuid references public.documents(id) on delete set null,
  add column if not exists replaced_by_document_id uuid references public.documents(id) on delete set null,
  add column if not exists duplicate_of_document_id uuid references public.documents(id) on delete set null;

create index if not exists documents_expiry_idx on public.documents(expires_at) where expires_at is not null;
create index if not exists documents_duplicate_idx on public.documents(duplicate_of_document_id) where duplicate_of_document_id is not null;
create index if not exists documents_replacement_idx on public.documents(replaces_document_id) where replaces_document_id is not null;

create table if not exists public.document_issues (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  issue_type text not null check (issue_type in ('duplicate','expired','mismatch','quality','classification','other')),
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  code text not null check (length(trim(code))>0),
  detail jsonb not null default '{}'::jsonb,
  detected_by text not null check (detected_by in ('system','staff','ai','automation')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.staff(id),
  resolution_note text,
  unique(document_id,code,status)
);
create index if not exists document_issues_client_open_idx on public.document_issues(client_id,detected_at desc) where status='open';
create index if not exists document_issues_document_idx on public.document_issues(document_id,detected_at desc);

alter table public.document_issues enable row level security;
create policy document_issues_staff_read on public.document_issues for select to authenticated using(public.cg_can_access_client(client_id));
create policy document_issues_staff_update on public.document_issues for update to authenticated using(public.cg_can_access_client(client_id)) with check(public.cg_can_access_client(client_id));
grant select,update on public.document_issues to authenticated;
revoke insert,delete on public.document_issues from authenticated;

create or replace function public.detect_document_duplicate()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_original uuid;
begin
  if new.sha256 is null then return new; end if;
  select d.id into v_original
    from public.documents d
   where d.client_id=new.client_id and d.doc_type=new.doc_type and d.sha256=new.sha256 and d.id<>new.id
   order by d.uploaded_at,d.id limit 1;
  if v_original is null then return new; end if;
  new.duplicate_of_document_id:=v_original;
  insert into public.document_issues(document_id,client_id,issue_type,severity,code,detail,detected_by)
  values(new.id,new.client_id,'duplicate','warning','DUPLICATE_CONTENT',jsonb_build_object('duplicate_of_document_id',v_original),'system')
  on conflict(document_id,code,status) do nothing;
  return new;
end;
$$;
revoke execute on function public.detect_document_duplicate() from public,anon,authenticated;
grant execute on function public.detect_document_duplicate() to service_role;
drop trigger if exists documents_duplicate_detection on public.documents;
create trigger documents_duplicate_detection before insert or update of sha256,doc_type on public.documents for each row execute function public.detect_document_duplicate();

create or replace function public.apply_document_replacement()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_old_client uuid;
  v_old_type text;
begin
  if new.replaces_document_id is null then return new; end if;
  select client_id,doc_type into v_old_client,v_old_type from public.documents where id=new.replaces_document_id;
  if v_old_client is null or v_old_client<>new.client_id or v_old_type<>new.doc_type then
    raise exception 'replacement document must belong to same client and document type';
  end if;
  update public.documents set replaced_by_document_id=new.id where id=new.replaces_document_id and replaced_by_document_id is null;
  return new;
end;
$$;
revoke execute on function public.apply_document_replacement() from public,anon,authenticated;
grant execute on function public.apply_document_replacement() to service_role;
drop trigger if exists documents_replacement_link on public.documents;
create trigger documents_replacement_link after insert or update of replaces_document_id on public.documents for each row execute function public.apply_document_replacement();

create or replace function public.refresh_document_expirations()
returns integer
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_count integer:=0;
begin
  insert into public.document_issues(document_id,client_id,issue_type,severity,code,detail,detected_by)
  select d.id,d.client_id,'expired','warning','DOCUMENT_EXPIRED',jsonb_build_object('expires_at',d.expires_at),'automation'
    from public.documents d
   where d.expires_at is not null and d.expires_at<=now() and d.replaced_by_document_id is null
  on conflict(document_id,code,status) do nothing;
  get diagnostics v_count=row_count;

  update public.client_requirements r
     set status='expired',completed_at=null,completed_by=null,updated_at=now()
    from public.documents d
   where r.related_document_id=d.id and d.expires_at is not null and d.expires_at<=now() and d.replaced_by_document_id is null and r.status not in ('not_applicable','expired');
  return v_count;
end;
$$;
revoke execute on function public.refresh_document_expirations() from public,anon,authenticated;
grant execute on function public.refresh_document_expirations() to service_role;

create or replace view public.document_operational_state
with (security_invoker=true)
as
select d.*,
  case
    when d.replaced_by_document_id is not null then 'replaced'
    when d.expires_at is not null and d.expires_at<=now() then 'expired'
    when d.status='verified' then 'approved'
    when d.status='rejected' then 'rejected'
    when d.status in ('needs_review','needs_reupload') then 'needs_review'
    when d.status='processing' then 'processed'
    else 'uploaded'
  end as lifecycle_state,
  (select count(*)::int from public.document_issues i where i.document_id=d.id and i.status='open') as open_issue_count
from public.documents d;
revoke all on public.document_operational_state from public,anon;
grant select on public.document_operational_state to authenticated;

commit;
