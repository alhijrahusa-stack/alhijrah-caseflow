-- Career Gate 032: restore public.clients.english_proficiency.
--
-- Migration 030 introduced this column, but production reported
--   column "english_proficiency" of relation "clients" does not exist
-- while 031 was recorded as applied. The ledger therefore considers 030 done and
-- will not re-run it, so the drift has to be repaired by a new versioned migration
-- rather than by re-applying 030 or by hand.
--
-- Every statement is idempotent, so this is a no-op on a database that already
-- carries the 030 contract. It restores exactly that contract and nothing else:
-- text, nullable, and the canonical value set the application normalizes to.

alter table public.clients
  add column if not exists english_proficiency text null;

alter table public.clients
  alter column english_proficiency drop default,
  alter column english_proficiency drop not null;

alter table public.clients
  drop constraint if exists clients_english_proficiency_check;

alter table public.clients
  add constraint clients_english_proficiency_check
  check (english_proficiency is null or english_proficiency in ('EXCELLENT','GOOD','FAIR','WEAK','NONE'));
