-- Career Gate 002: staff auth + RBAC + RLS, status state machine, rate limits,
-- idempotency, OTP status access, notifications, job queue, audit alerts,
-- scheduling, assessments, document intelligence, semantic index.
--
-- Access model:
--   * Public routes run server-side as the database owner and validate input.
--   * Staff routes run inside a transaction with `set local role authenticated`
--     and request.jwt.claims set from a verified Supabase Auth JWT, so these
--     RLS policies apply to every staff read and write (defense in depth on
--     top of the server's role checks).
--   * anon has no access to any table.

create extension if not exists btree_gist;
create extension if not exists pg_trgm;
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Staff (was staff_directory)
-- ---------------------------------------------------------------------------
alter table public.staff_directory rename to staff;
alter table public.staff rename column name to display_name;
alter table public.staff
  add column auth_user_id uuid unique references auth.users (id) on delete set null,
  add column email text,
  add column role text not null default 'staff' check (role in ('admin', 'manager', 'staff')),
  add column updated_at timestamptz not null default now();
create unique index staff_email_key on public.staff (lower(email)) where email is not null;
create trigger staff_touch before update on public.staff
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
alter table public.clients rename column handled_by to assigned_staff;
alter table public.clients drop constraint clients_source_check;
update public.clients set source = case source when 'public' then 'public_intake' else 'staff_manual' end;
alter table public.clients
  add constraint clients_source_check check (source in ('public_intake', 'staff_manual')),
  drop column status_token,
  drop column idempotency_key,
  add column created_by uuid references public.staff (id),
  add column currently_amazon boolean,
  add column via_agency boolean,
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.staff (id),
  add column delete_reason text,
  add constraint clients_delete_reason check (deleted_at is null or length(trim(coalesce(delete_reason, ''))) > 0);

create index clients_name_trgm on public.clients using gin (full_name gin_trgm_ops);
create index clients_email_trgm on public.clients using gin (email gin_trgm_ops);
create index clients_ref_trgm on public.clients using gin (ref gin_trgm_ops);
create index clients_phone_pattern on public.clients (phone text_pattern_ops);
create index clients_live_updated_idx on public.clients (updated_at desc) where deleted_at is null;
create index clients_assigned_idx on public.clients (assigned_staff) where deleted_at is null;

-- The reference generator runs under the staff role too.
alter function public.next_client_ref() security definer set search_path = public;

-- ---------------------------------------------------------------------------
-- Status state machine (enforced in the database; the server mirrors it)
-- ---------------------------------------------------------------------------
create table public.status_transitions (
  from_status text not null,
  to_status text not null,
  primary key (from_status, to_status)
);

insert into public.status_transitions (from_status, to_status) values
  ('new_intake', 'needs_review'), ('new_intake', 'ready_to_apply'), ('new_intake', 'cancelled'),
  ('needs_review', 'ready_to_apply'), ('needs_review', 'cancelled'),
  ('ready_to_apply', 'application_in_progress'), ('ready_to_apply', 'needs_review'), ('ready_to_apply', 'cancelled'),
  ('application_in_progress', 'assessment_required'), ('application_in_progress', 'shift_selected'),
  ('application_in_progress', 'appointment_required'), ('application_in_progress', 'needs_review'),
  ('application_in_progress', 'cancelled'),
  ('assessment_required', 'shift_selected'), ('assessment_required', 'application_in_progress'), ('assessment_required', 'cancelled'),
  ('shift_selected', 'appointment_required'), ('shift_selected', 'appointment_scheduled'), ('shift_selected', 'cancelled'),
  ('appointment_required', 'appointment_scheduled'), ('appointment_required', 'cancelled'),
  ('appointment_scheduled', 'pre_hire_completed'), ('appointment_scheduled', 'appointment_required'), ('appointment_scheduled', 'cancelled'),
  ('pre_hire_completed', 'screening_pending'), ('pre_hire_completed', 'cancelled'),
  ('screening_pending', 'i9_available'), ('screening_pending', 'cancelled'),
  ('i9_available', 'post_hire_tasks'), ('i9_available', 'cancelled'),
  ('post_hire_tasks', 'ready_for_first_day'), ('post_hire_tasks', 'cancelled'),
  ('ready_for_first_day', 'completed'), ('ready_for_first_day', 'post_hire_tasks'), ('ready_for_first_day', 'cancelled'),
  ('cancelled', 'needs_review');

create table public.status_entry_states (status text primary key);
insert into public.status_entry_states values ('new_intake'), ('needs_review'), ('ready_to_apply');

-- An explicit admin override is signalled with `set local cg.status_override`;
-- the server only sets it for admins and always logs the reason.
create or replace function public.enforce_status_transition()
returns trigger language plpgsql as $$
declare
  overriding boolean := coalesce(current_setting('cg.status_override', true), '') <> '';
begin
  if tg_op = 'INSERT' then
    if not overriding and not exists (select 1 from public.status_entry_states where status = new.current_status) then
      raise exception 'invalid_initial_status: %', new.current_status using errcode = 'P0001';
    end if;
  elsif new.current_status is distinct from old.current_status and not overriding then
    if not exists (
      select 1 from public.status_transitions where from_status = old.current_status and to_status = new.current_status
    ) then
      raise exception 'invalid_status_transition: % -> %', old.current_status, new.current_status using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger clients_status_transition before insert or update of current_status on public.clients
  for each row execute function public.enforce_status_transition();

-- ---------------------------------------------------------------------------
-- Employment history: company vs self-employed
-- ---------------------------------------------------------------------------
alter table public.employment_history
  add column employment_kind text not null default 'company' check (employment_kind in ('company', 'self_employed')),
  alter column company drop not null;
alter table public.employment_history drop constraint employment_history_company_check;
update public.employment_history set employment_kind = 'self_employed', company = null where company = 'Self-Employed';
alter table public.employment_history
  add constraint employment_history_company_required
    check (employment_kind = 'self_employed' or length(trim(coalesce(company, ''))) > 0);

-- ---------------------------------------------------------------------------
-- Preferences: catalog version + availability text snapshot
-- ---------------------------------------------------------------------------
alter table public.client_preferences
  add column catalog_version text,
  add column availability_snapshot text;

-- ---------------------------------------------------------------------------
-- Documents: integrity, quality and review states
-- ---------------------------------------------------------------------------
alter table public.documents drop constraint documents_status_check;
alter table public.documents
  add column sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add column quality jsonb,
  add column page_count integer,
  add column width integer,
  add column height integer,
  add column thumbnail_path text,
  add column review_note text,
  add constraint documents_status_check check (status in (
    'pending', 'processing', 'needs_reupload', 'needs_review', 'verified', 'rejected'
  )),
  add constraint documents_verified_reviewer check (status <> 'verified' or (reviewed_by is not null and reviewed_at is not null));
create index documents_status_idx on public.documents (status);

alter table public.document_access_log
  add column access_type text not null default 'view' check (access_type in ('view', 'download', 'thumbnail'));
alter table public.document_access_log rename column handled_by to staff_id;

create table public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete restrict,
  client_id uuid not null references public.clients (id) on delete restrict,
  provider text not null,
  model text,
  status text not null check (status in ('succeeded', 'schema_invalid', 'failed', 'not_configured')),
  escalated boolean not null default false,
  document_class text,
  fields jsonb not null default '[]'::jsonb,
  reconciliation jsonb not null default '[]'::jsonb,
  error text,
  trace_id text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index document_extractions_doc_idx on public.document_extractions (document_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Appointments: end time, timezone, resource, collision prevention
-- ---------------------------------------------------------------------------
alter table public.appointments rename column handled_by to created_by_staff;
alter table public.appointments
  add column ends_at timestamptz,
  add column timezone text not null default 'America/Detroit',
  add column resource_key text not null default 'office',
  add column assigned_staff uuid references public.staff (id),
  add column external_event_id text;
update public.appointments set ends_at = scheduled_at + interval '30 minutes' where ends_at is null;
alter table public.appointments
  alter column ends_at set not null,
  add constraint appointments_ends_after check (ends_at > scheduled_at),
  add constraint appointments_no_overlap exclude using gist (
    resource_key with =, tstzrange(scheduled_at, ends_at, '[)') with &&
  ) where (status in ('scheduled', 'confirmed', 'rescheduled'));

create table public.office_availability (
  id uuid primary key default gen_random_uuid(),
  resource_key text not null default 'office',
  staff_id uuid references public.staff (id),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_minutes integer not null default 30 check (slot_minutes between 5 and 480),
  appointment_type text,
  timezone text not null default 'America/Detroit',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);
create trigger office_availability_touch before update on public.office_availability
  for each row execute function public.touch_updated_at();

create table public.blocked_periods (
  id uuid primary key default gen_random_uuid(),
  resource_key text not null default 'office',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index blocked_periods_range_idx on public.blocked_periods using gist (resource_key, tstzrange(starts_at, ends_at));

-- ---------------------------------------------------------------------------
-- Tasks / notes / contacts / follow-ups: actor columns renamed for clarity
-- ---------------------------------------------------------------------------
alter table public.notes rename column handled_by to staff_id;
alter table public.contacts rename column handled_by to staff_id;
alter table public.followups rename column handled_by to created_by;
alter table public.post_hire_items rename column handled_by to staff_id;

-- Post-hire states per the office brief.
alter table public.post_hire_items drop constraint post_hire_items_status_check;
update public.post_hire_items set status = case status when 'in_progress' then 'pending' when 'not_applicable' then 'not_required' else status end;
alter table public.post_hire_items add constraint post_hire_items_status_check
  check (status in ('not_started', 'pending', 'confirmed', 'completed', 'not_required', 'blocked'));

-- ---------------------------------------------------------------------------
-- Assessments (records only what the client confirmed) + reference material
-- ---------------------------------------------------------------------------
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  assessment_type text not null check (length(trim(assessment_type)) > 0),
  item_key text not null check (length(trim(item_key)) > 0),
  prompt_reference text,
  confirmed_answer text,
  status text not null default 'unresolved'
    check (status in ('pending', 'in_progress', 'completed', 'unresolved', 'not_required')),
  source text check (source is null or source in ('client_confirmed', 'client_document', 'staff_observed')),
  notes text,
  updated_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, assessment_type, item_key),
  -- A completed item must carry the confirmed answer and where it came from.
  check (status <> 'completed' or (length(trim(coalesce(confirmed_answer, ''))) > 0 and source is not null))
);
create trigger assessments_touch before update on public.assessments
  for each row execute function public.touch_updated_at();

create table public.reference_materials (
  key text primary key,
  category text not null,
  title text not null,
  body text not null
);

insert into public.reference_materials (key, category, title, body) values
  ('support_agency_status', 'support', 'Support text — incorrect agency status',
   'I am no longer employed by Amazon or any third-party agency. My profile is incorrectly showing an active agency status and blocking my application. Please correct the employment status and remove the restriction so I can select the available shift.'),
  ('support_path', 'support', 'Support path', 'Active / Past Employment Support'),
  ('sound_check', 'assessment_reference', 'Sound-check reference',
   'This is my practice recording to check my microphone and sound. My voice is clear and the microphone is working properly.'),
  ('new_product', 'assessment_reference', 'New-product reference',
   'The team will receive a new product next week that requires a different packing method. We need to review the new packing instructions before our next shift.'),
  ('shift_change_rules', 'assessment_reference', 'Shift-change rules',
   E'Finish processing all items in your current work area.\nUpdate the status sheet with any work still in progress.\nTell the next worker about any problems.'),
  ('safety_reference', 'assessment_reference', 'Safety reference',
   E'Follow safety procedures.\nKeep the work area clear.\nUse equipment correctly.\nWear required protective gear.\nReport hazards immediately.\nCommunicate with coworkers.\nStop and ask for help if something is unsafe or unclear.');

-- ---------------------------------------------------------------------------
-- Activity log: trace ids and the full event vocabulary
-- ---------------------------------------------------------------------------
alter table public.activity_log rename column handled_by to staff_id;
alter table public.activity_log add column trace_id text;
alter table public.activity_log drop constraint activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check check (action in (
  'client_created', 'client_updated', 'client_deleted', 'preference_added', 'preference_removed',
  'status_changed', 'status_overridden', 'next_step_changed', 'staff_assigned',
  'document_uploaded', 'document_processing_started', 'document_processed', 'document_verified',
  'document_rejected', 'document_reupload_requested', 'document_opened',
  'appointment_created', 'appointment_updated', 'appointment_rescheduled', 'appointment_completed',
  'note_added', 'task_added', 'task_updated', 'task_completed',
  'contact_logged', 'followup_created', 'followup_completed',
  'assessment_updated', 'post_hire_updated', 'agent_alert_created', 'agent_run',
  'notification_queued', 'notification_sent', 'notification_failed', 'notification_not_configured',
  'status_otp_requested', 'status_otp_verified'
));

-- ---------------------------------------------------------------------------
-- Security events (denied actions, abuse, rate limiting)
-- ---------------------------------------------------------------------------
create table public.security_events (
  id bigint generated always as identity primary key,
  event text not null,
  staff_id uuid references public.staff (id),
  ip_hash text,
  route text,
  detail jsonb not null default '{}'::jsonb,
  trace_id text,
  created_at timestamptz not null default now()
);
create index security_events_created_idx on public.security_events (created_at desc);
create trigger security_events_append_only before update or delete on public.security_events
  for each row execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- Persistent fixed-window rate limiting
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  bucket text not null,
  key_hash text not null,
  window_start timestamptz not null,
  count integer not null,
  primary key (bucket, key_hash, window_start)
);

