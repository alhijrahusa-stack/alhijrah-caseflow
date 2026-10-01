-- Career Gate security boundary hardening.
-- Preserve authenticated access required by RLS/defaults while removing direct
-- anonymous RPC execution and direct authenticated execution of trigger-only
-- SECURITY DEFINER functions.

begin;

-- RLS helper functions are required by authenticated queries, but are not
-- public RPCs. Keep authenticated/service-role execution only.
revoke execute on function public.cg_staff_id() from public, anon;
revoke execute on function public.cg_staff_role() from public, anon;
revoke execute on function public.cg_can_access_client(uuid) from public, anon;
revoke execute on function public.cg_can_access_client_row(uuid, timestamptz) from public, anon;
revoke execute on function public.cg_busy_intervals(text, timestamptz, timestamptz) from public, anon;

grant execute on function public.cg_staff_id() to authenticated, service_role;
grant execute on function public.cg_staff_role() to authenticated, service_role;
grant execute on function public.cg_can_access_client(uuid) to authenticated, service_role;
grant execute on function public.cg_can_access_client_row(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.cg_busy_intervals(text, timestamptz, timestamptz) to authenticated, service_role;

-- Defaults execute as the inserting role. Staff/admin operations run under the
-- authenticated role, so retain authenticated execution and remove anonymous.
revoke execute on function public.next_client_ref() from public, anon;
revoke execute on function public.next_staff_code() from public, anon;
grant execute on function public.next_client_ref() to authenticated, service_role;
grant execute on function public.next_staff_code() to authenticated, service_role;

-- These functions are invoked by database triggers. They are not application
-- RPC endpoints and must not be directly callable by public/authenticated users.
revoke execute on function public.assign_client_round_robin() from public, anon, authenticated;
revoke execute on function public.ensure_client_account() from public, anon, authenticated;
revoke execute on function public.snapshot_payment_commission() from public, anon, authenticated;
grant execute on function public.assign_client_round_robin() to service_role;
grant execute on function public.ensure_client_account() to service_role;
grant execute on function public.snapshot_payment_commission() to service_role;

-- enqueue_job intentionally supports authenticated staff callers and performs
-- its own staff identity check. Keep that narrow contract explicit.
revoke execute on function public.enqueue_job(text,text,jsonb,text,text,integer,timestamptz) from public, anon;
grant execute on function public.enqueue_job(text,text,jsonb,text,text,integer,timestamptz) to authenticated, service_role;

-- Location boards are security-invoker and rely on underlying RLS.
revoke execute on function public.career_gate_location_boards() from public, anon;
grant execute on function public.career_gate_location_boards() to authenticated, service_role;

-- Server-only outbox: defense in depth in addition to RLS.
revoke all on table public.career_gate_email_outbox from public, anon, authenticated;

-- Supabase Storage exists in hosted environments but not in the local CI stub.
-- Align the bucket with the application boundary: private, 4 MiB max, explicit
-- MIME allowlist. Dynamic SQL keeps fresh local PostgreSQL migrations portable.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      update storage.buckets
         set public = false,
             file_size_limit = 4194304,
             allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']::text[]
       where id = 'documents'
    $sql$;
  end if;
end
$$;

commit;
