\set ON_ERROR_STOP on
begin;

insert into public.app_users(auth_user_id,email,display_name,status) values
 ('1a000000-0000-4000-8000-000000000001','p11-beneficiary@test.invalid','P11 Beneficiary','active'),
 ('1a000000-0000-4000-8000-000000000002','p11-employer@test.invalid','P11 Employer','active'),
 ('1a000000-0000-4000-8000-000000000003','p11-manager@test.invalid','P11 Manager','active');
insert into public.user_roles(auth_user_id,role_code) values
 ('1a000000-0000-4000-8000-000000000001','beneficiary_portal'),
 ('1a000000-0000-4000-8000-000000000002','employer_portal'),
 ('1a000000-0000-4000-8000-000000000003','case_manager');
insert into public.clients(id,legal_name) values
 ('2a000000-0000-4000-8000-000000000001','P11 Client A'),
 ('2a000000-0000-4000-8000-000000000002','P11 Client B');
insert into public.cases(id,client_id,client_name,case_type,status,service_code) values
 ('3a000000-0000-4000-8000-000000000001','2a000000-0000-4000-8000-000000000001','P11 Client A','I-130','active','I-130'),
 ('3a000000-0000-4000-8000-000000000002','2a000000-0000-4000-8000-000000000002','P11 Client B','I-140','active','I-140');
insert into public.people(id,legal_name) values
 ('4a000000-0000-4000-8000-000000000001','P11 Beneficiary A'),
 ('4a000000-0000-4000-8000-000000000002','P11 Beneficiary B');
insert into public.case_people(case_id,person_id,case_role) values
 ('3a000000-0000-4000-8000-000000000001','4a000000-0000-4000-8000-000000000001','beneficiary'),
 ('3a000000-0000-4000-8000-000000000002','4a000000-0000-4000-8000-000000000002','beneficiary');
insert into public.portal_case_access(case_id,auth_user_id,portal_type,person_id,granted_by) values
 ('3a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','beneficiary','4a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000003'),
 ('3a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000002','employer',null,'1a000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000001',true);
do $$ declare n integer; begin
  if not public.caseflow_actor_portal() then raise exception 'beneficiary role was not classified as portal'; end if;
  if public.caseflow_scope('portal')<>'client_self' then raise exception 'beneficiary portal default scope widened'; end if;
  select count(*) into n from public.cases;if n<>1 then raise exception 'beneficiary portal escaped case scope: %',n;end if;
  select count(*) into n from public.clients;if n<>0 then raise exception 'case access widened to client access: %',n;end if;
  select count(*) into n from public.portal_case_access;if n<>1 then raise exception 'portal grant visibility escaped actor scope: %',n;end if;
  begin
    insert into public.portal_case_access(case_id,auth_user_id,portal_type,person_id,granted_by)
    values('3a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000001','beneficiary','4a000000-0000-4000-8000-000000000002','1a000000-0000-4000-8000-000000000001');
    raise exception 'portal actor granted itself a foreign case';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

update public.portal_case_access set status='revoked',revoked_at=now()
where case_id='3a000000-0000-4000-8000-000000000001' and auth_user_id='1a000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000001',true);
do $$ declare n integer; begin
  select count(*) into n from public.cases;if n<>0 then raise exception 'revoked portal retained case access: %',n;end if;
end $$;
reset role;

rollback;
select 'P11_DUAL_CASE_PORTALS_PASS' as result;