-- Counts one hit and reports whether it is within the limit. Atomic per row.
create or replace function public.rate_limit_hit(p_bucket text, p_key text, p_window_seconds integer, p_limit integer)
returns boolean
language plpgsql
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.rate_limits as r (bucket, key_hash, window_start, count)
  values (p_bucket, p_key, w, 1)
  on conflict (bucket, key_hash, window_start) do update set count = r.count + 1
  returning count into n;
  return n <= p_limit;
end;
$$;

create or replace function public.rate_limit_count(p_bucket text, p_key text, p_window_seconds integer)
returns integer language sql stable as $$
  select coalesce((select count from public.rate_limits
    where bucket = p_bucket and key_hash = p_key
      and window_start = to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)), 0);
$$;

-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------
create table public.idempotency_keys (
  key text not null check (length(key) between 8 and 200),
  operation text not null,
  request_fingerprint text not null,
  state text not null default 'completed' check (state in ('in_progress', 'completed')),
  response_body jsonb,
  status_code integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  primary key (operation, key)
);
create index idempotency_keys_expires_idx on public.idempotency_keys (expires_at);

-- ---------------------------------------------------------------------------
-- Public status access: OTP requests and sessions (hashes only)
-- ---------------------------------------------------------------------------
create table public.otp_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete cascade,
  contact_type text check (contact_type in ('email', 'sms', 'whatsapp')),
  contact_value_hash text,
  otp_hash text,
  delivery_status text not null check (delivery_status in ('sent', 'failed', 'not_configured', 'no_match')),
  attempts integer not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  locked_until timestamptz,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index otp_requests_contact_idx on public.otp_requests (contact_value_hash, created_at desc);

