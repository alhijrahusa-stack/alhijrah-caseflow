begin;

insert into public.background_jobs(id,job_type,idempotency_key,status,payload,priority,max_attempts,input_fingerprint)
values
 ('93000000-0000-4000-8000-000000000001','P3_TEST','p3-claim-1','queued','{}',10,3,repeat('a',64)),
 ('93000000-0000-4000-8000-000000000002','P3_TEST','p3-claim-2','queued','{}',20,2,repeat('b',64));

create temporary table claimed_one as
select * from public.claim_background_jobs('worker-a',1,60);

do $$
declare first_job public.background_jobs%rowtype; second_count integer;
begin
  select * into first_job from claimed_one;
  if first_job.id<>'93000000-0000-4000-8000-000000000001' or first_job.status<>'running' or first_job.attempt_count<>1 or first_job.lease_token is null then
    raise exception 'atomic priority claim failed';
  end if;
  select count(*) into second_count from public.claim_background_jobs('worker-b',8,60) where id=first_job.id;
  if second_count<>0 then raise exception 'concurrent double claim succeeded'; end if;
  if not public.heartbeat_background_job(first_job.id,first_job.lease_token,60) then raise exception 'valid heartbeat failed'; end if;
  if public.heartbeat_background_job(first_job.id,gen_random_uuid(),60) then raise exception 'forged heartbeat succeeded'; end if;
  if not public.complete_background_job(first_job.id,first_job.lease_token,'{"verified":true}'::jsonb) then raise exception 'valid completion failed'; end if;
  if public.complete_background_job(first_job.id,first_job.lease_token,'{}') then raise exception 'replayed completion succeeded'; end if;
end;
$$;

insert into public.background_jobs(id,job_type,idempotency_key,status,payload,priority,max_attempts,input_fingerprint)
values('93000000-0000-4000-8000-000000000003','P3_TEST','p3-retry','queued','{}',5,2,repeat('c',64));

do $$
declare leased public.background_jobs%rowtype; next_status text;
begin
  select * into leased from public.claim_background_jobs('worker-c',1,60);
  next_status:=public.fail_background_job(leased.id,leased.lease_token,'UPSTREAM_TIMEOUT','transient');
  if next_status<>'retrying' then raise exception 'retryable failure was not requeued'; end if;
  update public.background_jobs set available_at=now()-interval '1 second' where id=leased.id;
  select * into leased from public.claim_background_jobs('worker-d',1,60);
  next_status:=public.fail_background_job(leased.id,leased.lease_token,'UPSTREAM_TIMEOUT','transient');
  if next_status<>'failed' then raise exception 'attempt cap was not enforced'; end if;
end;
$$;

insert into public.background_jobs(id,job_type,idempotency_key,status,payload,attempt_count,max_attempts,lease_token,leased_by,lease_expires_at,input_fingerprint)
values('93000000-0000-4000-8000-000000000004','P3_TEST','p3-expired','running','{}',1,3,gen_random_uuid(),'dead-worker',now()-interval '1 second',repeat('d',64));

do $$
declare recovered public.background_jobs%rowtype;
begin
  select * into recovered from public.claim_background_jobs('recovery-worker',1,60);
  if recovered.id<>'93000000-0000-4000-8000-000000000004' or recovered.attempt_count<>2 then raise exception 'expired lease was not recovered'; end if;
end;
$$;

set local role authenticated;
do $$
begin
  begin
    insert into public.background_jobs(job_type,idempotency_key) values('FORGED','p3-forged');
    raise exception 'authenticated job insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.claim_background_jobs('forged-worker',8,900);
    raise exception 'authenticated worker claim unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
