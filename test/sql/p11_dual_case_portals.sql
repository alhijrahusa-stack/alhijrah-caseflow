\set ON_ERROR_STOP on
begin;
insert into public.app_users(auth_user_id,email,display_name,status) values
 ('1a000000-0000-0000-0000-000000000001','p11-owner@test.invalid','P11 Owner','active'),
 ('1a000000-0000-0000-0000-000000000002','p11-beneficiary@test.invalid','P11 Beneficiary','active'),
 ('1a000000-0000-0000-0000-000000000003','p11-other@test.invalid','P11 Other','active');
insert into public.user_roles(auth_user_id,role_code) values
 ('1a000000-0000-0000-0000-000000000001','owner'),
 ('1a000000-0000-0000-0000-000000000002','beneficiary_portal'),
 ('1a000000-0000-0000-0000-000000000003','beneficiary_portal');
insert into public.clients(id,legal_name) values
 ('2a000000-0000-0000-0000-000000000001','P11 Client A'),
 ('2a000000-0000-0000-0000-000000000002','P11 Client B');
insert into public.cases(id,client_id,client_name,case_type,status,service_code) values
 ('3a000000-0000-0000-0000-000000000001','2a000000-0000-0000-0000-000000000001','P11 Client A','I-130','active','I-130'),
 ('3a000000-0000-0000-0000-000000000002','2a000000-0000-0000-0000-000000000002','P11 Client B','I-485','active','I-485');
insert into public.people(id,legal_name) values
 ('4a000000-0000-0000-0000-000000000001','P11 Person A'),
 ('4a000000-0000-0000-0000-000000000002','P11 Person B');
insert into public.case_people(case_id,person_id,case_role) values
 ('3a000000-0000-0000-0000-000000000001','4a000000-0000-0000-0000-000000000001','beneficiary'),
 ('3a000000-0000-0000-0000-000000000002','4a000000-0000-0000-0000-000000000002','beneficiary');
insert into public.portal_case_access(case_id,auth_user_id,portal_type,person_id,granted_by) values
 ('3a000000-0000-0000-0000-000000000001','1a000000-0000-0000-0000-000000000002','beneficiary','4a000000-0000-0000-0000-000000000001','1a000000-0000-0000-0000-000000000001');
do $$ begin
  begin
    insert into public.portal_case_access(case_id,auth_user_id,portal_type,person_id,granted_by) values
      ('3a000000-0000-0000-0000-000000000001','1a000000-0000-0000-0000-000000000003','beneficiary','4a000000-0000-0000-0000-000000000002','1a000000-0000-0000-0000-000000000001');
    raise exception 'foreign beneficiary accepted';
  exception when raise_exception then
    if sqlerrm='foreign beneficiary accepted' then raise; end if;
  end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','1a000000-0000-0000-0000-000000000002',true);
do $$ declare n integer; begin
  select count(*) into n from public.cases where id in(
    '3a000000-0000-0000-0000-000000000001','3a000000-0000-0000-0000-000000000002');
  if n<>1 then raise exception 'beneficiary case isolation failed: %',n; end if;
  select count(*) into n from public.portal_case_access;
  if n<>1 then raise exception 'portal membership isolation failed: %',n; end if;
end $$;
reset role;
update public.portal_case_access set status='revoked',revoked_at=now()
 where case_id='3a000000-0000-0000-0000-000000000001' and auth_user_id='1a000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','1a000000-0000-0000-0000-000000000002',true);
do $$ declare n integer; begin
  select count(*) into n from public.cases where id='3a000000-0000-0000-0000-000000000001';
  if n<>0 then raise exception 'revoked portal retained case access'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform * from public.portal_case_access;raise exception 'anon read portal membership';
  exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'P11_DUAL_CASE_PORTALS_PASS' as result;
