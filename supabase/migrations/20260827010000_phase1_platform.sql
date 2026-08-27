begin;

create extension if not exists pg_trgm;

create sequence if not exists public.client_number_sequence;
create sequence if not exists public.case_number_sequence;

alter table public.clients add column if not exists client_number text;
alter table public.clients add column if not exists legal_name_ar text;
alter table public.clients add column if not exists profile_object_key text;
alter table public.cases add column if not exists case_number text;
alter table public.cases add column if not exists opened_on date not null default current_date;
alter table public.app_users add column if not exists preferred_language text not null default 'English';
alter table public.app_users add column if not exists profile_object_key text;

create unique index if not exists clients_client_number_unique_idx
  on public.clients(client_number) where client_number is not null;
create unique index if not exists cases_case_number_unique_idx
  on public.cases(case_number) where case_number is not null;
create index if not exists clients_legal_name_ar_idx
  on public.clients(lower(legal_name_ar)) where legal_name_ar is not null and archived_at is null;
create index if not exists clients_passport_number_idx
  on public.clients(passport_number) where passport_number is not null and archived_at is null;
create index if not exists clients_uscis_account_number_idx
  on public.clients(uscis_account_number) where uscis_account_number is not null and archived_at is null;
create index if not exists clients_phone_idx
  on public.clients(phone) where phone is not null and archived_at is null;
create index if not exists cases_receipt_number_idx
  on public.cases(receipt_number) where receipt_number is not null and archived_at is null;
create index if not exists clients_name_search_trgm_idx
  on public.clients using gin (lower(legal_name) gin_trgm_ops) where archived_at is null;
create index if not exists clients_name_ar_search_trgm_idx
  on public.clients using gin (lower(legal_name_ar) gin_trgm_ops) where legal_name_ar is not null and archived_at is null;
create index if not exists clients_email_search_trgm_idx
  on public.clients using gin (lower(email) gin_trgm_ops) where email is not null and archived_at is null;
create index if not exists cases_client_name_search_trgm_idx
  on public.cases using gin (lower(client_name) gin_trgm_ops) where archived_at is null;

create or replace function public.platform_number(prefix text, sequence_name text)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  sequence_value bigint;
begin
  if sequence_name = 'client' then
    sequence_value := nextval('public.client_number_sequence');
  elsif sequence_name = 'case' then
    sequence_value := nextval('public.case_number_sequence');
  else
    raise exception 'unknown platform sequence';
  end if;
  return prefix || '-' || to_char(current_date, 'YYYY') || '-' || lpad(sequence_value::text, 6, '0');
end;
$$;

revoke all on function public.platform_number(text, text) from public, anon, authenticated;
grant execute on function public.platform_number(text, text) to service_role;

create or replace function public.assign_client_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.client_number is null or btrim(new.client_number) = '' then
    new.client_number := public.platform_number('AHC', 'client');
  end if;
  return new;
end;
$$;

create or replace function public.assign_case_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.case_number is null or btrim(new.case_number) = '' then
    new.case_number := public.platform_number('AH', 'case');
  end if;
  if new.case_reference is null or btrim(new.case_reference) = '' then
    new.case_reference := new.case_number;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_platform_number_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'clients' and old.client_number is not null and new.client_number is distinct from old.client_number then
    raise exception 'client number is immutable';
  end if;
  if tg_table_name = 'cases' and old.case_number is not null and new.case_number is distinct from old.case_number then
    raise exception 'case number is immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.assign_client_number() from public, anon, authenticated;
