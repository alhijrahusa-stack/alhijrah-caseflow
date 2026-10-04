begin;

-- Current Career Gate operational control tables are staff-only through RLS.
revoke all on table public.assignment_settings from anon;
revoke all on table public.ownership_transfer_requests from anon;
revoke all on table public.pipeline_stages from anon;

-- Reconcile authenticated grants to the exact supported staff capabilities.
revoke all on table public.assignment_settings from authenticated;
grant select, update on table public.assignment_settings to authenticated;

revoke all on table public.ownership_transfer_requests from authenticated;
grant select, insert, update on table public.ownership_transfer_requests to authenticated;

revoke all on table public.pipeline_stages from authenticated;
grant select on table public.pipeline_stages to authenticated;

commit;
