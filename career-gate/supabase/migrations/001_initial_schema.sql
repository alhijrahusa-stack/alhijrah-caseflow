-- Career Gate schema.
--
-- There are no per-staff accounts. The Next.js server is the only client: it
-- connects with DATABASE_URL (the postgres role) and validates every write.
-- RLS is enabled with no policies, so the Supabase anon/authenticated API
-- roles cannot read or write any table.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Staff directory (names for "Handled By" only; no credentials)
-- ---------------------------------------------------------------------------
create table public.staff_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.staff_directory (name) values ('Yusuf'), ('Salah'), ('Anas')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Reference numbers: CG-YYYY-NNNNNN, one counter row per year.
-- The upsert takes a row lock, so concurrent callers serialize and never
-- receive the same number.
-- ---------------------------------------------------------------------------
create table public.client_ref_counters (
  year integer primary key,
  last_value integer not null
);

create or replace function public.next_client_ref()
returns text
language plpgsql
as $$
declare
  y integer := extract(year from (now() at time zone 'America/Detroit'))::integer;
  n integer;
begin
  insert into public.client_ref_counters as c (year, last_value)
  values (y, 1)
  on conflict (year) do update set last_value = c.last_value + 1
  returning last_value into n;
  if n > 999999 then
    raise exception 'client reference space exhausted for %', y;
  end if;
  return 'CG-' || y || '-' || lpad(n::text, 6, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Clients (public applications and office-created files share this table)
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default public.next_client_ref()
    check (ref ~ '^CG-[0-9]{4}-[0-9]{6}$'),
  status_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  source text not null check (source in ('public', 'office')),
  idempotency_key uuid unique,

  full_name text not null check (length(trim(full_name)) > 0),
  phone text not null,
  email text,
  date_of_birth date,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'ar', 'es')),
  street text,
  city text,
  state text,
  zip text check (zip is null or zip ~ '^[0-9]{5}(-[0-9]{4})?$'),
  appointment_availability text,

  amazon_worked_before boolean,
  amazon_worked_from date,
  amazon_worked_to date,
  amazon_applied_before boolean,
  amazon_application_email text,
  check (amazon_worked_before is true or (amazon_worked_from is null and amazon_worked_to is null)),
  check (amazon_applied_before is true or amazon_application_email is null),
  check (amazon_worked_from is null or amazon_worked_to is null or amazon_worked_to >= amazon_worked_from),

  communication_consent boolean not null default false,

  current_status text not null default 'new_intake' check (current_status in (
    'new_intake', 'needs_review', 'ready_to_apply', 'application_in_progress',
    'assessment_required', 'shift_selected', 'appointment_required',
    'appointment_scheduled', 'pre_hire_completed', 'screening_pending',
    'i9_available', 'post_hire_tasks', 'ready_for_first_day', 'completed', 'cancelled'
  )),
  next_step text not null check (length(trim(next_step)) > 0),
  start_date date,
  handled_by uuid references public.staff_directory (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_status_idx on public.clients (current_status);
create index clients_updated_idx on public.clients (updated_at desc);
create index clients_phone_idx on public.clients (phone);
create index clients_email_idx on public.clients (lower(email));
create index clients_city_idx on public.clients (city);
create index clients_handled_by_idx on public.clients (handled_by);

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
-- Signed authorization (immutable)
-- ---------------------------------------------------------------------------
create table public.client_authorizations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients (id) on delete restrict,
  authorization_version text not null,
  authorization_text text not null,
  authorization_sha256 text not null,
  printed_name text not null check (length(trim(printed_name)) > 0),
  signature text not null check (length(trim(signature)) > 0),
  communication_consent boolean not null,
  signed_at timestamptz not null default now(),
  ip_address text,
  user_agent text
);

-- ---------------------------------------------------------------------------
-- Employment history
-- ---------------------------------------------------------------------------
create table public.employment_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  company text not null check (length(trim(company)) > 0),
  job_title text not null check (length(trim(job_title)) > 0),
  from_date date,
  to_date date,
  created_at timestamptz not null default now(),
  check (from_date is null or to_date is null or to_date >= from_date)
);
create index employment_history_client_idx on public.employment_history (client_id);

-- ---------------------------------------------------------------------------
-- Job preferences, with a snapshot of the catalog entry at selection time
-- ---------------------------------------------------------------------------
create table public.client_preferences (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  rank text not null check (rank in ('primary', 'backup')),
  preference_order integer not null check (preference_order > 0),
  city text not null,
  site_code text not null,
  site_name text not null,
  site_address text,
  job_id text not null,
  job_title text not null,
  employment_type text,
  shift_code text not null,
  days text,
  hours text,
  pay_snapshot text,
  catalog_source text,
  catalog_verified_at text,
  created_at timestamptz not null default now(),
  unique (client_id, site_code, job_id, shift_code)
);
create index client_preferences_client_idx on public.client_preferences (client_id, preference_order);

