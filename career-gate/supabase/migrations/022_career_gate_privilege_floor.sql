begin;

-- Career Gate operational tables are never exposed to the anon Data API role.
revoke all on table public.client_accounts from anon;
revoke all on table public.requirements from anon;
revoke all on table public.payment_transactions from anon;
revoke all on table public.commission_rules from anon;
revoke all on table public.commissions from anon;

-- Reconcile authenticated grants to the capabilities already enforced by RLS.
revoke all on table public.client_accounts from authenticated;
grant select, insert, update on table public.client_accounts to authenticated;

revoke all on table public.requirements from authenticated;
grant select, insert, update on table public.requirements to authenticated;

revoke all on table public.payment_transactions from authenticated;
grant select, insert on table public.payment_transactions to authenticated;

revoke all on table public.commission_rules from authenticated;
grant select on table public.commission_rules to authenticated;

revoke all on table public.commissions from authenticated;
grant select, insert, update on table public.commissions to authenticated;

-- Server-only outbox remains inaccessible through anon/authenticated Data API roles.
revoke all on table public.career_gate_email_outbox from anon, authenticated;

commit;
