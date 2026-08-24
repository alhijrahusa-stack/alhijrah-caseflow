begin;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_label text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_users (
  auth_user_id uuid primary key,
  display_name text,
  email text not null,
  status text not null default 'active' check (status in ('invited','active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  code text primary key,
  name text not null unique,
  is_system boolean not null default true
);

create table if not exists public.permissions (
  code text primary key,
  description text not null
);

create table if not exists public.role_permissions (
  role_code text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

create table if not exists public.user_roles (
  auth_user_id uuid not null references public.app_users(auth_user_id) on delete cascade,
  role_code text not null references public.roles(code) on delete restrict,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  primary key (auth_user_id, role_code)
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  alternate_names text[] not null default '{}',
  date_of_birth date,
  place_of_birth text,
  nationality text,
  current_country text,
  phone text,
  whatsapp text,
  email text,
  physical_address text,
  mailing_address text,
  postal_code text,
  immigration_status text,
  a_number text,
  uscis_account_number text,
  passport_number text,
  passport_country text,
  passport_expiration date,
  preferred_language text not null default 'English',
  operational_notes text,
  archived_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  alternate_names text[] not null default '{}',
  date_of_birth date,
  place_of_birth text,
  nationality text,
  a_number text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_people (
  client_id uuid not null references public.clients(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  relationship text not null check (relationship in (
    'petitioner','beneficiary','principal_applicant','spouse','child','parent',
    'sibling','derivative_beneficiary','joint_sponsor','household_member'
  )),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (client_id, person_id, relationship)
);

create table if not exists public.service_catalog (
  code text primary key,
  category text not null check (category in ('family_uscis','consular_dos','humanitarian_complex','administrative')),
  name text not null,
  active boolean not null default true,
  default_workflow jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cases add column if not exists client_id uuid references public.clients(id) on delete restrict;
alter table public.cases add column if not exists service_code text references public.service_catalog(code) on delete restrict;
alter table public.cases add column if not exists case_reference text;
alter table public.cases add column if not exists workflow_stage text not null default 'intake';
alter table public.cases add column if not exists review_state text not null default 'prepared';
alter table public.cases add column if not exists agency text;
alter table public.cases add column if not exists filing_type text;
alter table public.cases add column if not exists jurisdiction text;
alter table public.cases add column if not exists receipt_number text;
alter table public.cases add column if not exists archived_at timestamptz;
alter table public.cases add column if not exists created_by uuid;
alter table public.cases add column if not exists updated_by uuid;

create unique index if not exists cases_reference_unique_idx on public.cases(case_reference) where case_reference is not null;
create index if not exists cases_client_idx on public.cases(client_id, created_at desc);
create index if not exists cases_service_idx on public.cases(service_code, workflow_stage);

create table if not exists public.case_people (
  case_id uuid not null references public.cases(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  case_role text not null,
  created_at timestamptz not null default now(),
  primary key (case_id, person_id, case_role)
);

-- Translators, preparers, interpreters and representatives are form roles, not case parties.
create table if not exists public.form_role_assignments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  form_code text not null,
  role_code text not null check (role_code in ('interpreter','preparer','translator','attorney','accredited_representative')),
  staff_user_id uuid,
  external_name text,
  organization text,
  created_at timestamptz not null default now(),
  check (staff_user_id is not null or external_name is not null)
);

create table if not exists public.client_access (
  client_id uuid not null references public.clients(id) on delete cascade,
  auth_user_id uuid not null,
  access_role text not null check (access_role in ('owner','collaborator')),
  status text not null default 'active' check (status in ('invited','active','revoked')),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (client_id, auth_user_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  case_id uuid references public.cases(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  assigned_user_id uuid,
  due_date date,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','blocked','completed','cancelled')),
  completed_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (case_id is not null or client_id is not null)
);

create table if not exists public.deadlines (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  case_id uuid not null references public.cases(id) on delete cascade,
  deadline_date date not null,
  deadline_type text not null,
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  source text,
  notes text,
  completed_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.intake_definitions (
  id uuid primary key default gen_random_uuid(),
  service_code text not null references public.service_catalog(code) on delete cascade,
  version integer not null check (version > 0),
  definition jsonb not null,
  active boolean not null default false,
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (service_code, version)
);

create unique index if not exists intake_one_active_version_idx on public.intake_definitions(service_code) where active;

create table if not exists public.intake_submissions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  definition_id uuid not null references public.intake_definitions(id) on delete restrict,
  answers jsonb not null default '{}'::jsonb,
  current_step integer not null default 0 check (current_step >= 0),
  status text not null default 'draft' check (status in ('draft','submitted','reopened')),
  submitted_at timestamptz,
  last_saved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, definition_id)
);

create table if not exists public.document_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  category text not null,
  title text not null,
  instructions text,
  required boolean not null default true,
  due_date date,
  status text not null default 'missing' check (status in ('missing','received','approved','rejected','waived')),
  reviewer_notes text,
  requested_by uuid,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  body text not null,
  visibility text not null default 'internal' check (visibility in ('internal','client')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.case_messages (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  sender_user_id uuid,
  sender_type text not null check (sender_type in ('staff','client','system')),
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  appointment_type text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled','no_show')),
  client_visible boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  client_id uuid not null references public.clients(id) on delete restrict,
  case_id uuid references public.cases(id) on delete set null,
  currency char(3) not null default 'USD',
  status text not null default 'draft' check (status in ('draft','issued','partially_paid','paid','void','overdue')),
  office_fee_cents bigint not null default 0 check (office_fee_cents >= 0),
  government_fee_cents bigint not null default 0 check (government_fee_cents >= 0),
  other_fee_cents bigint not null default 0 check (other_fee_cents >= 0),
  due_date date,
  issued_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'USD',
  method text not null,
  external_reference text,
  status text not null default 'recorded' check (status in ('pending','recorded','failed','refunded')),
  received_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  case_id uuid references public.cases(id) on delete cascade,
  alert_type text not null,
  severity text not null default 'normal' check (severity in ('normal','high','critical')),
  title text not null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','acknowledged','resolved','dismissed')),
  source_type text,
  source_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (client_id is not null or case_id is not null)
);

alter table public.documents add column if not exists client_id uuid references public.clients(id) on delete cascade;
alter table public.documents add column if not exists person_id uuid references public.people(id) on delete set null;
alter table public.documents add column if not exists request_id uuid references public.document_requests(id) on delete set null;
alter table public.documents add column if not exists category text;
alter table public.documents add column if not exists review_status text not null default 'received';
alter table public.documents add column if not exists reviewer_notes text;
alter table public.documents add column if not exists reviewed_by uuid;
alter table public.documents add column if not exists reviewed_at timestamptz;
alter table public.documents add column if not exists expires_on date;
alter table public.documents add column if not exists version integer not null default 1;
alter table public.documents add column if not exists replaces_document_id uuid references public.documents(id) on delete set null;
alter table public.documents add column if not exists archived_at timestamptz;

alter table public.audit_events add column if not exists actor_roles text[] not null default '{}';
alter table public.audit_events add column if not exists client_id uuid;
alter table public.audit_events add column if not exists case_id uuid;

create index if not exists clients_name_idx on public.clients(lower(legal_name)) where archived_at is null;
create index if not exists clients_email_idx on public.clients(lower(email)) where archived_at is null;
create index if not exists clients_a_number_idx on public.clients(a_number) where a_number is not null and archived_at is null;
create index if not exists client_people_client_idx on public.client_people(client_id);
create index if not exists tasks_assignee_status_idx on public.tasks(assigned_user_id, status, due_date) where archived_at is null;
create index if not exists tasks_case_idx on public.tasks(case_id, status);
create index if not exists deadlines_case_date_idx on public.deadlines(case_id, deadline_date) where status = 'open';
create index if not exists intake_case_idx on public.intake_submissions(case_id, status);
create index if not exists document_requests_case_idx on public.document_requests(case_id, status);
create index if not exists documents_client_idx on public.documents(client_id, created_at desc);
create index if not exists client_access_user_idx on public.client_access(auth_user_id, status);
create index if not exists form_roles_case_idx on public.form_role_assignments(case_id, form_code);
create index if not exists case_notes_case_idx on public.case_notes(case_id, created_at desc);
create index if not exists case_messages_case_idx on public.case_messages(case_id, created_at);
create index if not exists appointments_client_idx on public.appointments(client_id, starts_at);
create index if not exists invoices_client_idx on public.invoices(client_id, created_at desc);
create index if not exists alerts_open_idx on public.alerts(status, due_at) where status = 'open';

alter table public.app_users enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.clients enable row level security;
alter table public.people enable row level security;
alter table public.client_people enable row level security;
alter table public.service_catalog enable row level security;
alter table public.case_people enable row level security;
alter table public.form_role_assignments enable row level security;
alter table public.client_access enable row level security;
alter table public.tasks enable row level security;
alter table public.deadlines enable row level security;
alter table public.intake_definitions enable row level security;
alter table public.intake_submissions enable row level security;
alter table public.document_requests enable row level security;
alter table public.case_notes enable row level security;
alter table public.case_messages enable row level security;
alter table public.appointments enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.alerts enable row level security;

revoke all on public.app_users, public.roles, public.permissions, public.role_permissions, public.user_roles,
  public.clients, public.people, public.client_people, public.service_catalog, public.case_people,
  public.form_role_assignments, public.client_access, public.tasks, public.deadlines,
  public.intake_definitions, public.intake_submissions, public.document_requests, public.case_notes,
  public.case_messages, public.appointments, public.invoices, public.payments, public.alerts
from anon, authenticated;

insert into public.roles (code, name) values
  ('owner','Owner'), ('admin','Admin'), ('supervisor','Supervisor'), ('case_manager','Case Manager'),
  ('form_preparer','Form Preparer'), ('document_reviewer','Document Reviewer'), ('translator','Translator'),
  ('attorney_accredited_representative','Attorney / Accredited Representative'), ('billing','Billing'),
  ('auditor','Auditor'), ('client_owner','Client Owner'), ('client_collaborator','Client Collaborator')
on conflict (code) do update set name = excluded.name;

insert into public.permissions (code, description) values
  ('dashboard.view','View operational dashboard'),
  ('users.view','View team users'),
  ('users.manage','Invite, update and deactivate users'),
  ('clients.view','View client records'),
  ('clients.manage','Create, update, archive and restore client records'),
  ('cases.view','View case records'),
  ('cases.manage','Create, update, assign and archive cases'),
  ('cases.prepare','Prepare structured forms and intake records'),
  ('documents.view','View and download authorized documents'),
  ('documents.manage','Upload, replace, rename and archive documents'),
  ('documents.review','Approve or reject documents'),
  ('documents.translate','Access translation workflow'),
  ('tasks.view','View authorized tasks and deadlines'),
  ('tasks.manage','Create, assign, update and complete tasks and deadlines'),
  ('workflows.manage','Transition case workflow stages'),
  ('billing.view','View authorized billing records'),
  ('billing.manage','Create and update billing records'),
  ('audit.view','View audit activity'),
  ('reports.view','View operational reports'),
  ('settings.manage','Manage workspace settings'),
  ('portal.view','Access authorized client portal records'),
  ('portal.intake','Complete client intake'),
  ('portal.documents','Upload and view authorized client documents'),
  ('portal.messages','Use authorized case messages')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions (role_code, permission_code)
select 'owner', code from public.permissions
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('admin','dashboard.view'),('admin','users.view'),('admin','users.manage'),('admin','clients.view'),('admin','clients.manage'),('admin','cases.view'),('admin','cases.manage'),('admin','documents.view'),('admin','documents.manage'),('admin','documents.review'),('admin','tasks.view'),('admin','tasks.manage'),('admin','workflows.manage'),('admin','billing.view'),('admin','billing.manage'),('admin','audit.view'),('admin','reports.view'),('admin','settings.manage'),
  ('supervisor','dashboard.view'),('supervisor','users.view'),('supervisor','clients.view'),('supervisor','clients.manage'),('supervisor','cases.view'),('supervisor','cases.manage'),('supervisor','documents.view'),('supervisor','documents.manage'),('supervisor','documents.review'),('supervisor','tasks.view'),('supervisor','tasks.manage'),('supervisor','workflows.manage'),('supervisor','audit.view'),('supervisor','reports.view'),
  ('case_manager','dashboard.view'),('case_manager','clients.view'),('case_manager','clients.manage'),('case_manager','cases.view'),('case_manager','cases.manage'),('case_manager','documents.view'),('case_manager','documents.manage'),('case_manager','tasks.view'),('case_manager','tasks.manage'),('case_manager','workflows.manage'),
  ('form_preparer','dashboard.view'),('form_preparer','clients.view'),('form_preparer','cases.view'),('form_preparer','cases.prepare'),('form_preparer','documents.view'),('form_preparer','documents.manage'),('form_preparer','tasks.view'),('form_preparer','tasks.manage'),
  ('document_reviewer','dashboard.view'),('document_reviewer','clients.view'),('document_reviewer','cases.view'),('document_reviewer','documents.view'),('document_reviewer','documents.review'),('document_reviewer','tasks.view'),('document_reviewer','tasks.manage'),
  ('translator','dashboard.view'),('translator','clients.view'),('translator','cases.view'),('translator','documents.view'),('translator','documents.translate'),('translator','tasks.view'),('translator','tasks.manage'),
  ('attorney_accredited_representative','dashboard.view'),('attorney_accredited_representative','clients.view'),('attorney_accredited_representative','clients.manage'),('attorney_accredited_representative','cases.view'),('attorney_accredited_representative','cases.manage'),('attorney_accredited_representative','documents.view'),('attorney_accredited_representative','documents.manage'),('attorney_accredited_representative','documents.review'),('attorney_accredited_representative','tasks.view'),('attorney_accredited_representative','tasks.manage'),('attorney_accredited_representative','workflows.manage'),('attorney_accredited_representative','audit.view'),
  ('billing','dashboard.view'),('billing','clients.view'),('billing','cases.view'),('billing','billing.view'),('billing','billing.manage'),
  ('auditor','dashboard.view'),('auditor','clients.view'),('auditor','cases.view'),('auditor','documents.view'),('auditor','tasks.view'),('auditor','billing.view'),('auditor','audit.view'),('auditor','reports.view'),
  ('client_owner','portal.view'),('client_owner','portal.intake'),('client_owner','portal.documents'),('client_owner','portal.messages'),
  ('client_collaborator','portal.view'),('client_collaborator','portal.documents'),('client_collaborator','portal.messages')
on conflict do nothing;

insert into public.service_catalog (category, code, name) values
  ('family_uscis','I-130','Petition for Alien Relative'),
  ('family_uscis','I-485','Adjustment of Status'),
  ('family_uscis','I-864','Affidavit of Support'),
  ('family_uscis','I-864A','Household Member Contract'),
  ('family_uscis','I-765','Employment Authorization'),
  ('family_uscis','I-131','Travel Document'),
  ('family_uscis','I-751','Remove Conditions on Residence'),
  ('family_uscis','N-400','Naturalization'),
  ('family_uscis','I-90','Replace Permanent Resident Card'),
  ('consular_dos','DS-260','Immigrant Visa Application'),
  ('consular_dos','NVC','National Visa Center Processing'),
  ('consular_dos','CONSULAR','Consular Processing'),
  ('consular_dos','K-1','Fiancé Visa'),
  ('humanitarian_complex','ASYLUM','Asylum'),
  ('humanitarian_complex','EOIR','Immigration Court'),
  ('humanitarian_complex','REMOVAL','Removal Defense Intake'),
  ('humanitarian_complex','DETENTION','Immigration Detention'),
  ('humanitarian_complex','BIA-APPEAL','BIA Appeal'),
  ('humanitarian_complex','MTR','Motion to Reopen'),
  ('humanitarian_complex','MTC','Motion to Reconsider'),
  ('humanitarian_complex','I-601','Waiver of Inadmissibility'),
  ('humanitarian_complex','I-601A','Provisional Unlawful Presence Waiver'),
  ('humanitarian_complex','VAWA','VAWA Self-Petition'),
  ('humanitarian_complex','U-VISA','U Nonimmigrant Status'),
  ('humanitarian_complex','T-VISA','T Nonimmigrant Status'),
  ('humanitarian_complex','SIJS','Special Immigrant Juvenile Status'),
  ('humanitarian_complex','TPS','Temporary Protected Status'),
  ('administrative','PASSPORT','Passport Renewal'),
  ('administrative','TRANSLATION','Document Translation'),
  ('administrative','NOTARY','Notary Service'),
  ('administrative','POA','Power of Attorney'),
  ('administrative','FLIGHT','Flight Booking')
on conflict (code) do update set category = excluded.category, name = excluded.name;

commit;
