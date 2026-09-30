begin;

create or replace function public.enqueue_job(
  p_type text,
  p_entity_id text,
  p_payload jsonb,
  p_dedupe_key text,
  p_trace_id text,
  p_max_attempts integer,
  p_run_after timestamptz
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if coalesce(v_claims, '') <> '' and public.cg_staff_id() is null then
    raise insufficient_privilege using message = 'not authorized';
  end if;

  insert into public.jobs (
    type,
    entity_id,
    payload,
    dedupe_key,
    trace_id,
    max_attempts,
    run_after
  )
  values (
    p_type,
    p_entity_id,
    coalesce(p_payload, '{}'::jsonb),
    p_dedupe_key,
    p_trace_id,
    p_max_attempts,
    coalesce(p_run_after, now())
  )
  on conflict (dedupe_key) do nothing;
end
$fn$;

revoke execute on function public.enqueue_job(text,text,jsonb,text,text,integer,timestamptz) from public, anon;
grant execute on function public.enqueue_job(text,text,jsonb,text,text,integer,timestamptz) to authenticated, service_role;

commit;
