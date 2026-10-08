-- Career Gate security privilege floor
-- Scope: remove anonymous EXECUTE from employer/contact SECURITY DEFINER RPCs
-- when those legacy employer RPCs exist in the target schema.
-- No table, RLS, auth, business-state, or function-body changes.

do $$
begin
  if to_regprocedure('public.get_candidate_contact(uuid)') is not null then
    execute 'revoke execute on function public.get_candidate_contact(uuid) from anon';
    execute 'grant execute on function public.get_candidate_contact(uuid) to authenticated, service_role';
  end if;

  if to_regprocedure('public.unlock_candidate_contact(uuid)') is not null then
    execute 'revoke execute on function public.unlock_candidate_contact(uuid) from anon';
    execute 'grant execute on function public.unlock_candidate_contact(uuid) to authenticated, service_role';
  end if;
end
$$;
