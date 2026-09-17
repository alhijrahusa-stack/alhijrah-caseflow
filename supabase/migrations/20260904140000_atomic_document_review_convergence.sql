begin;

create or replace function public.sync_document_review_dependents()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.review_status is not distinct from new.review_status
     or new.review_status not in('approved','rejected') then return new; end if;

  if new.request_id is not null then
    update public.document_requests set
      status=new.review_status,
      reviewed_by=new.reviewed_by,
      reviewer_notes=new.reviewer_notes,
      updated_at=coalesce(new.reviewed_at,clock_timestamp())
    where id=new.request_id and case_id=new.case_id;
  end if;

  update public.tasks set
    status=case when new.review_status='approved' then 'completed' else 'open' end,
    completed_at=case when new.review_status='approved' then coalesce(new.reviewed_at,clock_timestamp()) else null end,
    priority=case when new.review_status='rejected' then 'high' else priority end,
    updated_by=new.reviewed_by,
    updated_at=coalesce(new.reviewed_at,clock_timestamp())
  where automation_key='document:'||new.id::text||':v'||new.version::text;
  return new;
end;
$$;

drop trigger if exists documents_sync_review_dependents on public.documents;
create trigger documents_sync_review_dependents
after update of review_status on public.documents
for each row execute function public.sync_document_review_dependents();

create or replace function public.finalize_confirmed_document_extraction()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.status is distinct from 'confirmed' and new.status='confirmed' and new.document_id is not null then
    update public.documents set
      automation_status='VERIFIED',
      review_status='approved',
      reviewer_notes=null,
      reviewed_by=new.reviewed_by,
      reviewed_at=new.reviewed_at,
      processing_error=null
    where id=new.document_id and case_id=new.case_id and version=new.document_version
      and content_checksum=new.source_sha256 and archived_at is null;
    if not found then raise exception 'Confirmed extraction source document is unavailable'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists document_extractions_finalize_source on public.document_extractions;
create trigger document_extractions_finalize_source
after update of status on public.document_extractions
for each row execute function public.finalize_confirmed_document_extraction();

revoke all on function public.sync_document_review_dependents() from public,anon,authenticated;
revoke all on function public.finalize_confirmed_document_extraction() from public,anon,authenticated;

notify pgrst, 'reload schema';
commit;
