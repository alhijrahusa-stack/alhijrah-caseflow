\set ON_ERROR_STOP on
begin;
insert into public.app_users(auth_user_id,email,display_name,status) values('17000000-0000-0000-0000-000000000001','p7-owner@test.invalid','P7 Owner','active');
insert into public.user_roles(auth_user_id,role_code) values('17000000-0000-0000-0000-000000000001','owner');
insert into public.clients(id,legal_name) values('27000000-0000-0000-0000-000000000001','P7 Client'),('27000000-0000-0000-0000-000000000002','Foreign Client');
insert into public.cases(id,client_id,client_name,case_type,status,service_code) values
 ('37000000-0000-0000-0000-000000000001','27000000-0000-0000-0000-000000000001','P7 Client','I-90','active','I-90'),
 ('37000000-0000-0000-0000-000000000002','27000000-0000-0000-0000-000000000002','Foreign Client','I-130','active','I-130');
insert into public.people(id,legal_name) values('47000000-0000-0000-0000-000000000002','Foreign Person');
insert into public.case_people(case_id,person_id,case_role) values('37000000-0000-0000-0000-000000000002','47000000-0000-0000-0000-000000000002','beneficiary');
insert into public.ai_review_runs(id,case_id,provider,model_version,workflow_version,status,requested_by,approved_by,started_at,tool_names,input_snapshot,input_snapshot_sha256,human_review_required)
values('57000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','synthetic','v1','case-review-v1','running','17000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001',now(),array['get_case_summary'],'{"case_id":"37000000-0000-0000-0000-000000000001"}',repeat('a',64),true);
insert into public.ai_findings(id,review_run_id,case_id,finding_key,category,severity,claim,source_references,source_snapshot_sha256,reason,suggested_action,requires_owner_approval)
values('67000000-0000-0000-0000-000000000001','57000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','finding-1','MISSING_DATA','blocker','Synthetic missing field','["answer:a1"]',repeat('a',64),'Required','Human review',true);
update public.ai_review_runs set status='review_required',output_sha256=repeat('b',64),completed_at=now() where id='57000000-0000-0000-0000-000000000001';

do $$ begin
 begin update public.ai_findings set claim='FORGED' where id='67000000-0000-0000-0000-000000000001';raise exception 'AI claim mutation unexpectedly succeeded';exception when raise_exception then if sqlerrm='AI claim mutation unexpectedly succeeded' then raise;end if;end;
 update public.ai_findings set resolution='accepted',resolved_by='17000000-0000-0000-0000-000000000001',resolved_at=now() where id='67000000-0000-0000-0000-000000000001';
 begin insert into public.ai_findings(review_run_id,case_id,participant_id,finding_key,category,severity,claim,source_references,source_snapshot_sha256,reason,suggested_action)
  values('57000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','47000000-0000-0000-0000-000000000002','forged-participant','CONFLICT','review','Forged','["person:foreign"]',repeat('a',64),'Test','Reject');
  raise exception 'cross-case AI participant unexpectedly succeeded';exception when raise_exception then if sqlerrm='cross-case AI participant unexpectedly succeeded' then raise;end if;end;
 begin update public.ai_review_runs set input_snapshot='{"forged":true}' where id='57000000-0000-0000-0000-000000000001';raise exception 'AI input snapshot mutation unexpectedly succeeded';exception when raise_exception then if sqlerrm='AI input snapshot mutation unexpectedly succeeded' then raise;end if;end;
end $$;

set local role anon;
do $$ begin begin perform * from public.ai_findings;raise exception 'anon AI finding read unexpectedly succeeded';exception when insufficient_privilege then null;end;end $$;
reset role;
rollback;
select 'P7_HYBRID_DISCOVERY_INTEGRITY_PASS' as result;
