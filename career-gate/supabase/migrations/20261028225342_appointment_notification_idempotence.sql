CREATE UNIQUE INDEX IF NOT EXISTS notifications_appointment_confirmation_once
  ON public.notifications (
    template,
    (payload->>'appointmentId'),
    (payload->>'scheduledAt'),
    (payload->>'location'),
    (payload->>'appointmentType'),
    (payload->>'recipientKind')
  )
  WHERE template IN ('appointment_scheduled','appointment_updated') AND channel='email';
