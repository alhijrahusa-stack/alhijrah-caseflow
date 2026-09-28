-- Career Gate 004: production staff dashboard roles + query indexes.

update public.staff set role = 'manager' where display_name = 'Yusuf' and role <> 'admin';
update public.staff set role = 'staff' where display_name in ('Salah','Anas') and role <> 'admin';

create index if not exists appointments_open_schedule_idx
  on public.appointments (scheduled_at, client_id)
  where status in ('scheduled','confirmed','rescheduled');

create index if not exists tasks_open_due_idx
  on public.tasks (due_at, client_id)
  where status in ('pending','in_progress');

create index if not exists followups_open_due_idx
  on public.followups (due_date, client_id)
  where status = 'open';

create index if not exists contacts_client_created_idx
  on public.contacts (client_id, created_at desc);

create index if not exists activity_staff_created_idx
  on public.activity_log (staff_id, created_at desc)
  where staff_id is not null;

create index if not exists activity_status_created_idx
  on public.activity_log (created_at desc)
  where action in ('status_changed','status_overridden');

create index if not exists documents_reviewed_state_idx
  on public.documents (status, reviewed_at desc);
