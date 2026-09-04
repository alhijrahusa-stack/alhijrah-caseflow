\set ON_ERROR_STOP on
begin;

insert into public.app_users(auth_user_id,email,display_name,status) values
 ('16000000-0000-0000-0000-000000000001','p6-owner@test.invalid','P6 Owner','active');
insert into public.user_roles(auth_user_id,role_code) values('16000000-0000-0000-0000-000000000001','owner');
insert into public.clients(id,legal_name) values('26000000-0000-0000-0000-000000000001','Before Canonical Review');
insert into public.cases(id,client_id,client_name,case_type,status,service_code) values
 ('36000000-0000-0000-0000-000000000001','26000000-0000-0000-0000-000000000001','Before Canonical Review','I-90','active','I-90');
insert into public.document_extractions(id,source_sha256,review_token_hash,extraction_kind,engine,engine_version,status,raw_result,requested_by,expires_at)
values('56000000-0000-0000-0000-000000000001',repeat('1',64),repeat('2',64),'identity_upload','tesseract.js','identity-ocr-v1','reviewing','{"fields":{"legal_name":"Canonical Person"}}','16000000-0000-0000-0000-000000000001',now()+interval '15 minutes');
insert into public.document_extracted_fields(id,extraction_id,field_path,extracted_value,source_locator) values
 ('66000000-0000-0000-0000-000000000001','56000000-0000-0000-0000-000000000001','legal_name','"Canonical Person"','{"method":"mrz"}');

set local role authenticated;
select set_config('request.jwt.claim.sub','16000000-0000-0000-0000-000000000001',true);
select * from public.commit_verified_identity_extraction(
 '56000000-0000-0000-0000-000000000001','client','26000000-0000-0000-0000-000000000001','{"legal_name":"Canonical Person"}'::jsonb);
reset role;

insert into public.form_registry(id,authority,form_code,display_name) values('76000000-0000-0000-0000-000000000001','USCIS','I-90','Synthetic I-90');
insert into public.form_versions(id,registry_id,edition_date,official_pdf_source,source_sha256,verified_at,status,mapping_version,mapping_test_status)
values('76000000-0000-0000-0000-000000000002','76000000-0000-0000-0000-000000000001','2026-01-01','https://www.uscis.gov/i-90',repeat('a',64),now(),'active',1,'passed');
insert into public.form_definitions(id,form_version_id,mapping_version,definition,definition_sha256,status)
values('76000000-0000-0000-0000-000000000003','76000000-0000-0000-0000-000000000002',1,
 '{"fields":[{"path":"applicant.name","canonical_field_path":"client.legal_name","official_label":"Legal Name","part":"1","item_number":"1","type":"text"}]}'::jsonb,repeat('b',64),'active');
insert into public.form_instances(id,case_id,form_version_id,form_definition_id,pinned_authority,pinned_form_code,pinned_edition_date,pinned_mapping_version,pinned_source_sha256,created_by,updated_by)
values('76000000-0000-0000-0000-000000000004','36000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000002','76000000-0000-0000-0000-000000000003','USCIS','I-90','2026-01-01',1,repeat('a',64),'16000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001');

insert into public.form_answers(id,form_instance_id,field_path,canonical_field_path,answer_value,source_type,source_record_id,verified_canonical_field_id,canonical_value_sha256,verification_status,revision,last_changed_by,last_changed_source)
select '76000000-0000-0000-0000-000000000005','76000000-0000-0000-0000-000000000004','applicant.name','client.legal_name',field_value,'verified_field',id,id,
 encode(digest(convert_to(field_value::text,'UTF8'),'sha256'),'hex'),'verified',1,'16000000-0000-0000-0000-000000000001','STAFF_ASSISTED'
from public.verified_canonical_fields where client_id='26000000-0000-0000-0000-000000000001' and field_path='legal_name' and status='current';

do $$ begin
 if (select count(*) from public.form_answer_revisions where form_answer_id='76000000-0000-0000-0000-000000000005')<>1 then raise exception 'answer revision was not recorded'; end if;
 if (select revision from public.form_instances where id='76000000-0000-0000-0000-000000000004')<>2 then raise exception 'form revision did not advance'; end if;
 begin
  insert into public.form_answers(id,form_instance_id,field_path,canonical_field_path,answer_value,source_type,verification_status,revision,last_changed_by,last_changed_source)
  values('76000000-0000-0000-0000-000000000006','76000000-0000-0000-0000-000000000004','applicant.name','client.legal_name','"FORGED"','manual','verified',1,'16000000-0000-0000-0000-000000000001','STAFF_ASSISTED');
  raise exception 'manual answer claimed verification';
 exception when raise_exception then if sqlerrm='manual answer claimed verification' then raise; end if; end;
 begin
  update public.form_answer_revisions set answer_value='"FORGED"' where form_answer_id='76000000-0000-0000-0000-000000000005';
  raise exception 'answer history mutation unexpectedly succeeded';
 exception when raise_exception then if sqlerrm='answer history mutation unexpectedly succeeded' then raise; end if; end;
end $$;

set local role anon;
do $$ begin
 begin
  perform * from public.form_answer_revisions;
  raise exception 'anon answer history read unexpectedly succeeded';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
select 'P6_DETERMINISTIC_FORM_ENGINE_PASS' as result;