revoke all on function public.assign_case_number() from public, anon, authenticated;
revoke all on function public.prevent_platform_number_change() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgrelid = 'public.clients'::regclass
      and tgname = 'clients_assign_number' and not tgisinternal
  ) then
    execute 'create trigger clients_assign_number before insert on public.clients for each row execute function public.assign_client_number()';
  end if;
  if not exists (
    select 1 from pg_trigger where tgrelid = 'public.clients'::regclass
      and tgname = 'clients_number_immutable' and not tgisinternal
  ) then
    execute 'create trigger clients_number_immutable before update on public.clients for each row execute function public.prevent_platform_number_change()';
  end if;
  if not exists (
    select 1 from pg_trigger where tgrelid = 'public.cases'::regclass
      and tgname = 'cases_assign_number' and not tgisinternal
  ) then
    execute 'create trigger cases_assign_number before insert on public.cases for each row execute function public.assign_case_number()';
  end if;
  if not exists (
    select 1 from pg_trigger where tgrelid = 'public.cases'::regclass
      and tgname = 'cases_number_immutable' and not tgisinternal
  ) then
    execute 'create trigger cases_number_immutable before update on public.cases for each row execute function public.prevent_platform_number_change()';
  end if;
end;
$$;

-- Existing records receive a number once. Existing case_reference values are
-- preserved; only the new immutable case_number column is backfilled.
do $$
declare
  record_id uuid;
begin
  for record_id in select id from public.clients where client_number is null order by created_at, id
  loop
    update public.clients set client_number = public.platform_number('AHC', 'client') where id = record_id;
  end loop;
  for record_id in select id from public.cases where case_number is null order by created_at, id
  loop
    update public.cases set case_number = public.platform_number('AH', 'case') where id = record_id;
  end loop;
end;
$$;

alter table public.clients alter column client_number set not null;
alter table public.cases alter column case_number set not null;

create table if not exists public.office_settings (
  singleton boolean primary key default true check (singleton),
  office_name text not null default 'ALHIJRAH SERVICES',
  logo_object_key text,
  office_email text,
  office_phone text,
  office_whatsapp text,
  office_address text,
  default_language text not null default 'English' check (default_language in ('English','Arabic')),
  email_footer_en text,
  email_footer_ar text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  version integer not null check (version > 0),
  subject_en text not null,
  subject_ar text not null,
  body_en text not null,
  body_ar text not null,
  active boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (template_key, version)
);

create unique index if not exists communication_templates_one_active_idx
  on public.communication_templates(template_key) where active;

create table if not exists public.outbound_communications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  case_id uuid not null references public.cases(id) on delete restrict,
  channel text not null check (channel in ('email')),
  recipient text not null,
  language text not null check (language in ('English','Arabic')),
  template_key text not null,
  template_version integer not null,
  subject text not null,
  body_html text not null,
  body_text text not null,
  status text not null default 'queued' check (status in ('queued','sent','delivered','failed')),
  provider text,
  provider_message_id text,
  failure_code text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists outbound_communications_case_idx
  on public.outbound_communications(case_id, created_at desc);
create index if not exists outbound_communications_client_idx
  on public.outbound_communications(client_id, created_at desc);

insert into public.office_settings(singleton) values (true)
on conflict (singleton) do nothing;

insert into public.communication_templates(
  template_key, version, subject_en, subject_ar, body_en, body_ar, active
) values (
  'case_opened', 1,
  'Your case is now open — {Case_Number}',
  'تم فتح ملفكم — {Case_Number}',
  'Your case has been opened successfully. Use the secure portal link below to follow your case and required actions.',
  'تم فتح ملفكم بنجاح. يمكنكم استخدام رابط البوابة الآمنة أدناه لمتابعة الملف والإجراءات المطلوبة.',
  true
) on conflict (template_key, version) do nothing;

alter table public.office_settings enable row level security;
alter table public.communication_templates enable row level security;
alter table public.outbound_communications enable row level security;

revoke all on public.office_settings, public.communication_templates, public.outbound_communications
from anon, authenticated;

grant select, insert, update on public.office_settings to service_role;
grant select on public.communication_templates to service_role;
grant select, insert, update on public.outbound_communications to service_role;
grant usage, select on sequence public.client_number_sequence, public.case_number_sequence to service_role;

do $$
declare
  protected_table text;
begin
  foreach protected_table in array array['office_settings','communication_templates','outbound_communications']
  loop
    if not exists (
      select 1 from pg_policies where schemaname = 'public'
        and tablename = protected_table and policyname = 'server_only_no_direct_access'
    ) then
      execute format(
        'create policy server_only_no_direct_access on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',
        protected_table
      );
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
