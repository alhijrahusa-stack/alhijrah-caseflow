-- Canonical authorization policy data. Seed exactly the permissions enforced by
-- the existing application so migration changes ownership, not behavior.

begin;

create table if not exists public.permission_rules (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('admin','manager','staff')),
  resource text not null check (length(trim(resource)) > 0),
  action text not null check (length(trim(action)) > 0),
  scope text not null check (scope in ('ALL','ASSIGNED','NONE')),
  updated_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  unique(role,resource,action)
);

-- Admin: all current actions.
with actions(resource,action) as (values
 ('client','create_client'),('client','update_client'),('client','patch_client'),('client','update_status'),('client','override_status'),('client','set_next_step'),('client','assign_staff'),('client','soft_delete_client'),
 ('preference','add_preference'),('preference','remove_preference'),
 ('appointment','schedule_appointment'),('appointment','book_slot'),('appointment','update_appointment'),
 ('note','add_note'),('task','add_task'),('task','update_task'),('task','complete_task'),
 ('contact','mark_contacted'),('followup','add_followup'),('followup','complete_followup'),
 ('document','verify_document'),('document','reject_document'),('document','request_reupload'),('document','process_document'),('document','upload_document'),('document','view_document'),
 ('assessment','update_assessment'),('assessment','add_standard_assessments'),('post_hire','update_post_hire'),
 ('ai','run_intake_agent'),('communication','send_notification'),
 ('staff','create_staff'),('staff','update_staff_role'),('staff','disable_staff'),('staff','reactivate_staff'),('staff','invite_staff'),
 ('availability','upsert_availability'),('availability','delete_availability'),('availability','add_blocked_period'),('availability','remove_blocked_period'),
 ('audit','resolve_alert'),('audit','ignore_alert'),('audit','run_audit_scan')
)
insert into public.permission_rules(role,resource,action,scope)
select 'admin',resource,action,'ALL' from actions
on conflict(role,resource,action) do nothing;

-- Manager: current MGMT + ALL-role actions; override/delete/staff-admin stay NONE.
with actions(resource,action,scope) as (values
 ('client','create_client','ALL'),('client','update_client','ALL'),('client','patch_client','ALL'),('client','update_status','ALL'),('client','override_status','NONE'),('client','set_next_step','ALL'),('client','assign_staff','ALL'),('client','soft_delete_client','NONE'),
 ('preference','add_preference','ALL'),('preference','remove_preference','ALL'),
 ('appointment','schedule_appointment','ALL'),('appointment','book_slot','ALL'),('appointment','update_appointment','ALL'),
 ('note','add_note','ALL'),('task','add_task','ALL'),('task','update_task','ALL'),('task','complete_task','ALL'),
 ('contact','mark_contacted','ALL'),('followup','add_followup','ALL'),('followup','complete_followup','ALL'),
 ('document','verify_document','ALL'),('document','reject_document','ALL'),('document','request_reupload','ALL'),('document','process_document','ALL'),('document','upload_document','ALL'),('document','view_document','ALL'),
 ('assessment','update_assessment','ALL'),('assessment','add_standard_assessments','ALL'),('post_hire','update_post_hire','ALL'),
 ('ai','run_intake_agent','ALL'),('communication','send_notification','ALL'),
 ('staff','create_staff','NONE'),('staff','update_staff_role','NONE'),('staff','disable_staff','NONE'),('staff','reactivate_staff','NONE'),('staff','invite_staff','NONE'),
 ('availability','upsert_availability','ALL'),('availability','delete_availability','ALL'),('availability','add_blocked_period','ALL'),('availability','remove_blocked_period','ALL'),
 ('audit','resolve_alert','ALL'),('audit','ignore_alert','ALL'),('audit','run_audit_scan','ALL')
)
insert into public.permission_rules(role,resource,action,scope)
select 'manager',resource,action,scope from actions
on conflict(role,resource,action) do nothing;

-- Staff: actions previously available to every role remain ASSIGNED; all other
-- current actions are explicit NONE rather than relying on absence.
with actions(resource,action,scope) as (values
 ('client','create_client','NONE'),('client','update_client','ASSIGNED'),('client','patch_client','ASSIGNED'),('client','update_status','NONE'),('client','override_status','NONE'),('client','set_next_step','ASSIGNED'),('client','assign_staff','NONE'),('client','soft_delete_client','NONE'),
 ('preference','add_preference','NONE'),('preference','remove_preference','NONE'),
 ('appointment','schedule_appointment','NONE'),('appointment','book_slot','NONE'),('appointment','update_appointment','NONE'),
 ('note','add_note','ASSIGNED'),('task','add_task','ASSIGNED'),('task','update_task','ASSIGNED'),('task','complete_task','ASSIGNED'),
 ('contact','mark_contacted','ASSIGNED'),('followup','add_followup','ASSIGNED'),('followup','complete_followup','ASSIGNED'),
 ('document','verify_document','NONE'),('document','reject_document','NONE'),('document','request_reupload','NONE'),('document','process_document','NONE'),('document','upload_document','ASSIGNED'),('document','view_document','ASSIGNED'),
 ('assessment','update_assessment','NONE'),('assessment','add_standard_assessments','NONE'),('post_hire','update_post_hire','NONE'),
 ('ai','run_intake_agent','ASSIGNED'),('communication','send_notification','NONE'),
 ('staff','create_staff','NONE'),('staff','update_staff_role','NONE'),('staff','disable_staff','NONE'),('staff','reactivate_staff','NONE'),('staff','invite_staff','NONE'),
 ('availability','upsert_availability','NONE'),('availability','delete_availability','NONE'),('availability','add_blocked_period','NONE'),('availability','remove_blocked_period','NONE'),
 ('audit','resolve_alert','NONE'),('audit','ignore_alert','NONE'),('audit','run_audit_scan','NONE')
)
insert into public.permission_rules(role,resource,action,scope)
select 'staff',resource,action,scope from actions
on conflict(role,resource,action) do nothing;

create index if not exists permission_rules_role_action_idx on public.permission_rules(role,action);

alter table public.permission_rules enable row level security;
drop policy if exists permission_rules_staff_read on public.permission_rules;
drop policy if exists permission_rules_admin_write on public.permission_rules;
create policy permission_rules_staff_read on public.permission_rules
  for select to authenticated using (public.cg_staff_id() is not null);
create policy permission_rules_admin_write on public.permission_rules
  for all to authenticated using (public.cg_staff_role()='admin') with check (public.cg_staff_role()='admin');

grant select,insert,update on public.permission_rules to authenticated;
revoke delete on public.permission_rules from authenticated;

commit;
