begin;

-- ---------------------------------------------------------------------------
-- 036 — One-time client intake links.
--
-- A staff member issues a link, sends it to the client, and the client submits
-- their own source data and documents through it exactly once. The submission
-- feeds the existing Smart Client Import pipeline unchanged: staging, review,
-- verify, approve and canonical client creation are untouched.
--
-- Additive only. One new table; nothing existing is altered.
--
-- The raw token never reaches this database. Only its SHA-256 digest is stored,
-- so a dump of this table cannot be replayed as a working link.
--
-- Opening or refreshing a link does not consume it. PROCESSING is held only for
-- the duration of one submission, and only a successful staging moves a link to
-- USED — which it can never leave.
-- ---------------------------------------------------------------------------

create table if not exists public.client_import_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  status text not null default 'ACTIVE',
  issued_by uuid not null references public.staff(id) on delete restrict,
  expires_at timestamptz not null,
  processing_started_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  import_case_id uuid references public.client_import_cases(id) on delete restrict,
  created_at timestamptz not null default now(),

  constraint client_import_links_status_ck
    check (status in ('ACTIVE','PROCESSING','USED','REVOKED')),

  -- Exactly a lowercase SHA-256 hex digest: no raw token, no other encoding.
  constraint client_import_links_token_hash_ck
    check (token_hash ~ '^[0-9a-f]{64}$'),

  -- A used link records when it was used and which import case it produced, so
  -- a consumed link can always be traced to the case it created.
  constraint client_import_links_used_ck
    check (status <> 'USED' or (used_at is not null and import_case_id is not null)),

  constraint client_import_links_revoked_ck
    check (status <> 'REVOKED' or revoked_at is not null)
);

-- The submission path looks a link up by digest; the staff panel lists by issuer.
create index if not exists client_import_links_issued_by_idx
  on public.client_import_links (issued_by, created_at desc);
create index if not exists client_import_links_status_idx
  on public.client_import_links (status, expires_at);

alter table public.client_import_links enable row level security;

-- Every path to this table is server-mediated, exactly as for the staging
-- tables in migration 025. The browser never reaches it, so a client cannot
-- enumerate links or learn whether another token exists.
revoke all on table public.client_import_links from anon, authenticated;
create policy client_import_links_direct_api_deny on public.client_import_links
for all to anon, authenticated using (false) with check (false);

commit;
