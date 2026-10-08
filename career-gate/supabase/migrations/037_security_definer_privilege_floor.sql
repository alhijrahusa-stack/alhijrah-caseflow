-- Career Gate security privilege floor
-- Scope: remove anonymous EXECUTE from employer/contact SECURITY DEFINER RPCs.
-- No table, RLS, auth, business-state, or function-body changes.

revoke execute on function public.get_candidate_contact(uuid) from anon;
revoke execute on function public.unlock_candidate_contact(uuid) from anon;

-- Preserve authenticated/service execution. Authorization remains enforced
-- inside the existing function bodies.
grant execute on function public.get_candidate_contact(uuid) to authenticated, service_role;
grant execute on function public.unlock_candidate_contact(uuid) to authenticated, service_role;
