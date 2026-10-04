alter table public.staff
  add column if not exists permission_mode text not null default 'full',
  add column if not exists permissions text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.staff'::regclass
      and conname = 'staff_permission_mode_check'
  ) then
    alter table public.staff
      add constraint staff_permission_mode_check
      check (permission_mode in ('full','custom'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.staff'::regclass
      and conname = 'staff_permissions_known_check'
  ) then
    alter table public.staff
      add constraint staff_permissions_known_check
      check (permissions <@ array[
        'create_client','update_client','patch_client','update_status','override_status','set_next_step',
        'add_preference','remove_preference','schedule_appointment','book_slot','update_appointment',
        'add_note','add_task','update_task','complete_task','assign_staff','mark_contacted','add_followup','complete_followup',
        'verify_document','reject_document','request_reupload','process_document','update_assessment','add_standard_assessments',
        'update_post_hire','run_intake_agent','send_notification','soft_delete_client','create_staff','update_staff_role',
        'disable_staff','reactivate_staff','invite_staff','manage_staff_permissions','upsert_availability','delete_availability',
        'add_blocked_period','remove_blocked_period','resolve_alert','ignore_alert','run_audit_scan','upload_document','view_document'
      ]::text[]);
  end if;
end $$;

comment on column public.staff.permission_mode is 'B3 RBAC mode: full grants all canonical permissions subject to role ceiling; custom grants selected permissions subject to role ceiling.';
comment on column public.staff.permissions is 'Canonical B3 permission keys used when permission_mode=custom. Existing role authorization remains an upper bound.';
