-- Core operational domain consolidation.
-- Existing client/status tables remain canonical. This migration adds missing
-- first-class requirements/readiness state and operational-state invariants
-- without inventing deadlines or duplicating client/workflow identity.

begin;

-- Canonical metadata for statuses. Transition authority remains the existing
-- status_transitions table; entry authority remains status_entry_states.
create table if not exists public.workflow_status_rules (
  status text primary key,
  label_en text not null,
  default_next_action text not null check (length(trim(default_next_action)) > 0),
  sequence smallint not null unique,
  terminal boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.workflow_status_rules(status,label_en,default_next_action,sequence,terminal) values
  ('new_intake','New Intake','Office will review your application.',10,false),
  ('needs_review','Needs Review','Office will review your information and documents.',20,false),
  ('ready_to_apply','Ready to Apply','Office will submit your application.',30,false),
  ('application_in_progress','Application in Progress','Your application is being submitted.',40,false),
  ('assessment_required','Assessment Required','Complete the employer assessment.',50,false),
  ('shift_selected','Shift Selected','Wait for pre-hire appointment details.',60,false),
  ('appointment_required','Appointment Required','Office will schedule your appointment.',70,false),
  ('appointment_scheduled','Appointment Scheduled','Attend your scheduled appointment.',80,false),
  ('pre_hire_completed','Pre-Hire Completed','Wait for screening results.',90,false),
  ('screening_pending','Screening Pending','Wait for screening results.',100,false),
  ('i9_available','I-9 Available','Complete your I-9 documents.',110,false),
  ('post_hire_tasks','Post-Hire Tasks','Complete remaining post-hire tasks.',120,false),
  ('ready_for_first_day','Ready for First Day','Report for your first day.',130,false),
  ('completed','Completed','No further action needed.',140,true),
  ('cancelled','Cancelled','No further action needed.',150,true)
on conflict(status) do update set
  label_en=excluded.label_en,
  default_next_action=excluded.default_next_action,
  sequence=excluded.sequence,
  terminal=excluded.terminal,
  active=true,
  updated_at=now();

alter table public.workflow_status_rules enable row level security;
drop policy if exists workflow_status_rules_staff_read on public.workflow_status_rules;
create policy workflow_status_rules_staff_read on public.workflow_status_rules
  for select to authenticated using (public.cg_staff_id() is not null);
grant select on public.workflow_status_rules to authenticated;
revoke insert,update,delete on public.workflow_status_rules from authenticated;

-- First-class requirements. Existing documents/tasks/post-hire records remain
-- their own facts and may be referenced; requirements describe what must be
-- satisfied and are the single readiness input.
create table if not exists public.client_requirements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requirement_key text not null check (length(trim(requirement_key)) > 0),
  stage text,
  title text not null check (length(trim(title)) > 0),
  reason text,
  source text not null check (source in ('workflow','document','task','post_hire','staff','system')),
  completion_rule jsonb not null default '{}'::jsonb,
  status text not null default 'missing' check (status in ('complete','missing','pending_review','rejected','expired','not_applicable')),
  related_document_id uuid references public.documents(id) on delete set null,
  related_task_id uuid references public.tasks(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id, requirement_key),
  check ((status='complete') = (completed_at is not null) or status <> 'complete')
);

create index if not exists client_requirements_client_status_idx
  on public.client_requirements(client_id,status,due_at);
create index if not exists client_requirements_document_idx
  on public.client_requirements(related_document_id) where related_document_id is not null;
create index if not exists client_requirements_task_idx
  on public.client_requirements(related_task_id) where related_task_id is not null;

alter table public.client_requirements enable row level security;
drop policy if exists client_requirements_staff_read on public.client_requirements;
drop policy if exists client_requirements_staff_insert on public.client_requirements;
drop policy if exists client_requirements_staff_update on public.client_requirements;
create policy client_requirements_staff_read on public.client_requirements
  for select to authenticated using (public.cg_can_access_client(client_id));
create policy client_requirements_staff_insert on public.client_requirements
  for insert to authenticated with check (public.cg_can_access_client(client_id));
create policy client_requirements_staff_update on public.client_requirements
  for update to authenticated using (public.cg_can_access_client(client_id))
  with check (public.cg_can_access_client(client_id));
grant select,insert,update on public.client_requirements to authenticated;
revoke delete on public.client_requirements from authenticated;