create table public.status_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_access timestamptz,
  revoked_at timestamptz,
  ip_hash text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Notifications (truthful delivery state)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'sms', 'email')),
  template text not null,
  payload jsonb not null default '{}'::jsonb,
  provider text,
  provider_id text,
  status text not null check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'not_configured')),
  error text,
  attempts integer not null default 0,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('sent', 'delivered') or provider_id is not null)
);
create index notifications_client_idx on public.notifications (client_id, created_at desc);
create unique index notifications_provider_id_key on public.notifications (provider, provider_id) where provider_id is not null;
create trigger notifications_touch before update on public.notifications
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Job queue (SKIP LOCKED consumer, visibility timeout, max attempts, dead state)
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in (
    'document_extraction', 'semantic_embedding', 'notification_send', 'audit_scan', 'intake_analysis'
  )),
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  trace_id text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'dead', 'not_configured')),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index jobs_ready_idx on public.jobs (status, run_after);

-- Claims ready jobs, including running jobs whose visibility timeout lapsed.
create or replace function public.claim_jobs(p_limit integer, p_visibility_seconds integer)
returns setof public.jobs
language sql
as $$
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         started_at = now(),
         locked_until = now() + make_interval(secs => p_visibility_seconds)
   where j.id in (
     select id from public.jobs
      where ((status = 'queued' and run_after <= now())
          or (status = 'running' and locked_until < now()))
      order by run_after
      limit p_limit
      for update skip locked
   )
  returning j.*;
