\set ON_ERROR_STOP on
begin;

insert into public.app_users(auth_user_id,email,display_name,status) values
 ('10000000-0000-0000-0000-000000000001','owner@test.invalid','Owner','active'),
 ('10000000-0000-0000-0000-000000000002','global@test.invalid','Global','active'),
 ('10000000-0000-0000-0000-000000000003','scoped@test.invalid','Scoped','active'),
 ('10000000-0000-0000-0000-000000000004','portal-a@test.invalid','Portal A','active'),
 ('10000000-0000-0000-0000-000000000005','inactive@test.invalid','Inactive','inactive'),
 ('10000000-0000-0000-0000-000000000006','unlinked@test.invalid','Unlinked','active')
on conflict(auth_user_id) do update set status=excluded.status;
insert into public.user_roles(auth_user_id,role_code) values
 ('10000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000002','case_manager'),
 ('10000000-0000-0000-0000-000000000003','case_manager'),
 ('10000000-0000-0000-0000-000000000004','client_owner'),
 ('10000000-0000-0000-0000-000000000005','case_manager'),
 ('10000000-0000-0000-0000-000000000006','client_owner') on conflict do nothing;

insert into public.clients(id,legal_name) values
 ('20000000-0000-0000-0000-000000000001','Synthetic Client A'),
 ('20000000-0000-0000-0000-000000000002','Synthetic Client B');
insert into public.cases(id,client_id,client_name,case_type,status,service_code) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Synthetic Client A','I-130','active','I-130'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Synthetic Client B','I-130','active','I-130');
insert into public.documents(id,case_id,client_id,object_key,file_name) values
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','synthetic/a.pdf','a.pdf'),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','synthetic/b.pdf','b.pdf');
insert into public.client_access(client_id,auth_user_id,access_role,status) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','owner','active');
insert into public.access_policies(subject_type,subject_id,scopes) values
 ('user','10000000-0000-0000-0000-000000000003','{"clients":"explicit_client","cases":"explicit_client","documents":"explicit_client","tasks":"explicit_client","billing":"explicit_client"}');
insert into public.record_access_grants(subject_type,subject_id,resource_type,resource_id,effect) values
 ('user','10000000-0000-0000-0000-000000000003','client','20000000-0000-0000-0000-000000000001','grant');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);

do $$ declare n integer; begin
  select count(*) into n from public.clients; if n<>1 then raise exception 'scoped client read escaped: %',n; end if;
  select count(*) into n from public.cases; if n<>1 then raise exception 'scoped case read escaped: %',n; end if;
  select count(*) into n from public.documents; if n<>1 then raise exception 'scoped document read escaped: %',n; end if;
  update public.clients set legal_name='Authorized Client A' where id='20000000-0000-0000-0000-000000000001';
  get diagnostics n=row_count; if n<>1 then raise exception 'same-client update failed'; end if;
  update public.cases set notes='Authorized Case A' where id='30000000-0000-0000-0000-000000000001';
  get diagnostics n=row_count; if n<>1 then raise exception 'same-case update failed'; end if;
  update public.documents set reviewer_notes='Authorized Document A' where id='40000000-0000-0000-0000-000000000001';
  get diagnostics n=row_count; if n<>1 then raise exception 'same-document update failed'; end if;
  update public.clients set legal_name='FORGED' where id='20000000-0000-0000-0000-000000000002';
  get diagnostics n=row_count; if n<>0 then raise exception 'cross-client update succeeded'; end if;
  update public.cases set notes='FORGED' where id='30000000-0000-0000-0000-000000000002';
  get diagnostics n=row_count; if n<>0 then raise exception 'cross-case update succeeded'; end if;
  update public.documents set reviewer_notes='FORGED' where id='40000000-0000-0000-0000-000000000002';
  get diagnostics n=row_count; if n<>0 then raise exception 'cross-document update succeeded'; end if;
  begin
    update public.documents set object_key='cases/30000000-0000-0000-0000-000000000002/stolen.pdf'
      where id='40000000-0000-0000-0000-000000000001';
    raise exception 'forged object key succeeded';
  exception when raise_exception then
    if sqlerrm='forged object key succeeded' then raise; end if;
  end;
  begin
    insert into public.documents(id,case_id,client_id,object_key,file_name) values
      ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','synthetic/forged.pdf','forged.pdf');
    raise exception 'forged document relationship succeeded';
  exception when insufficient_privilege or check_violation or raise_exception then
    if sqlerrm='forged document relationship succeeded' then raise; end if;
  end;
  begin
    perform * from public.clients where id='not-a-uuid';
    raise exception 'malformed uuid accepted';
  exception when invalid_text_representation then null; end;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
do $$ declare n integer; begin
  select count(*) into n from public.clients; if n<>1 then raise exception 'portal client isolation failed: %',n; end if;
  select count(*) into n from public.cases; if n<>1 then raise exception 'portal case isolation failed: %',n; end if;
  select count(*) into n from public.documents; if n<>1 then raise exception 'portal document isolation failed: %',n; end if;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
do $$ declare n integer; begin select count(*) into n from public.clients; if n<>0 then raise exception 'unlinked portal escaped'; end if; end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
do $$ declare n integer; begin select count(*) into n from public.clients; if n<>0 then raise exception 'inactive user escaped'; end if; end $$;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ declare n integer; begin select count(*) into n from public.clients; if n<>2 then raise exception 'global staff broken: %',n; end if; end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ declare n integer; begin select count(*) into n from public.clients; if n<>2 then raise exception 'owner access broken: %',n; end if; end $$;

reset role;
delete from public.client_access where auth_user_id='10000000-0000-0000-0000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
do $$ declare n integer; begin select count(*) into n from public.clients; if n<>0 then raise exception 'revoked portal access remained usable'; end if; end $$;
reset role;

rollback;
select 'P1_DATABASE_ADVERSARIAL_PASS' as result;
