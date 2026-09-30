begin;

-- Enforce caller RLS/privileges through the application timeline view.
do $block$
begin
  if to_regclass('public.v_application_timeline') is not null then
    execute 'alter view public.v_application_timeline set (security_invoker = true)';
  end if;
end
$block$;

-- Make server-only RLS tables explicitly deny direct Data API access.
do $block$
declare
  table_name text;
  policy_name constant text := 'cg_server_only_deny';
begin
  foreach table_name in array array[
    'career_gate_applications',
    'client_ref_counters',
    'idempotency_keys',
    'jobs',
    'otp_requests',
    'rate_limits',
    'security_events',
    'status_sessions',
    'upload_grants'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null
       and not exists (
         select 1
         from pg_policies
         where schemaname = 'public'
           and tablename = table_name
           and policyname = policy_name
       ) then
      execute format(
        'create policy %I on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',
        policy_name,
        table_name
      );
    end if;
  end loop;
end
$block$;

-- Pin mutable search paths without changing function bodies or privileges.
do $block$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'touch_updated_at',
        'jobs_build_search_vector',
        'log_application_status',
        'sync_applications_count',
        'calc_profile_completion',
        'to_hourly',
        'score_skills',
        'score_distance',
        'score_shift',
        'score_pay',
        'score_experience',
        'score_start_date',
        'cg_touch',
        'reject_mutation',
        'enforce_status_transition',
        'rate_limit_hit',
        'rate_limit_count',
        'claim_jobs'
      ]::text[])
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn.signature);
  end loop;
end
$block$;

-- PostGIS compatibility: keep spatial reference data readable while placing
-- the extension-owned table behind RLS when it is present.
do $block$
begin
  if to_regclass('public.spatial_ref_sys') is not null then
    execute 'alter table public.spatial_ref_sys enable row level security';
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'spatial_ref_sys'
        and policyname = 'spatial_ref_sys_read'
    ) then
      execute 'create policy spatial_ref_sys_read on public.spatial_ref_sys for select to anon, authenticated using (true)';
    end if;
  end if;
end
$block$;

commit;
