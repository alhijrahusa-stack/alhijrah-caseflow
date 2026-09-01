begin;

alter table public.background_jobs
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists priority integer not null default 100,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists lease_token uuid,
  add column if not exists leased_by text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists input_fingerprint text,
  add column if not exists failure_class text;

alter table public.generated_artifacts add column if not exists background_job_id uuid;
alter table public.ai_review_runs add column if not exists background_job_id uuid;

update public.background_jobs set max_attempts=greatest(max_attempts,attempt_count,1)
where max_attempts<attempt_count or max_attempts<1;
update public.background_jobs set status='retrying',available_at=now(),lease_token=null,leased_by=null,lease_expires_at=null,updated_at=now()
where status='running' and (lease_token is null or leased_by is null or lease_expires_at is null);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.background_jobs'::regclass and conname='background_jobs_priority_bounds') then
    alter table public.background_jobs add constraint background_jobs_priority_bounds check(priority between 0 and 1000);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.background_jobs'::regclass and conname='background_jobs_attempt_bounds') then
    alter table public.background_jobs add constraint background_jobs_attempt_bounds check(attempt_count between 0 and max_attempts and max_attempts between 1 and 25);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.background_jobs'::regclass and conname='background_jobs_fingerprint_shape') then
    alter table public.background_jobs add constraint background_jobs_fingerprint_shape check(input_fingerprint is null or input_fingerprint ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.background_jobs'::regclass and conname='background_jobs_lease_shape') then
    alter table public.background_jobs add constraint background_jobs_lease_shape check(
      (status='running' and lease_token is not null and leased_by is not null and lease_expires_at is not null)
      or (status<>'running' and lease_token is null and leased_by is null and lease_expires_at is null)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.generated_artifacts'::regclass and conname='generated_artifacts_background_job_fk') then
    alter table public.generated_artifacts add constraint generated_artifacts_background_job_fk foreign key(background_job_id) references public.background_jobs(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.ai_review_runs'::regclass and conname='ai_review_runs_background_job_fk') then
    alter table public.ai_review_runs add constraint ai_review_runs_background_job_fk foreign key(background_job_id) references public.background_jobs(id) on delete restrict;
  end if;
end;
$$;

alter table public.background_jobs validate constraint background_jobs_lease_shape;

create index if not exists background_jobs_claim_idx
  on public.background_jobs(priority,available_at,created_at)
  where status in('queued','retrying','running');
create unique index if not exists generated_artifacts_background_job_uidx on public.generated_artifacts(background_job_id) where background_job_id is not null;
create unique index if not exists ai_review_runs_background_job_uidx on public.ai_review_runs(background_job_id) where background_job_id is not null;

alter table public.background_jobs enable row level security;
alter table public.background_jobs force row level security;
revoke insert,update,delete on public.background_jobs from authenticated;
alter policy background_jobs_write_floor on public.background_jobs
  using(false) with check(false);

create or replace function public.claim_background_jobs(p_worker_id text,p_limit integer default 2,p_lease_seconds integer default 120)
returns setof public.background_jobs
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if nullif(btrim(p_worker_id),'') is null then raise exception 'WORKER_ID_REQUIRED'; end if;
  p_limit:=greatest(1,least(coalesce(p_limit,2),8));
  p_lease_seconds:=greatest(15,least(coalesce(p_lease_seconds,120),900));
  return query
  with candidates as (
    select id from public.background_jobs
    where attempt_count<max_attempts and available_at<=now()
      and (status in('queued','retrying') or (status='running' and lease_expires_at<now()))
    order by priority,available_at,created_at
    for update skip locked
    limit p_limit
  )
  update public.background_jobs j set
    status='running',attempt_count=j.attempt_count+1,lease_token=gen_random_uuid(),leased_by=p_worker_id,
    lease_expires_at=now()+make_interval(secs=>p_lease_seconds),last_heartbeat_at=now(),
    started_at=coalesce(j.started_at,now()),completed_at=null,updated_at=now()
  from candidates c where j.id=c.id returning j.*;
end;
$$;

create or replace function public.heartbeat_background_job(p_job_id uuid,p_lease_token uuid,p_lease_seconds integer default 120)
returns boolean language sql security definer set search_path=public,pg_temp as $$
  with changed as (
    update public.background_jobs set
      lease_expires_at=now()+make_interval(secs=>greatest(15,least(coalesce(p_lease_seconds,120),900))),
      last_heartbeat_at=now(),updated_at=now()
    where id=p_job_id and status='running' and lease_token=p_lease_token and lease_expires_at>now()
    returning 1
  ) select exists(select 1 from changed);
$$;

create or replace function public.complete_background_job(p_job_id uuid,p_lease_token uuid,p_result jsonb default '{}'::jsonb)
returns boolean language sql security definer set search_path=public,pg_temp as $$
  with changed as (
    update public.background_jobs set status='succeeded',progress=100,result=coalesce(p_result,'{}'::jsonb),
      lease_token=null,leased_by=null,lease_expires_at=null,last_error_code=null,failure_class=null,
      completed_at=now(),updated_at=now()
    where id=p_job_id and status='running' and lease_token=p_lease_token and lease_expires_at>now()
    returning 1
  ) select exists(select 1 from changed);
$$;

create or replace function public.fail_background_job(p_job_id uuid,p_lease_token uuid,p_error_code text,p_failure_class text default 'transient')
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text;
begin
  if p_failure_class not in('transient','rate_limited','permanent') then raise exception 'INVALID_FAILURE_CLASS'; end if;
  update public.background_jobs set
    status=case when p_failure_class='permanent' or attempt_count>=max_attempts then 'failed' else 'retrying' end,
    available_at=case when p_failure_class='permanent' or attempt_count>=max_attempts then available_at
      else now()+make_interval(secs=>least(900,5*power(2,greatest(attempt_count-1,0))::integer)) end,
    last_error_code=left(coalesce(nullif(p_error_code,''),'JOB_FAILED'),120),failure_class=p_failure_class,
    lease_token=null,leased_by=null,lease_expires_at=null,
    completed_at=case when p_failure_class='permanent' or attempt_count>=max_attempts then now() else null end,
    updated_at=now()
  where id=p_job_id and status='running' and lease_token=p_lease_token and lease_expires_at>now()
  returning status into v_status;
  if v_status is null then raise exception 'JOB_LEASE_INVALID'; end if;
  return v_status;
end;
$$;

revoke all on function public.claim_background_jobs(text,integer,integer) from public,anon,authenticated;
revoke all on function public.heartbeat_background_job(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.complete_background_job(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.fail_background_job(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_background_jobs(text,integer,integer) to service_role;
grant execute on function public.heartbeat_background_job(uuid,uuid,integer) to service_role;
grant execute on function public.complete_background_job(uuid,uuid,jsonb) to service_role;
grant execute on function public.fail_background_job(uuid,uuid,text,text) to service_role;

commit;