$$;

-- ---------------------------------------------------------------------------
-- Audit alerts
-- ---------------------------------------------------------------------------
create table public.audit_alerts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  rule text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  evidence jsonb not null,
  evidence_hash text not null,
  recommended_action text not null,
  explanation text,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  resolved_by uuid references public.staff (id),
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (status = 'open' or (resolved_by is not null or resolution_note is not null)),
  check (status <> 'ignored' or length(trim(coalesce(resolution_note, ''))) > 0)
);
create unique index audit_alerts_one_open on public.audit_alerts (client_id, rule) where status = 'open';
create index audit_alerts_status_idx on public.audit_alerts (status, severity, created_at desc);

-- ---------------------------------------------------------------------------
-- Agent runs (inputs are hashed; outputs are validated JSON)
-- ---------------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null check (agent in ('intake', 'document', 'audit')),
  client_id uuid references public.clients (id) on delete cascade,
  input_hash text not null,
  output jsonb,
  provider text,
  model text,
  status text not null check (status in ('succeeded', 'failed', 'not_configured', 'schema_invalid')),
  error text,
  trace_id text,
  duration_ms integer,
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now()
);
create index agent_runs_client_idx on public.agent_runs (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Semantic index (pgvector, cosine HNSW)
-- ---------------------------------------------------------------------------
create table public.semantic_index (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  source_type text not null check (source_type in ('note', 'task', 'contact', 'followup')),
  source_id uuid not null,
  content_redacted text not null,
  embedding vector(1536) not null,
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id)
);
create index semantic_index_embedding_hnsw on public.semantic_index using hnsw (embedding vector_cosine_ops);
create index semantic_index_client_idx on public.semantic_index (client_id);

