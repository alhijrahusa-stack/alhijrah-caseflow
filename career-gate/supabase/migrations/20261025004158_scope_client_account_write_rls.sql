begin;

-- Keep the existing admin/manager account-writing capability, but require
-- actual client-row authorization on BOTH the existing and proposed account.
-- The SELECT policy already checks client scope; enforcing it here as well
-- closes direct Data API reassignment/insert paths and provides defense in depth.
drop policy if exists accounts_insert on public.client_accounts;
create policy accounts_insert on public.client_accounts
  for insert to authenticated
  with check (
    public.cg_staff_role() in ('admin', 'manager')
    and public.cg_can_access_client(client_id)
  );

drop policy if exists accounts_update on public.client_accounts;
create policy accounts_update on public.client_accounts
  for update to authenticated
  using (
    public.cg_staff_role() in ('admin', 'manager')
    and public.cg_can_access_client(client_id)
  )
  with check (
    public.cg_staff_role() in ('admin', 'manager')
    and public.cg_can_access_client(client_id)
  );

commit;
