-- Unified Career Gate operational audit. Existing activity_log remains the
-- client timeline and now also records non-client system/admin resources by
-- allowing client_id NULL. History is append-only through RLS.

begin;

alter table public.activity_log alter column client_id drop not null;

alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check check (action = any(array[
  'client_created','client_updated','client_deleted','preference_added','preference_removed',
  'status_changed','status_overridden','next_step_changed','staff_assigned','pipeline_stage_changed',
  'transfer_requested','payment_updated','bulk_staff_assigned','round_robin_setting_changed',
  'document_uploaded','document_processing_started','document_processed','document_verified',
  'document_rejected','document_reupload_requested','document_opened','appointment_created',
  'appointment_updated','appointment_rescheduled','appointment_completed','note_added','task_added',
  'task_updated','task_completed','contact_logged','followup_created','followup_completed',
  'assessment_updated','post_hire_updated','agent_alert_created','agent_run','notification_queued',
  'notification_sent','notification_failed','notification_not_configured','status_otp_requested',
  'status_otp_verified','financial_transaction_recorded','commission_created','commission_status_changed',
  'staff_profile_updated','asset_created','asset_assigned','asset_returned','permission_updated',
  'workflow_draft_created','workflow_draft_updated','workflow_published','integration_setting_updated'
]::text[]));

-- Replace broad ALL policy with append-only read/insert policies.
drop policy if exists activity_log_client_scope on public.activity_log;
drop policy if exists activity_log_client_read on public.activity_log;
drop policy if exists activity_log_client_insert on public.activity_log;
drop policy if exists activity_log_system_read on public.activity_log;
drop policy if exists activity_log_system_insert on public.activity_log;

create policy activity_log_client_read on public.activity_log
  for select to authenticated using (client_id is not null and public.cg_can_access_client(client_id));
create policy activity_log_client_insert on public.activity_log
  for insert to authenticated with check (client_id is not null and public.cg_can_access_client(client_id));
create policy activity_log_system_read on public.activity_log
  for select to authenticated using (client_id is null and public.cg_staff_role() in ('admin','manager'));
create policy activity_log_system_insert on public.activity_log
  for insert to authenticated with check (client_id is null and public.cg_staff_role() in ('admin','manager'));

revoke update,delete on public.activity_log from authenticated;
grant select,insert on public.activity_log to authenticated;

insert into public.permission_rules(role,resource,action,scope) values
 ('admin','permissions','configure_permissions','ALL'),('manager','permissions','configure_permissions','NONE'),('staff','permissions','configure_permissions','NONE'),
 ('admin','staff','manage_staff_profile','ALL'),('manager','staff','manage_staff_profile','NONE'),('staff','staff','manage_staff_profile','NONE'),
 ('admin','assets','manage_assets','ALL'),('manager','assets','manage_assets','ALL'),('staff','assets','manage_assets','NONE')
on conflict(role,resource,action) do update set scope=excluded.scope,updated_at=now();

commit;
