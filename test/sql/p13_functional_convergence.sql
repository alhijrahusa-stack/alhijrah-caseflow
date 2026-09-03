\set ON_ERROR_STOP on
begin;

insert into public.app_users(auth_user_id,email,display_name,status) values
 ('19000000-0000-0000-0000-000000000001','p13-uploader@test.invalid','P13 Uploader','active'),
 ('19000000-0000-0000-0000-000000000002','p13-reviewer@test.invalid','P13 Reviewer','active');
insert into public.user_roles(auth_user_id,role_code) values('19000000-0000-0000-0000-000000000002','document_reviewer');
insert into public.clients(id,legal_name) values('29000000-0000-0000-0000-000000000001','Before Background Review');
insert into public.cases(id,client_id,client_name,case_type,status,service_code,service_workflow_version,service_plan_snapshot)
values('39000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','Before Background Review','Naturalization','active','N-400',1,
  '{"version":1,"service_code":"N-400","participant_roles":[],"documents":[],"forms":[]}'::jsonb);

insert into public.document_requests(id,case_id,client_id,category,title,requirement_code,source,status)
values('49000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','identity','Client identity','CLIENT_IDENTITY','service_workflow','received');
insert into public.documents(id,case_id,client_id,request_id,object_key,file_name,content_type,size_bytes,content_checksum,status,review_status,version,uploaded_by,automation_status)
values('59000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000001','cases/p13/identity.png','identity.png','image/png',1024,repeat('3',64),'uploaded','under_review',1,'19000000-0000-0000-0000-000000000001','REVIEW_REQUIRED');
insert into public.document_extractions(id,document_id,case_id,client_id,document_version,source_sha256,review_token_hash,extraction_kind,engine,engine_version,status,raw_result,requested_by,expires_at)
values('69000000-0000-0000-0000-000000000001','59000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001',1,repeat('3',64),repeat('4',64),'document_identity','tesseract.js','identity-ocr-v1','reviewing','{"fields":{"legal_name":"Reviewed By Queue"}}','19000000-0000-0000-0000-000000000001',now()+interval '1 day');
insert into public.document_extracted_fields(id,extraction_id,field_path,extracted_value,source_locator)
values('79000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','legal_name','"Reviewed By Queue"','{"method":"mrz"}');

set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000002',true);
select * from public.commit_verified_identity_extraction('69000000-0000-0000-0000-000000000001','client','29000000-0000-0000-0000-000000000001','{"legal_name":"Reviewed By Queue"}'::jsonb);

do $$ begin
  if (select legal_name from public.clients where id='29000000-0000-0000-0000-000000000001')<>'Reviewed By Queue' then raise exception 'authorized queue reviewer could not commit uploader extraction'; end if;
  if (select reviewed_by from public.document_extractions where id='69000000-0000-0000-0000-000000000001')<>'19000000-0000-0000-0000-000000000002' then raise exception 'reviewer provenance was not recorded'; end if;
end $$;
reset role;

do $$ begin
  begin
    insert into public.document_requests(case_id,client_id,category,title,requirement_code,status) values('39000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','identity','Duplicate','CLIENT_IDENTITY','missing');
    raise exception 'duplicate service requirement unexpectedly succeeded';
  exception when unique_violation then null; end;
  begin
    update public.documents set automation_status='MADE_UP' where id='59000000-0000-0000-0000-000000000001';
    raise exception 'invalid automation status unexpectedly succeeded';
  exception when check_violation then null; end;
end $$;

rollback;
select 'P13_FUNCTIONAL_CONVERGENCE_PASS' as result;
