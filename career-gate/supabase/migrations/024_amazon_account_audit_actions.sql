-- Extend the existing append-only activity vocabulary for Amazon Account events.
alter table public.activity_log drop constraint activity_log_action_check;

alter table public.activity_log
  add constraint activity_log_action_check check (action in (
    'client_created', 'client_updated', 'client_deleted', 'preference_added', 'preference_removed',
    'status_changed', 'status_overridden', 'next_step_changed', 'staff_assigned', 'staff_reassigned',
    'pipeline_stage_changed', 'transfer_requested', 'payment_updated', 'payment_transaction_recorded',
    'commission_created', 'commission_updated', 'requirement_updated', 'bulk_staff_assigned',
    'round_robin_setting_changed', 'task_reassigned', 'client_started',
    'document_uploaded', 'document_processing_started', 'document_processed', 'document_verified',
    'document_rejected', 'document_reupload_requested', 'document_opened',
    'appointment_created', 'appointment_updated', 'appointment_rescheduled', 'appointment_completed',
    'note_added', 'task_added', 'task_updated', 'task_completed',
    'contact_logged', 'followup_created', 'followup_completed',
    'assessment_updated', 'post_hire_updated', 'agent_alert_created', 'agent_run',
    'notification_queued', 'notification_sent', 'notification_failed', 'notification_not_configured',
    'status_otp_requested', 'status_otp_verified',
    'amazon_account_assigned', 'amazon_account_ready', 'amazon_account_updated', 'amazon_account_disabled',
    'credential_revealed', 'credential_copied'
  )) not valid;

alter table public.activity_log validate constraint activity_log_action_check;
