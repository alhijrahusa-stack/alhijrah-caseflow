-- Career Gate: initial schema.
-- Anonymous users get no table access. Public intake and status lookup go
-- through Next.js route handlers that use the service role server-side.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Clients (one row per intake)
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  first_name text not null,
  last_name text not null,
  phone text not null,
  email text,
  preferred_language text not null default 'en',
  whatsapp_consent boolean not null default false,
  city text not null,
  site_code text not null,
  job_code text not null,
  primary_shift text not null,
  backup_shift text,
  pay_expectation_cents integer check (pay_expectation_cents is null or pay_expectation_cents >= 0),
  stage text not null default 'new' check (stage in (
    'new', 'documents_pending', 'documents_verified', 'appointment_scheduled',
    'application_submitted', 'hired', 'rejected', 'withdrawn'
  )),
  assigned_to uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_stage_idx on public.clients (stage);
create index clients_created_at_idx on public.clients (created_at desc);
create index clients_phone_idx on public.clients (phone);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Workflow history (append-only)
-- ---------------------------------------------------------------------------
create table public.workflow_events (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete restrict,
  from_stage text not null,
  to_stage text not null,
  actor uuid references public.profiles (id),
  note text,
  created_at timestamptz not null default now()
);
create index workflow_events_client_idx on public.workflow_events (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete cascade,
  title text not null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  assigned_to uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index tasks_open_idx on public.tasks (status, due_at);

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  kind text not null check (kind in ('orientation', 'document_check', 'hiring_event', 'follow_up')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'no_show', 'cancelled')),
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index appointments_starts_idx on public.appointments (starts_at);

-- ---------------------------------------------------------------------------
-- Documents (files live in a private Storage bucket)
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  kind text not null check (kind in ('id', 'work_authorization', 'ssn_card', 'resume', 'other')),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  verified boolean not null default false,
  ocr_status text not null default 'none' check (ocr_status in ('none', 'pending', 'done', 'failed')),
  ocr_text text,
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index documents_client_idx on public.documents (client_id);

-- ---------------------------------------------------------------------------
-- Payments (ledger; amounts in cents)
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  method text not null check (method in ('cash', 'card', 'zelle', 'check', 'other')),
  status text not null default 'received' check (status in ('received', 'refunded', 'void')),
  reference text,
  received_at timestamptz not null default now(),
  recorded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index payments_client_idx on public.payments (client_id);

-- ---------------------------------------------------------------------------
-- Activity timeline (append-only)
-- ---------------------------------------------------------------------------
create table public.activity (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete restrict,
  actor uuid references public.profiles (id),
  type text not null,
  summary text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_client_idx on public.activity (client_id, created_at desc);

create or replace function public.reject_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger activity_append_only before update or delete on public.activity
  for each row execute function public.reject_mutation();
create trigger workflow_events_append_only before update or delete on public.workflow_events
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- Outbound notification queue (drained by the process-notifications function)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete cascade,
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  to_phone text not null,
  template text not null,
  params jsonb not null default '[]'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text,
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_queue_idx on public.notifications (status, send_after);

-- Claims a batch atomically so concurrent workers never double-send.
-- A claim is a 10-minute lease: rows left in 'sending' by a crashed worker
-- become claimable again once send_after passes.
create or replace function public.claim_notifications(batch_size integer default 20)
returns setof public.notifications
language sql
security definer
set search_path = public
as $$
  update public.notifications n
     set status = 'sending',
         attempts = n.attempts + 1,
         send_after = now() + interval '10 minutes'
   where n.id in (
     select id from public.notifications
      where status in ('queued', 'sending') and send_after <= now() and attempts < 5
      order by send_after
      limit batch_size
      for update skip locked
   )
  returning n.*;
$$;
revoke all on function public.claim_notifications(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security: staff only
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.workflow_events enable row level security;
alter table public.tasks enable row level security;
alter table public.appointments enable row level security;
alter table public.documents enable row level security;
alter table public.payments enable row level security;
alter table public.activity enable row level security;
alter table public.notifications enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (public.is_staff());
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy clients_staff on public.clients for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy tasks_staff on public.tasks for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy appointments_staff on public.appointments for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy documents_staff on public.documents for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Ledger and history: staff may read and insert; corrections are new rows.
create policy payments_read on public.payments for select to authenticated using (public.is_staff());
create policy payments_insert on public.payments for insert to authenticated with check (public.is_staff());
create policy payments_admin_update on public.payments for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy workflow_events_read on public.workflow_events for select to authenticated using (public.is_staff());
create policy workflow_events_insert on public.workflow_events for insert to authenticated with check (public.is_staff());
create policy activity_read on public.activity for select to authenticated using (public.is_staff());
create policy activity_insert on public.activity for insert to authenticated with check (public.is_staff());

create policy notifications_read on public.notifications for select to authenticated using (public.is_staff());
create policy notifications_insert on public.notifications for insert to authenticated with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Storage: private bucket, staff-only objects
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('client-documents', 'client-documents', false)
on conflict (id) do nothing;

create policy client_documents_staff on storage.objects for all to authenticated
  using (bucket_id = 'client-documents' and public.is_staff())
  with check (bucket_id = 'client-documents' and public.is_staff());
