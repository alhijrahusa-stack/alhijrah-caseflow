\set ON_ERROR_STOP on
begin;

insert into public.app_users(auth_user_id,email,display_name,status) values
 ('19000000-0000-0000-0000-000000000001','p9-scoped@test.invalid','P9 Scoped','active'),
 ('19000000-0000-0000-0000-000000000002','p9-portal@test.invalid','P9 Portal','active') on conflict(auth_user_id) do update set status=excluded.status;
insert into public.user_roles(auth_user_id,role_code) values
 ('19000000-0000-0000-0000-000000000001','case_manager'),
 ('19000000-0000-0000-0000-000000000002','client_owner') on conflict do nothing;
insert into public.clients(id,legal_name) values
 ('29000000-0000-0000-0000-000000000001','P9 Client A'),
 ('29000000-0000-0000-0000-000000000002','P9 Client B');
insert into public.cases(id,client_id,client_name,case_type,status,service_code) values
 ('39000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','P9 Client A','I-130','active','I-130'),
 ('39000000-0000-0000-0000-000000000002','29000000-0000-0000-0000-000000000002','P9 Client B','I-485','active','I-485');
insert into public.documents(id,case_id,client_id,object_key,file_name,content_type,size_bytes,content_checksum) values
 ('49000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','cases/39000000-0000-0000-0000-000000000001/a.pdf','a.pdf','application/pdf',1,repeat('a',64)),
 ('49000000-0000-0000-0000-000000000002','39000000-0000-0000-0000-000000000002','29000000-0000-0000-0000-000000000002','cases/39000000-0000-0000-0000-000000000002/b.pdf','b.pdf','application/pdf',1,repeat('b',64));
insert into public.agency_requests(id,case_id,request_type,title,created_by,updated_by) values
 ('59000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','rfe','P9 RFE A','19000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001'),
 ('59000000-0000-0000-0000-000000000002','39000000-0000-0000-0000-000000000002','rfe','P9 RFE B','19000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001');
insert into public.evidence_requirements(id,agency_request_id,case_id,requirement_code,title,created_by,updated_by) values
 ('69000000-0000-0000-0000-000000000001','59000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','ITEM-1','Evidence A','19000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001'),
 ('69000000-0000-0000-0000-000000000002','59000000-0000-0000-0000-000000000002','39000000-0000-0000-0000-000000000002','ITEM-1','Evidence B','19000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001');
insert into public.access_policies(subject_type,subject_id,scopes) values('user','19000000-0000-0000-0000-000000000001','{"cases":"explicit_client","documents":"explicit_client"}');
insert into public.record_access_grants(subject_type,subject_id,resource_type,resource_id,effect) values('user','19000000-0000-0000-0000-000000000001','client','29000000-0000-0000-0000-000000000001','grant');
insert into public.client_access(client_id,auth_user_id,access_role,status) values('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000002','owner','active');

set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000001',true);
do $$ declare n integer; begin
  select count(*) into n from public.agency_requests; if n<>1 then raise exception 'cross-case agency request escaped: %',n; end if;
  select count(*) into n from public.evidence_requirements; if n<>1 then raise exception 'cross-case requirement escaped: %',n; end if;
  insert into public.evidence_links(id,evidence_requirement_id,document_id,case_id,linked_by) values('79000000-0000-0000-0000-000000000001','69000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001');
  begin
    insert into public.evidence_links(id,evidence_requirement_id,document_id,case_id,linked_by) values('79000000-0000-0000-0000-000000000002','69000000-0000-0000-0000-000000000001','49000000-0000-0000-0000-000000000002','39000000-0000-0000-00000000000001','19000000-0000-0000-0000-000000000001');
    raise exception 'cross-case evidence link succeeded';
  exception when foreign_key_violation or insufficient_privilege then if sqlerrm='cross-case evidence link succeeded' then raise; end if; end;
  update public.agency_requests set status='closed' where id='59000000-0000-0000-0000-000000000002';get diagnostics n=row_count;if n<>0 then raise exception 'cross-case agency request mutation succeeded';end if;
end $$;

select set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000002',true);
do $$ declare n integer; begin select count(*) into n from public.agency_requests;if n<>0 then raise exception 'portal saw staff-only agency request';end if;end $$;
reset role;
set local role anon;
do $$ begin begin perform * from public.agency_requests;raise exception 'anon read agency requests';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
select 'P10_AGENCY_EVIDENCE_MATRIX_PASS' as result;
