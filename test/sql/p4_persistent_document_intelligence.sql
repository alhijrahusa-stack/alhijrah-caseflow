\set ON_ERROR_STOP on
begin;

insert into public.app_users(auth_user_id,email,display_name,status) values
 ('12000000-0000-0000-0000-000000000001','p4-owner@test.invalid','P4 Owner','active');
insert into public.user_roles(auth_user_id,role_code) values('12000000-0000-0000-0000-000000000001','owner');
insert into public.clients(id,legal_name) values('22000000-0000-0000-0000-000000000001','P4 Client');
insert into public.cases(id,client_id,client_name,case_type,status,service_code) values
 ('32000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','P4 Client','I-130','active','I-130');
insert into public.documents(id,case_id,client_id,object_key,file_name,content_type,size_bytes,content_checksum,version,uploaded_by)
values('42000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','cases/32000000-0000-0000-0000-000000000001/passport.png','passport.png','image/png',100,repeat('a',64),1,'12000000-0000-0000-0000-000000000001');

insert into public.document_extractions(id,document_id,case_id,client_id,document_version,source_sha256,review_token_hash,extraction_kind,engine,engine_version,confidence,mrz_detected,mrz_valid,raw_result,requested_by,expires_at)
values('52000000-0000-0000-0000-000000000001','42000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001',1,repeat('a',64),repeat('b',64),'document_identity','tesseract.js','identity-ocr-v1',98.1,true,true,'{"fields":{"passport_number":"SYNTHETIC"}}','12000000-0000-0000-0000-000000000001',now()+interval '15 minutes');
insert into public.document_extracted_fields(extraction_id,field_path,extracted_value,confidence,source_locator)
values('52000000-0000-0000-0000-000000000001','passport_number','"SYNTHETIC"',98.1,'{"method":"mrz"}');

do $$ begin
  begin
    update public.document_extractions set source_sha256=repeat('c',64) where id='52000000-0000-0000-0000-000000000001';
    raise exception 'extraction source mutation unexpectedly succeeded';
  exception when raise_exception then if sqlerrm='extraction source mutation unexpectedly succeeded' then raise; end if; end;
  begin
    update public.document_extracted_fields set extracted_value='"FORGED"' where extraction_id='52000000-0000-0000-0000-000000000001';
    raise exception 'extracted provenance mutation unexpectedly succeeded';
  exception when raise_exception then if sqlerrm='extracted provenance mutation unexpectedly succeeded' then raise; end if; end;
  begin
    insert into public.document_extractions(document_id,case_id,client_id,document_version,source_sha256,review_token_hash,extraction_kind,engine,engine_version,raw_result,requested_by,expires_at)
    values('42000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001',1,repeat('d',64),repeat('e',64),'document_identity','test','v1','{}','12000000-0000-0000-0000-000000000001',now()+interval '15 minutes');
    raise exception 'mismatched document hash unexpectedly succeeded';
  exception when raise_exception then if sqlerrm='mismatched document hash unexpectedly succeeded' then raise; end if; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','12000000-0000-0000-0000-000000000001',true);
do $$ begin
  if not exists(select 1 from public.document_extractions where id='52000000-0000-0000-0000-000000000001') then raise exception 'authorized extraction read failed'; end if;
  begin
    insert into public.document_extractions(source_sha256,review_token_hash,extraction_kind,engine,engine_version,raw_result,requested_by,expires_at)
    values(repeat('f',64),repeat('0',64),'identity_upload','forged','v1','{}','12000000-0000-0000-0000-000000000001',now()+interval '15 minutes');
    raise exception 'authenticated extraction fabrication unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
select 'P4_PERSISTENT_DOCUMENT_INTELLIGENCE_PASS' as result;
