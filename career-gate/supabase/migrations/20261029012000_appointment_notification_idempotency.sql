ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE CASCADE;
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_idempotency_key_unique
  ON public.notifications (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_appointment_queue_idx
  ON public.notifications (appointment_id, status)
  WHERE appointment_id IS NOT NULL AND status = 'queued';
