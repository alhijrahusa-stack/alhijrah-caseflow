begin;

-- Trigger-only Career Gate functions must never be callable as RPC endpoints.
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

-- Internal maintenance/webhook functions are never client RPCs.
revoke execute on function public.escalate_stale_applications() from public, anon, authenticated;
revoke execute on function public.expire_stale_jobs() from public, anon, authenticated;
revoke execute on function public.prune_otp_logs() from public, anon, authenticated;
revoke execute on function public.record_delivery_status(text,text,text,timestamptz,bytea,text,text) from public, anon, authenticated;
grant execute on function public.escalate_stale_applications() to service_role;
grant execute on function public.expire_stale_jobs() to service_role;
grant execute on function public.prune_otp_logs() to service_role;
grant execute on function public.record_delivery_status(text,text,text,timestamptz,bytea,text,text) to service_role;

-- Ensure all hardened SECURITY DEFINER functions resolve unqualified names deterministically.
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
alter function public.escalate_stale_applications() set search_path = public, pg_temp;
alter function public.expire_stale_jobs() set search_path = public, pg_temp;
alter function public.prune_otp_logs() set search_path = public, pg_temp;
alter function public.record_delivery_status(text,text,text,timestamptz,bytea,text,text) set search_path = public, pg_temp;

commit;
