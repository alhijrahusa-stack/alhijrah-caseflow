\set ON_ERROR_STOP on
begin;

insert into public.app_users(auth_user_id,email,display_name,status) values
 ('15000000-0000-0000-0000-000000000001','p5-owner@test.invalid','P5 Owner','active');
insert into public.user_roles(auth_user_id,role_code) values('15000000-0000-0000-0000-000000000001','owner');
insert into public.clients(id,legal_name) values('25000000-0000-0000-0000-000000000001','Before Review');

insert into public.document_extractions(id,source_sha256,review_token_hash,extraction_kind,engine,engine_version,status,raw_result,requested_by,expires_at)
values('55000000-0000-0000-0000-000000000001',repeat('1',64),repeat('2',64),'identity_upload','tesseract.js','identity-ocr-v1','reviewing','{"fields":{"legal_name":"Reviewed Person","passport_number":"P5-SYNTHETIC"}}','15000000-0000-0000-0000-000000000001',now()+interval '15 minutes');
insert into public.document_extracted_fields(id,extraction_id,field_path,extracted_value,source_locator) values
 ('65000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001','legal_name','"Reviewed Person"','{"method":"mrz"}'),
 ('65000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000001','passport_number','"P5-SYNTHETIC"','{"method":"mrz"}');

set local role authenticated;
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000001',true);
select * from public.commit_verified_identity_extraction(
  '55000000-0000-0000-0000-000000000001','client','25000000-0000-0000-0000-000000000001',
  '{"legal_name":"Reviewed Person","passport_number":"P5-SYNTHETIC"}'::jsonb);

do $$ begin
  if (select legal_name from public.clients where id='25000000-0000-0000-0000-000000000001')<>'Reviewed Person'
  then raise exception 'canonical client was not committed'; end if;
  if (select count(*) from public.verified_canonical_fields where client_id='25000000-0000-0000-0000-000000000001' and status='current')<>2
  then raise exception 'verified canonical provenance was not committed'; end if;
  if (select status from public.document_extractions where id='55000000-0000-0000-0000-000000000001')<>'confirmed'
  then raise exception 'extraction confirmation was not atomic'; end if;
  if not exists(select 1 from public.audit_events where action='verified_identity_committed' and entity_id='25000000-0000-0000-0000-000000000001')
  then raise exception 'canonical commit audit is missing'; end if;
  begin
    insert into public.verified_canonical_fields(client_id,subject_type,subject_id,field_path,field_value,revision,source_extraction_id,source_field_id,source_sha256,verified_by)
    values('25000000-0000-0000-0000-000000000001','client','25000000-0000-0000-0000-000000000001','passport_number','"FORGED"',2,
      '55000000-0000-0000-0000-000000000001','65000000-0000-0000-0000-000000000002',repeat('1',64),'15000000-0000-0000-0000-000000000001');
    raise exception 'direct canonical fabrication unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin
  begin
    update public.verified_canonical_fields set field_value='"FORGED"' where client_id='25000000-0000-0000-0000-000000000001';
    raise exception 'canonical provenance mutation unexpectedly succeeded';
  exception when raise_exception then if sqlerrm='canonical provenance mutation unexpectedly succeeded' then raise; end if; end;
  begin
    delete from public.verified_canonical_fields where client_id='25000000-0000-0000-0000-000000000001';
    raise exception 'canonical provenance deletion unexpectedly succeeded';
  exception when raise_exception then if sqlerrm='canonical provenance deletion unexpectedly succeeded' then raise; end if; end;
end $$;

set local role anon;
do $$ begin
  begin
    perform * from public.commit_verified_identity_extraction('55000000-0000-0000-0000-000000000001','client','25000000-0000-0000-0000-000000000001','{}');
    raise exception 'anon canonical commit unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
select 'P5_VERIFIED_CANONICAL_COMMIT_PASS' as result;
