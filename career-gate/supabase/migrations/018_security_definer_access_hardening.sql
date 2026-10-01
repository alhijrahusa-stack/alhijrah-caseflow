begin;

-- Trigger-only Career Gate functions are not RPC endpoints.
revoke execute on function public.assign_client_round_robin() from public, anon, authenticated;
revoke execute on function public.ensure_client_account() from public, anon, authenticated;
revoke execute on function public.snapshot_payment_commission() from public, anon, authenticated;
grant execute on function public.assign_client_round_robin() to service_role;
grant execute on function public.ensure_client_account() to service_role;
grant execute on function public.snapshot_payment_commission() to service_role;

-- RLS/default/scheduling helpers remain available only to signed-in staff and service_role.
revoke execute on function public.cg_staff_id() from public, anon;
revoke execute on function public.cg_staff_role() from public, anon;
revoke execute on function public.cg_can_access_client(uuid) from public, anon;
revoke execute on function public.cg_can_access_client_row(uuid,timestamptz) from public, anon;
revoke execute on function public.cg_busy_intervals(text,timestamptz,timestamptz) from public, anon;
revoke execute on function public.next_client_ref() from public, anon;
revoke execute on function public.next_staff_code() from public, anon;
grant execute on function public.cg_staff_id() to authenticated, service_role;
grant execute on function public.cg_staff_role() to authenticated, service_role;
grant execute on function public.cg_can_access_client(uuid) to authenticated, service_role;
grant execute on function public.cg_can_access_client_row(uuid,timestamptz) to authenticated, service_role;
grant execute on function public.cg_busy_intervals(text,timestamptz,timestamptz) to authenticated, service_role;
grant execute on function public.next_client_ref() to authenticated, service_role;
grant execute on function public.next_staff_code() to authenticated, service_role;

-- Optional legacy/internal functions may exist only on upgraded production projects.
-- Harden them when present without making a clean Career Gate database depend on them.
do $block$
declare
  fn regprocedure;
  sig text;
begin
  foreach sig in array array[
    'public.escalate_stale_applications()',
    'public.expire_stale_jobs()',
    'public.prune_otp_logs()',
    'public.record_delivery_status(text,text,text,timestamp with time zone,bytea,text,text)'
  ]
  loop
    fn := to_regprocedure(sig);
    if fn is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
      execute format('alter function %s set search_path = public, pg_temp', fn);
    end if;
  end loop;
end
$block$;

-- Pin search_path for current Career Gate SECURITY DEFINER functions.
alter function public.assign_client_round_robin() set search_path = public, pg_temp;
alter function public.ensure_client_account() set search_path = public, pg_temp;
alter function public.snapshot_payment_commission() set search_path = public, pg_temp;
alter function public.cg_staff_id() set search_path = public, pg_temp;
alter function public.cg_staff_role() set search_path = public, pg_temp;
alter function public.cg_can_access_client(uuid) set search_path = public, pg_temp;
alter function public.cg_can_access_client_row(uuid,timestamptz) set search_path = public, pg_temp;
alter function public.cg_busy_intervals(text,timestamptz,timestamptz) set search_path = public, pg_temp;
alter function public.next_client_ref() set search_path = public, pg_temp;
alter function public.next_staff_code() set search_path = public, pg_temp;

commit;
