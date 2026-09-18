begin;

-- Managers may inspect extraction provenance while handling document intake,
-- and reviewers must be able to read the same immutable evidence before they
-- make the human verification decision. Canonical commit remains restricted
-- to documents.review by commit_verified_identity_extraction.
drop policy if exists document_extractions_read_floor on public.document_extractions;
create policy document_extractions_read_floor on public.document_extractions for select to authenticated using(
  (document_id is null and requested_by=public.caseflow_actor_id() and public.caseflow_actor_active()
    and public.caseflow_has_permission('clients.manage'))
  or(document_id is not null
    and (public.caseflow_can_case(case_id,'documents.manage')
      or public.caseflow_can_case(case_id,'documents.review'))
    and exists(select 1 from public.documents d where d.id=document_id and d.case_id=case_id
      and d.client_id=client_id and d.version=document_version and d.content_checksum=source_sha256))
);

drop policy if exists document_extracted_fields_read_floor on public.document_extracted_fields;
create policy document_extracted_fields_read_floor on public.document_extracted_fields for select to authenticated using(exists(
  select 1 from public.document_extractions e where e.id=extraction_id and(
    (e.document_id is null and e.requested_by=public.caseflow_actor_id() and public.caseflow_actor_active()
      and public.caseflow_has_permission('clients.manage'))
    or(e.document_id is not null
      and (public.caseflow_can_case(e.case_id,'documents.manage')
        or public.caseflow_can_case(e.case_id,'documents.review'))))
));

notify pgrst, 'reload schema';
commit;
