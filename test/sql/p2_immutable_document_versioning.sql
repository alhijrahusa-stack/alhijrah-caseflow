\set ON_ERROR_STOP on
begin;

insert into public.app_users(auth_user_id,email,display_name,status) values
  ('11000000-0000-0000-0000-000000000001','document-owner@test.invalid','Document Owner','active');
insert into public.user_roles(auth_user_id,role_code) values
  ('11000000-0000-0000-0000-000000000001','owner');
insert into public.clients(id,legal_name) values
  ('21000000-0000-0000-0000-000000000001','Immutable Client A'),
  ('21000000-0000-0000-0000-000000000002','Immutable Client B');
insert into public.cases(id,client_id,client_name,case_type,status,service_code) values
  ('31000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001','Immutable Client A','I-130','active','I-130'),
  ('31000000-0000-0000-0000-000000000002','21000000-0000-0000-0000-000000000002','Immutable Client B','I-130','active','I-130');

insert into public.documents(
  id,case_id,client_id,object_key,file_name,content_type,size_bytes,
  content_checksum,version,uploaded_by
) values (
  '41000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  'cases/31000000-0000-0000-0000-000000000001/v1.pdf',
  'identity.pdf','application/pdf',100,repeat('a',64),1,
  '11000000-0000-0000-0000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',true);
do $$
begin
  begin
    insert into public.documents(
      id,case_id,client_id,object_key,file_name,content_type,size_bytes,
      content_checksum,version,uploaded_by
    ) values (
      '41000000-0000-0000-0000-000000000005',
      '31000000-0000-0000-0000-000000000001',
      '21000000-0000-0000-0000-000000000001',
      'cases/31000000-0000-0000-0000-000000000001/browser-forged.pdf',
      'browser-forged.pdf','application/pdf',100,repeat('e',64),1,
      '11000000-0000-0000-0000-000000000001'
    );
    raise exception 'direct authenticated document metadata insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
begin
  begin
    update public.documents set object_key='cases/31000000-0000-0000-0000-000000000001/rewritten.pdf'
    where id='41000000-0000-0000-0000-000000000001';
    raise exception 'immutable object key update unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm = 'immutable object key update unexpectedly succeeded' then raise; end if;
  end;

  begin
    delete from public.documents where id='41000000-0000-0000-0000-000000000001';
    raise exception 'immutable document deletion unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm = 'immutable document deletion unexpectedly succeeded' then raise; end if;
  end;

  begin
    insert into public.documents(
      id,case_id,client_id,object_key,file_name,content_type,size_bytes,
      content_checksum,version,replaces_document_id,uploaded_by
    ) values (
      '41000000-0000-0000-0000-000000000002',
      '31000000-0000-0000-0000-000000000002',
      '21000000-0000-0000-0000-000000000002',
      'cases/31000000-0000-0000-0000-000000000002/forged.pdf',
      'forged.pdf','application/pdf',100,repeat('b',64),2,
      '41000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000001'
    );
    raise exception 'cross-case replacement unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm = 'cross-case replacement unexpectedly succeeded' then raise; end if;
  end;
end;
$$;

insert into public.documents(
  id,case_id,client_id,object_key,file_name,content_type,size_bytes,
  content_checksum,version,replaces_document_id,uploaded_by
) values (
  '41000000-0000-0000-0000-000000000003',
  '31000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  'cases/31000000-0000-0000-0000-000000000001/v2.pdf',
  'identity-new.pdf','application/pdf',101,repeat('c',64),2,
  '41000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001'
);

do $$
declare n integer;
begin
  select count(*) into n from public.documents
  where id in ('41000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000003')
    and byte_verified_at is not null;
  if n <> 2 then raise exception 'verified immutable version chain incomplete: %',n; end if;

  begin
    insert into public.documents(
      id,case_id,client_id,object_key,file_name,content_type,size_bytes,
      content_checksum,version,replaces_document_id,uploaded_by
    ) values (
      '41000000-0000-0000-0000-000000000004',
      '31000000-0000-0000-0000-000000000001',
      '21000000-0000-0000-0000-000000000001',
      'cases/31000000-0000-0000-0000-000000000001/v2-branch.pdf',
      'identity-branch.pdf','application/pdf',102,repeat('d',64),2,
      '41000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000001'
    );
    raise exception 'branched replacement unexpectedly succeeded';
  exception when unique_violation or raise_exception then
    if sqlerrm = 'branched replacement unexpectedly succeeded' then raise; end if;
  end;
end;
$$;

rollback;
select 'P2_IMMUTABLE_DOCUMENT_VERSIONING_PASS' as result;