-- Deterministic backfill from confirmed existing post-hire operational facts.
insert into public.client_requirements(
  client_id,requirement_key,stage,title,source,completion_rule,status,completed_at,completed_by,updated_at
)
select
  p.client_id,
  'post_hire:' || p.item,
  'post_interview_completion',
  initcap(replace(p.item,'_',' ')),
  'post_hire',
  jsonb_build_object('source_table','post_hire_items','source_item',p.item),
  case p.status
    when 'confirmed' then 'complete'
    when 'completed' then 'complete'
    when 'not_required' then 'not_applicable'
    when 'pending' then 'pending_review'
    else 'missing'
  end,
  case when p.status in ('confirmed','completed') then p.updated_at else null end,
  case when p.status in ('confirmed','completed') then p.staff_id else null end,
  p.updated_at
from public.post_hire_items p
on conflict(client_id,requirement_key) do nothing;

create or replace view public.client_readiness
with (security_invoker = true)
as
select
  c.id as client_id,
  count(r.id) filter(where r.status <> 'not_applicable')::int as required_count,
  count(r.id) filter(where r.status = 'complete')::int as complete_count,
  count(r.id) filter(where r.status in ('missing','rejected','expired'))::int as missing_count,
  count(r.id) filter(where r.status = 'pending_review')::int as pending_review_count,
  case
    when count(r.id) filter(where r.status <> 'not_applicable') = 0 then null
    else round(
      100.0 * count(r.id) filter(where r.status='complete') /
      nullif(count(r.id) filter(where r.status <> 'not_applicable'),0),
      0
    )::int
  end as readiness_percent
from public.clients c
left join public.client_requirements r on r.client_id=c.id
where c.deleted_at is null
group by c.id;

revoke all on public.client_readiness from public,anon;
grant select on public.client_readiness to authenticated;

-- Explicit operational state. No invented SLA: when no real due date is known,
-- the record carries an explicit waiting condition instead.
alter table public.clients
  add column if not exists next_action_due_at timestamptz,
  add column if not exists waiting_condition text;

update public.clients c
set next_action_due_at = coalesce(
      c.next_action_due_at,
      (select min(t.due_at) from public.tasks t
        where t.client_id=c.id and t.status in ('pending','in_progress') and t.due_at is not null),
      (select min(a.scheduled_at) from public.appointments a
        where a.client_id=c.id and a.status in ('scheduled','confirmed','rescheduled') and a.scheduled_at >= now())
    )
where c.deleted_at is null and c.current_status not in ('completed','cancelled');

update public.clients
set waiting_condition = case
  when assigned_staff is null then 'Awaiting staff assignment'
  when next_action_due_at is null then 'Awaiting next-action deadline'
  else null
end
where deleted_at is null and current_status not in ('completed','cancelled');

update public.clients
set next_action_due_at=null, waiting_condition=null
where current_status in ('completed','cancelled');

create or replace function public.normalize_client_operational_state()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.current_status in ('completed','cancelled') then
    new.next_action_due_at := null;
    new.waiting_condition := null;
    return new;
  end if;

  if new.assigned_staff is null then
    new.next_action_due_at := null;
    if nullif(trim(coalesce(new.waiting_condition,'')),'') is null
       or new.waiting_condition = 'Awaiting next-action deadline' then
      new.waiting_condition := 'Awaiting staff assignment';
    end if;
    return new;
  end if;

  if new.next_action_due_at is not null then
    new.waiting_condition := null;
  elsif nullif(trim(coalesce(new.waiting_condition,'')),'') is null
        or new.waiting_condition = 'Awaiting staff assignment' then
    new.waiting_condition := 'Awaiting next-action deadline';
  end if;
  return new;
end;
$$;

drop trigger if exists clients_operational_state on public.clients;
create trigger clients_operational_state
before insert or update of current_status,assigned_staff,next_action_due_at,waiting_condition
on public.clients
for each row execute function public.normalize_client_operational_state();

alter table public.clients drop constraint if exists clients_active_operational_state_check;
alter table public.clients add constraint clients_active_operational_state_check check (
  deleted_at is not null
  or current_status in ('completed','cancelled')
  or (
    length(trim(next_step)) > 0
    and (
      (assigned_staff is not null and next_action_due_at is not null)
      or nullif(trim(coalesce(waiting_condition,'')),'') is not null
    )
  )
);

create index if not exists clients_next_action_due_idx
  on public.clients(next_action_due_at)
  where deleted_at is null and current_status not in ('completed','cancelled');

commit;