-- ---------------------------------------------------------------------------
-- Documents (objects live in the private "documents" bucket)
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  doc_type text not null check (doc_type in (
    'photo_id', 'work_authorization', 'social_security_card', 'resume', 'other'
  )),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  reviewed_by uuid references public.staff_directory (id),
  reviewed_at timestamptz,
  rejection_reason text,
  uploaded_by uuid references public.staff_directory (id),
  uploaded_at timestamptz not null default now(),
  check (status <> 'rejected' or length(trim(coalesce(rejection_reason, ''))) > 0)
);
create index documents_client_idx on public.documents (client_id);

create table public.document_access_log (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents (id) on delete restrict,
  client_id uuid not null references public.clients (id) on delete restrict,
  handled_by uuid references public.staff_directory (id),
  ip_address text,
  accessed_at timestamptz not null default now()
);
create index document_access_log_doc_idx on public.document_access_log (document_id, accessed_at desc);

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  appointment_type text not null check (length(trim(appointment_type)) > 0),
  scheduled_at timestamptz not null,
  location text,
  notes text,
  status text not null default 'scheduled' check (status in (
    'scheduled', 'confirmed', 'attended', 'missed', 'rescheduled', 'cancelled'
  )),
  handled_by uuid references public.staff_directory (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index appointments_scheduled_idx on public.appointments (scheduled_at);
create index appointments_client_idx on public.appointments (client_id, scheduled_at);
create trigger appointments_touch before update on public.appointments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Notes (append-only)
-- ---------------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  note text not null check (length(trim(note)) > 0),
  handled_by uuid not null references public.staff_directory (id),
  created_at timestamptz not null default now()
);
create index notes_client_idx on public.notes (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  assigned_to uuid references public.staff_directory (id),
  due_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  completed_at timestamptz,
  completed_by uuid references public.staff_directory (id),
  created_by uuid references public.staff_directory (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'completed') = (completed_at is not null))
);
create index tasks_status_due_idx on public.tasks (status, due_at);
create index tasks_client_idx on public.tasks (client_id);
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Contact history and follow-ups
-- ---------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  method text not null check (method in ('call', 'whatsapp', 'email', 'in_person')),
  result text not null check (length(trim(result)) > 0),
  next_action text,
  followup_date date,
  handled_by uuid not null references public.staff_directory (id),
  created_at timestamptz not null default now()
);
create index contacts_client_idx on public.contacts (client_id, created_at desc);

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  due_date date not null,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  contact_id uuid references public.contacts (id),
  handled_by uuid references public.staff_directory (id),
  completed_at timestamptz,
  completed_by uuid references public.staff_directory (id),
  completion_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index followups_status_due_idx on public.followups (status, due_date);
create index followups_client_idx on public.followups (client_id);
create trigger followups_touch before update on public.followups
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Post-hire tracking (staff record only confirmed facts)
-- ---------------------------------------------------------------------------
create table public.post_hire_items (
  client_id uuid not null references public.clients (id) on delete cascade,
  item text not null check (item in (
    'assessment', 'shift_selection', 'pre_hire_appointment', 'screening',
    'i9_available', 'i9_completion', 'safety_shoes', 'employment_paperwork',
    'a_to_z', 'start_date', 'ready_for_first_day'
  )),
  status text not null check (status in ('not_started', 'in_progress', 'confirmed', 'not_applicable')),
  note text,
  handled_by uuid references public.staff_directory (id),
  updated_at timestamptz not null default now(),
  primary key (client_id, item)
);

-- ---------------------------------------------------------------------------
-- Activity log (append-only)
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients (id) on delete restrict,
  action text not null check (action in (
    'client_created', 'client_updated', 'preference_added', 'preference_removed',
    'status_changed', 'next_step_changed', 'staff_assigned',
    'document_uploaded', 'document_verified', 'document_rejected', 'document_opened',
    'appointment_created', 'appointment_updated', 'appointment_rescheduled', 'appointment_completed',
    'note_added', 'task_added', 'task_updated', 'task_completed',
    'contact_logged', 'followup_created', 'followup_completed', 'post_hire_updated'
  )),
  handled_by uuid references public.staff_directory (id),
  entity_type text,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_client_idx on public.activity_log (client_id, created_at desc);

create or replace function public.reject_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger activity_log_append_only before update or delete on public.activity_log
  for each row execute function public.reject_mutation();
create trigger notes_append_only before update or delete on public.notes
  for each row execute function public.reject_mutation();
create trigger document_access_log_append_only before update or delete on public.document_access_log
  for each row execute function public.reject_mutation();
create trigger client_authorizations_append_only before update or delete on public.client_authorizations
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- Lock out the Supabase Data API roles entirely.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'staff_directory', 'client_ref_counters', 'clients', 'client_authorizations',
    'employment_history', 'client_preferences', 'documents', 'document_access_log',
    'appointments', 'notes', 'tasks', 'contacts', 'followups', 'post_hire_items', 'activity_log'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on public.%I from authenticated', t);
    end if;
  end loop;
end $$;

revoke all on function public.next_client_ref() from public;

-- ---------------------------------------------------------------------------
-- Private Storage bucket (Supabase). Skipped where the storage schema is absent.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public)
    values ('documents', 'documents', false)
    on conflict (id) do update set public = false;
  end if;
end $$;
