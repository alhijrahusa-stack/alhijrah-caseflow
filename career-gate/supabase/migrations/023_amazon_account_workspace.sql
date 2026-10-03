-- Career Gate Amazon Account Workspace.
-- Server-only credential vault + independent per-client Amazon account snapshot.

create table public.amazon_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(btrim(email)) > 3),
  email_normalized text generated always as (lower(btrim(email))) stored,
  password_ciphertext text not null check (length(password_ciphertext) > 0),
  password_nonce text not null check (length(password_nonce) > 0),
  password_auth_tag text not null check (length(password_auth_tag) > 0),
  pin_ciphertext text not null check (length(pin_ciphertext) > 0),
  pin_nonce text not null check (length(pin_nonce) > 0),
  pin_auth_tag text not null check (length(pin_auth_tag) > 0),
  encryption_key_version text not null check (length(encryption_key_version) > 0),
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE','RESERVED','USED')),
  reserved_by uuid references public.staff(id) on delete restrict,
  reserved_at timestamptz,
  reservation_expires_at timestamptz,
  created_by uuid not null references public.staff(id) on delete restrict,
  updated_by uuid references public.staff(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amazon_emails_state_ck check (
    (status = 'AVAILABLE' and reserved_by is null and reserved_at is null and reservation_expires_at is null)
    or
    (status = 'RESERVED' and reserved_by is not null and reserved_at is not null and reservation_expires_at is not null and reservation_expires_at > reserved_at)
    or
    (status = 'USED' and reserved_by is null and reserved_at is null and reservation_expires_at is null)
  )
);

create unique index amazon_emails_email_normalized_uidx on public.amazon_emails(email_normalized);
create index amazon_emails_status_idx on public.amazon_emails(status);
create index amazon_emails_reservation_expiry_idx on public.amazon_emails(reservation_expires_at) where status = 'RESERVED';

create table public.amazon_accounts (
  id uuid primary key default gen_random_uuid(),
  assigned_to_client_id uuid not null references public.clients(id) on delete restrict,
  source_email_id uuid not null references public.amazon_emails(id) on delete restrict,
  email_snapshot text not null check (length(btrim(email_snapshot)) > 3),
  password_ciphertext text not null check (length(password_ciphertext) > 0),
  password_nonce text not null check (length(password_nonce) > 0),
  password_auth_tag text not null check (length(password_auth_tag) > 0),
  pin_ciphertext text not null check (length(pin_ciphertext) > 0),
  pin_nonce text not null check (length(pin_nonce) > 0),
  pin_auth_tag text not null check (length(pin_auth_tag) > 0),
  encryption_key_version text not null check (length(encryption_key_version) > 0),
  status text not null default 'PENDING' check (status in ('PENDING','READY','DISABLED')),
  assigned_by uuid not null references public.staff(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  ready_by uuid references public.staff(id) on delete restrict,
  ready_at timestamptz,
  updated_by uuid references public.staff(id) on delete restrict,
  updated_at timestamptz not null default now(),
  removed_by uuid references public.staff(id) on delete restrict,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint amazon_accounts_state_ck check (
    (status = 'PENDING' and ready_by is null and ready_at is null and removed_by is null and removed_at is null)
    or
    (status = 'READY' and ready_by is not null and ready_at is not null and removed_by is null and removed_at is null)
    or
    (status = 'DISABLED' and removed_by is not null and removed_at is not null)
  )
);

create unique index amazon_accounts_one_active_per_client_uidx
  on public.amazon_accounts(assigned_to_client_id)
  where status in ('PENDING','READY') and removed_at is null;

create unique index amazon_accounts_one_active_per_source_uidx
  on public.amazon_accounts(source_email_id)
  where status in ('PENDING','READY') and removed_at is null;

create index amazon_accounts_client_idx on public.amazon_accounts(assigned_to_client_id);
create index amazon_accounts_status_idx on public.amazon_accounts(status);
create index amazon_accounts_source_idx on public.amazon_accounts(source_email_id);

create trigger amazon_emails_touch before update on public.amazon_emails
for each row execute function public.cg_touch();

create trigger amazon_accounts_touch before update on public.amazon_accounts
for each row execute function public.cg_touch();

create or replace function public.cg_amazon_email_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'AVAILABLE' then
      raise exception 'amazon_email_delete_forbidden' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.amazon_accounts a where a.source_email_id = old.id) then
      raise exception 'amazon_email_has_history' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.status = 'USED' and new.status <> 'USED' then
    raise exception 'amazon_email_used_terminal' using errcode = 'P0001';
  end if;
  if old.status = 'AVAILABLE' and new.status not in ('AVAILABLE','RESERVED') then
    raise exception 'amazon_email_invalid_transition' using errcode = 'P0001';
  end if;
  if old.status = 'RESERVED' and new.status not in ('RESERVED','AVAILABLE','USED') then
    raise exception 'amazon_email_invalid_transition' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger amazon_emails_state_guard
before update or delete on public.amazon_emails
for each row execute function public.cg_amazon_email_guard();

create or replace function public.cg_amazon_account_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'amazon_account_delete_forbidden' using errcode = 'P0001';
  end if;

  if new.assigned_to_client_id is distinct from old.assigned_to_client_id
     or new.source_email_id is distinct from old.source_email_id
     or new.assigned_by is distinct from old.assigned_by
     or new.assigned_at is distinct from old.assigned_at then
    raise exception 'amazon_account_assignment_immutable' using errcode = 'P0001';
  end if;

  if old.status = 'PENDING' and new.status not in ('PENDING','READY','DISABLED') then
    raise exception 'amazon_account_invalid_transition' using errcode = 'P0001';
  end if;
  if old.status = 'READY' and new.status not in ('READY','DISABLED') then
    raise exception 'amazon_account_invalid_transition' using errcode = 'P0001';
  end if;
  if old.status = 'DISABLED' and new.status <> 'DISABLED' then
    raise exception 'amazon_account_disabled_terminal' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger amazon_accounts_state_guard
before update or delete on public.amazon_accounts
for each row execute function public.cg_amazon_account_guard();

alter table public.amazon_emails enable row level security;
alter table public.amazon_accounts enable row level security;

revoke all on table public.amazon_emails from anon, authenticated;
revoke all on table public.amazon_accounts from anon, authenticated;

create policy amazon_emails_direct_api_deny on public.amazon_emails
for all to anon, authenticated using (false) with check (false);

create policy amazon_accounts_direct_api_deny on public.amazon_accounts
for all to anon, authenticated using (false) with check (false);

-- Supabase Vault is available in hosted production. Seed a versioned 256-bit
-- master key without exposing it to application tables or migration output.
do $do$
declare
  key_exists boolean := false;
begin
  if to_regclass('vault.secrets') is not null
     and to_regprocedure('vault.create_secret(text,text,text,uuid)') is not null then
    execute 'select exists(select 1 from vault.secrets where name = $1)'
      into key_exists using 'career_gate_amazon_credentials_v1';
    if not key_exists then
      execute $sql$
        select vault.create_secret(
          encode(gen_random_bytes(32), 'base64'),
          'career_gate_amazon_credentials_v1',
          'Career Gate Amazon credential encryption key v1',
          null
        )
      $sql$;
    end if;
  end if;
end
$do$;
