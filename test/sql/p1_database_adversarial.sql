\set ON_ERROR_STOP on
begin;

insert into public.app_users(auth_user_id,email,display_name,status) values
 ('10000000-0000-0000-0000-000000000001','owner@test.invalid','Owner','active'),
 ('10000000-0000-0000-0000-000000000002','global@test.invalid','Global','active'),
 ('10000000-0000-0000-0000-000000000003','scoped@test.invalid','Scoped','active'),
 ('10000000-0000-0000-0000-000000000004','portal-a@test.invalid','Portal A','active'),
 ('10000000-0000-0000-0000-000000000005','inactive@test.invalid','Inactive','inactive'),
 ('10000000-0000-0000-0000-000000000006','unlinked@test.invalid','Unlinked','active'),
 ('10000000-0000-0000-0000-000000000007','portal-b@test.invalid','Portal B','active')
on conflict(auth_user_id) do update set status=excluded.status;
insert into public.user_roles(auth_user_id,role_code) values
 ('10000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000002','case_manager'),
 ('10000000-0000-0000-0000-000000000003','case_manager'),
 ('10000000-0000-0000-0000-000000000003','billing'),
 ('10000000-0000-0000-0000-000000000004','client_owner'),
 ('10000000-0000-0000-0000-000000000005','case_manager'),
 ('10000000-0000-0000-0000-000000000006','client_owner'),
 ('10000000-0000-0000-0000-000000000007','client_owner') on conflict do nothing;

insert into public.clients(id,legal_name) values
 ('20000000-0000-0000-0000-000000000001','Synthetic Client A'),
 ('20000000-0000-0000-0000-000000000002','Synthetic Client B');
insert into public.cases(id,client_id,client_name,case_type,status,service_code) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Synthetic Client A','I-130','active','I-130'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Synthetic Client B','I-130','active','I-130');
insert into public.documents(id,case_id,client_id,object_key,file_name,content_type,size_bytes,content_checksum,uploaded_by) values
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','cases/30000000-0000-0000-0000-000000000001/a.pdf','a.pdf','application/pdf',1,repeat('a',64),'10000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','cases/30000000-0000-0000-0000-000000000002/b.pdf','b.pdf','application/pdf',1,repeat('b',64),'10000000-0000-0000-0000-000000000001');
insert into public.people(id,legal_name) values
 ('50000000-0000-0000-0000-000000000001','Synthetic Person A'),
 ('50000000-0000-0000-0000-000000000002','Synthetic Person B');
insert into public.case_people(case_id,person_id,case_role) values
 ('30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','beneficiary'),
 ('30000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','beneficiary');
insert into public.alerts(id,client_id,case_id,alert_type,title) values
 ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','synthetic','Alert A'),
 ('60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','synthetic','Alert B');
insert into public.invoices(id,invoice_number,client_id,case_id,status) values
 ('70000000-0000-0000-0000-000000000001','SYN-A','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','issued'),
 ('70000000-0000-0000-0000-000000000002','SYN-B','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','issued');
insert into public.client_access(client_id,auth_user_id,access_role,status) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','owner','active'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000007','owner','active');
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
  select count(*) into n from public.documents where id='40000000-0000-0000-0000-000000000002' and object_key is not null;
  if n<>0 then raise exception 'cross-document download metadata escaped'; end if;
  select count(*) into n from public.alerts where id='60000000-0000-0000-0000-000000000002';
  if n<>0 then raise exception 'cross-client alert read escaped'; end if;
  update public.alerts set status='dismissed' where id='60000000-0000-0000-0000-000000000002';
  get diagnostics n=row_count; if n<>0 then raise exception 'cross-client alert update succeeded'; end if;
  select count(*) into n from public.invoices where id='70000000-0000-0000-0000-000000000002';
  if n<>0 then raise exception 'cross-client invoice read escaped'; end if;
  update public.invoices set status='void' where id='70000000-0000-0000-0000-000000000002';
  get diagnostics n=row_count; if n<>0 then raise exception 'cross-client invoice update succeeded'; end if;
  begin
    insert into public.payments(id,invoice_id,amount_cents,method) values
      ('71000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000002',100,'forged');
    raise exception 'cross-client payment creation succeeded';
  exception when insufficient_privilege or check_violation or foreign_key_violation then
    if sqlerrm='cross-client payment creation succeeded' then raise; end if;
  end;
  begin
    insert into public.case_people(case_id,person_id,case_role) values
      ('30000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','interpreter');
    raise exception 'cross-client participant attachment succeeded';
  exception when insufficient_privilege or check_violation then
    if sqlerrm='cross-client participant attachment succeeded' then raise; end if;
  end;
  begin
    insert into public.client_access(client_id,auth_user_id,access_role,status) values
      ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004','collaborator','active');
    raise exception 'cross-client portal access creation succeeded';
  exception when insufficient_privilege or check_violation then
    if sqlerrm='cross-client portal access creation succeeded' then raise; end if;
  end;
  delete from public.client_access where client_id='20000000-0000-0000-0000-000000000002'
    and auth_user_id='10000000-0000-0000-0000-000000000007';
  get diagnostics n=row_count; if n<>0 then raise exception 'cross-client portal access revoke succeeded'; end if;
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
  insert into public.case_messages(id,case_id,sender_user_id,sender_type,body) values
    ('80000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000004','client','Authorized portal message');
  get diagnostics n=row_count; if n<>1 then raise exception 'portal own-resource write failed'; end if;
end $$;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
do $$ declare n integer; begin select count(*) into n from public.clients; if n<>0 then raise exception 'unlinked portal escaped'; end if; end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
do $$ declare n integer; begin select count(*) into n from public.clients; if n<>0 then raise exception 'inactive user escaped'; end if; end $$;

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ declare n integer; begin select count(*) into n from public.clients; if n<>2 then raise exception 'global staff broken: %',n; end if; end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ declare n integer; begin
  select count(*) into n from public.clients; if n<>2 then raise exception 'owner access broken: %',n; end if;
  update public.cases set notes='Owner Authorized' where id='30000000-0000-0000-0000-000000000002';
  get diagnostics n=row_count; if n<>1 then raise exception 'owner legitimate write failed'; end if;
end $$;

reset role;
delete from public.client_access where auth_user_id='10000000-0000-0000-0000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
do $$ declare n integer; begin select count(*) into n from public.clients; if n<>0 then raise exception 'revoked portal access remained usable'; end if; end $$;
reset role;

rollback;
select 'P1_DATABASE_ADVERSARIAL_PASS' as result;
