-- Career Gate HTML compatibility layer.
-- Preserves the existing operational clients model while storing one immutable
-- submitted application snapshot and authoritative ALH case number per intake.

create table if not exists public.career_gate_applications (
  id uuid primary key default gen_random_uuid(),
  submission_uid text not null unique check (length(trim(submission_uid)) >= 8),
  case_number text not null unique check (case_number ~ '^ALH-[0-9]{8}-[A-Z0-9]{4}$'),
  client_id uuid not null references public.clients(id) on delete restrict,
  service text not null,
  status text not null default 'new_intake' check (status in (
    'new_intake', 'needs_review', 'ready_to_apply', 'application_in_progress',
    'assessment_required', 'shift_selected', 'appointment_required',
    'appointment_scheduled', 'pre_hire_completed', 'screening_pending',
    'i9_available', 'post_hire_tasks', 'ready_for_first_day', 'completed', 'cancelled'
  )),
  next_step text not null,
  assigned_staff_id uuid references public.staff(id),
  branch text,
  branch_name text,
  branch_address text,
  work_type text,
  shift text,
  shift_code text,
  shift_days text,
  shift_hours text,
  expected_pay text,
  start_date date,
  intake_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists career_gate_applications_client_idx on public.career_gate_applications(client_id, created_at desc);
create index if not exists career_gate_applications_status_idx on public.career_gate_applications(status, updated_at desc);

drop trigger if exists career_gate_applications_touch on public.career_gate_applications;
create trigger career_gate_applications_touch
before update on public.career_gate_applications
for each row execute function public.touch_updated_at();

alter table public.career_gate_applications enable row level security;
revoke all on public.career_gate_applications from anon;
revoke all on public.career_gate_applications from authenticated;
