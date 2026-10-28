ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_no_overlap;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_client_overlap_guard
  EXCLUDE USING gist (
    client_id WITH =,
    tstzrange(scheduled_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('scheduled','confirmed','rescheduled'));

CREATE UNIQUE INDEX IF NOT EXISTS notifications_appointment_confirmation_once
  ON public.notifications (
    template,
    (payload->>'appointmentId'),
    (payload->>'scheduledAt'),
    (payload->>'location'),
    (payload->>'recipientKind')
  )
  WHERE template IN ('appointment_scheduled','appointment_updated') AND channel='email';
