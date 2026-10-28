DO $$
BEGIN
 IF EXISTS (
   SELECT 1
   FROM public.appointments a
   JOIN public.appointments b ON a.id < b.id AND a.client_id = b.client_id
    AND tstzrange(a.scheduled_at,a.ends_at,'[)') && tstzrange(b.scheduled_at,b.ends_at,'[)')
   WHERE a.status IN ('scheduled','confirmed','rescheduled')
     AND b.status IN ('scheduled','confirmed','rescheduled')
 ) THEN
   RAISE EXCEPTION 'Existing overlapping active appointments for a single client must be reviewed before enabling client-only collision constraint';
 END IF;
END $$;

ALTER TABLE public.appointments DROP CONSTRAINT appointments_no_overlap;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_client_no_overlap
  EXCLUDE USING gist (
    client_id WITH =,
    tstzrange(scheduled_at,ends_at,'[)') WITH &&
  ) WHERE (status IN ('scheduled','confirmed','rescheduled'));

CREATE OR REPLACE FUNCTION public.cg_busy_intervals(
  p_resource text, p_from timestamptz, p_to timestamptz
)
RETURNS TABLE (starts_at timestamptz, ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
  SELECT b.starts_at, b.ends_at
    FROM public.blocked_periods b
   WHERE b.resource_key = p_resource
     AND b.ends_at > p_from AND b.starts_at < p_to;
$body$;

REVOKE ALL ON FUNCTION public.cg_busy_intervals(text,timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cg_busy_intervals(text,timestamptz,timestamptz) TO authenticated,service_role;

CREATE INDEX IF NOT EXISTS appointments_active_client_time_idx
 ON public.appointments (client_id, scheduled_at, ends_at)
 WHERE status IN ('scheduled','confirmed','rescheduled');
