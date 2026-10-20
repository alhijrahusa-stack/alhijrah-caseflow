-- Staff Dashboard "completed this month" reads status events whose new status
-- is completed. Without a matching index the RLS predicate runs on every
-- status event of the month before the JSON status test can discard it.
-- A partial index whose predicate carries the status test leaves RLS to run
-- only on the completion events themselves. Additive, idempotent, no data change.
create index if not exists activity_completed_status_idx
  on public.activity_log (created_at desc)
  where action in ('status_changed','status_overridden') and (new_value->>'status')='completed';
