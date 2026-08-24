create extension if not exists pgcrypto;

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  case_type text not null,
  status text not null default 'intake',
  priority text not null default 'normal',
  assigned_to text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases(id) on delete cascade,
  object_key text not null unique,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  status text not null default 'uploaded',
  created_at timestamptz not null default now()
);

create table if not exists public.case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  event_type text not null,
  actor text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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

create index if not exists cases_created_at_idx on public.cases(created_at desc);
create index if not exists cases_status_idx on public.cases(status);
create index if not exists documents_case_id_idx on public.documents(case_id);
create index if not exists case_events_case_id_idx on public.case_events(case_id, created_at desc);
create index if not exists audit_events_created_at_idx on public.audit_events(created_at desc);
create index if not exists audit_events_actor_idx on public.audit_events(actor_user_id, created_at desc);
create index if not exists audit_events_entity_idx on public.audit_events(entity_type, entity_id, created_at desc);

alter table public.cases enable row level security;
alter table public.documents enable row level security;
alter table public.case_events enable row level security;
alter table public.audit_events enable row level security;

revoke all on public.cases from anon, authenticated;
revoke all on public.documents from anon, authenticated;
revoke all on public.case_events from anon, authenticated;
revoke all on public.audit_events from anon, authenticated;
