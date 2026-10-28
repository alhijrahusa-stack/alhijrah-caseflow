ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_no_overlap;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_client_overlap_guard
  EXCLUDE USING gist (
    client_id WITH =,
    tstzrange(scheduled_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('scheduled','confirmed','rescheduled'));

CREATE UNIQUE INDEX IF NOT EXISTS notifications_appointment_auto_confirmation_once
  ON public.notifications ((payload->>'appointmentId'), (payload->>'scheduledAt'))
  WHERE template='appointment_auto_confirmation' AND channel='email';