-- ---------------------------------------------------------------------------
-- RLS helpers (security definer so policies do not recurse)
-- ---------------------------------------------------------------------------
create or replace function public.cg_staff_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.staff where auth_user_id = auth.uid() and active;
$$;

create or replace function public.cg_staff_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.staff where auth_user_id = auth.uid() and active;
$$;

create or replace function public.cg_can_access_client(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c, public.staff s
    where c.id = cid and s.auth_user_id = auth.uid() and s.active
      and (
        s.role = 'admin'
        or (c.deleted_at is null and (s.role = 'manager' or c.assigned_staff = s.id))
      )
  );
$$;

revoke all on function public.cg_staff_id(), public.cg_staff_role(), public.cg_can_access_client(uuid) from public;
revoke all on function public.rate_limit_hit(text, text, integer, integer), public.rate_limit_count(text, text, integer),
  public.claim_jobs(integer, integer) from public;

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'staff', 'clients', 'client_authorizations', 'employment_history', 'client_preferences', 'documents',
    'document_access_log', 'document_extractions', 'appointments', 'office_availability', 'blocked_periods',
    'notes', 'tasks', 'contacts', 'followups', 'post_hire_items', 'assessments', 'reference_materials',
    'activity_log', 'security_events', 'rate_limits', 'idempotency_keys', 'otp_requests', 'status_sessions',
    'notifications', 'jobs', 'audit_alerts', 'agent_runs', 'semantic_index', 'status_transitions',
    'status_entry_states', 'client_ref_counters'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant execute on function public.cg_staff_id(), public.cg_staff_role(), public.cg_can_access_client(uuid),
  public.next_client_ref() to authenticated;

-- Staff directory: any active staff reads; admins write.
grant select, insert, update on public.staff to authenticated;
create policy staff_read on public.staff for select to authenticated using (public.cg_staff_id() is not null);
create policy staff_admin_insert on public.staff for insert to authenticated with check (public.cg_staff_role() = 'admin');
create policy staff_admin_update on public.staff for update to authenticated
  using (public.cg_staff_role() = 'admin') with check (public.cg_staff_role() = 'admin');

-- Clients: admin all; manager all live; staff only assigned live clients.
-- Evaluated on the row's own columns, so INSERT ... RETURNING can see the new row.
create or replace function public.cg_can_access_client_row(p_assigned uuid, p_deleted_at timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid() and s.active
      and (s.role = 'admin' or (p_deleted_at is null and (s.role = 'manager' or p_assigned = s.id)))
  );
$$;
revoke all on function public.cg_can_access_client_row(uuid, timestamptz) from public;
grant execute on function public.cg_can_access_client_row(uuid, timestamptz) to authenticated;

grant select, insert, update on public.clients to authenticated;
create policy clients_read on public.clients for select to authenticated
  using (public.cg_can_access_client_row(assigned_staff, deleted_at));
create policy clients_insert on public.clients for insert to authenticated
  with check (public.cg_staff_role() in ('admin', 'manager'));
create policy clients_update on public.clients for update to authenticated
  using (public.cg_can_access_client_row(assigned_staff, deleted_at))
  with check (public.cg_can_access_client_row(assigned_staff, deleted_at) or public.cg_staff_role() = 'admin');

-- Child tables scoped by client access.
do $$
declare t text;
begin
  foreach t in array array[
    'employment_history', 'client_preferences', 'documents', 'document_access_log', 'document_extractions',
    'appointments', 'notes', 'contacts', 'followups', 'post_hire_items', 'assessments', 'activity_log',
    'notifications', 'semantic_index', 'agent_runs'
  ] loop
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.cg_can_access_client(client_id)) with check (public.cg_can_access_client(client_id))',
      t || '_client_scope', t);
  end loop;
end $$;
grant delete on public.employment_history, public.client_preferences to authenticated;
grant select on public.client_authorizations to authenticated;
create policy client_authorizations_read on public.client_authorizations for select to authenticated
  using (public.cg_can_access_client(client_id));

-- Tasks: client tasks by client access; office tasks (no client) for all staff.
grant select, insert, update on public.tasks to authenticated;
create policy tasks_scope on public.tasks for all to authenticated
  using ((client_id is null and public.cg_staff_id() is not null) or public.cg_can_access_client(client_id))
  with check ((client_id is null and public.cg_staff_id() is not null) or public.cg_can_access_client(client_id));

-- Audit alerts: admin and manager.
grant select, update on public.audit_alerts to authenticated;
create policy audit_alerts_scope on public.audit_alerts for all to authenticated
  using (public.cg_staff_role() in ('admin', 'manager') and public.cg_can_access_client(client_id))
  with check (public.cg_staff_role() in ('admin', 'manager') and public.cg_can_access_client(client_id));

-- Scheduling configuration: all staff read; admin and manager write.
grant select, insert, update, delete on public.office_availability, public.blocked_periods to authenticated;
create policy office_availability_read on public.office_availability for select to authenticated using (public.cg_staff_id() is not null);
create policy office_availability_write on public.office_availability for all to authenticated
  using (public.cg_staff_role() in ('admin', 'manager')) with check (public.cg_staff_role() in ('admin', 'manager'));
create policy blocked_periods_read on public.blocked_periods for select to authenticated using (public.cg_staff_id() is not null);
create policy blocked_periods_write on public.blocked_periods for all to authenticated
  using (public.cg_staff_role() in ('admin', 'manager')) with check (public.cg_staff_role() in ('admin', 'manager'));

-- Read-only reference data for staff.
grant select on public.reference_materials, public.status_transitions, public.status_entry_states to authenticated;
create policy reference_materials_read on public.reference_materials for select to authenticated using (public.cg_staff_id() is not null);
create policy status_transitions_read on public.status_transitions for select to authenticated using (public.cg_staff_id() is not null);
create policy status_entry_states_read on public.status_entry_states for select to authenticated using (public.cg_staff_id() is not null);

-- security_events, rate_limits, idempotency_keys, otp_requests, status_sessions,
-- jobs and client_ref_counters have no policies: server-only.

-- ---------------------------------------------------------------------------
-- Realtime for staff pages (RLS applies to postgres_changes subscribers)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.clients, public.appointments, public.tasks, public.followups, public.notes,
      public.documents, public.audit_alerts;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Busy intervals for scheduling (times only, no client data), usable under RLS
-- ---------------------------------------------------------------------------
create or replace function public.cg_busy_intervals(p_resource text, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select scheduled_at, ends_at from public.appointments
   where resource_key = p_resource and status in ('scheduled', 'confirmed', 'rescheduled')
     and ends_at > p_from and scheduled_at < p_to
  union all
  select starts_at, ends_at from public.blocked_periods
   where resource_key = p_resource and ends_at > p_from and starts_at < p_to;
$$;
revoke all on function public.cg_busy_intervals(text, timestamptz, timestamptz) from public;
grant execute on function public.cg_busy_intervals(text, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Short-lived upload grants for applicant documents (hash only)
-- ---------------------------------------------------------------------------
create table public.upload_grants (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.upload_grants enable row level security;
revoke all on public.upload_grants from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Job enqueue for staff transactions. jobs stays server-only; this function
-- accepts only the known job types and cannot read or change existing jobs.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_job(
  p_type text, p_entity_id text, p_payload jsonb, p_dedupe_key text, p_trace_id text, p_max_attempts integer, p_run_after timestamptz
) returns void
language sql security definer set search_path = public as $$
  insert into public.jobs (type, entity_id, payload, dedupe_key, trace_id, max_attempts, run_after)
  values (p_type, p_entity_id, coalesce(p_payload, '{}'::jsonb), p_dedupe_key, p_trace_id, p_max_attempts, coalesce(p_run_after, now()))
  on conflict (dedupe_key) do nothing;
$$;
revoke all on function public.enqueue_job(text, text, jsonb, text, text, integer, timestamptz) from public;
grant execute on function public.enqueue_job(text, text, jsonb, text, text, integer, timestamptz) to authenticated;
