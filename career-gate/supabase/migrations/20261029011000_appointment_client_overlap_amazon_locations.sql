DO $$
DECLARE old_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO old_definition
  FROM pg_constraint WHERE conrelid='public.appointments'::regclass
    AND conname='appointments_no_overlap' AND contype='x';
  IF old_definition IS NOT NULL THEN
    IF position('resource_key WITH =' IN old_definition) = 0 THEN
      RAISE EXCEPTION 'Refusing to drop unknown legacy appointment constraint: %',old_definition;
    END IF;
    ALTER TABLE public.appointments DROP CONSTRAINT appointments_no_overlap;
  END IF;
END $$;

DO $$
DECLARE v_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_definition
  FROM pg_constraint WHERE conrelid = 'public.appointments'::regclass
    AND conname = 'appointments_client_no_overlap' AND contype = 'x';
  IF v_definition IS NULL THEN
    ALTER TABLE public.appointments ADD CONSTRAINT appointments_client_no_overlap
      EXCLUDE USING gist (client_id WITH =, tstzrange(scheduled_at, ends_at, '[)') WITH &&)
      WHERE (status IN ('scheduled','confirmed','rescheduled'));
  ELSIF position('client_id WITH =' IN v_definition) = 0
     OR position('tstzrange(scheduled_at, ends_at' IN v_definition) = 0
     OR position('resource_key WITH =' IN v_definition) > 0
     OR position('assigned_staff WITH =' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Refusing unsafe appointment overlap constraint: %', v_definition;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.appointment_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{3,6}$'),
  display_city text NOT NULL,
  facility_type text NOT NULL,
  street_address text NOT NULL,
  city text NOT NULL,
  state text NOT NULL DEFAULT 'MI',
  zip_code text NOT NULL CHECK (zip_code ~ '^[0-9]{5}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.appointment_locations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.appointment_locations TO authenticated, service_role;
DROP POLICY IF EXISTS appointment_locations_staff_read ON public.appointment_locations;
CREATE POLICY appointment_locations_staff_read ON public.appointment_locations
  FOR SELECT TO authenticated USING (public.cg_staff_id() IS NOT NULL);
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.appointment_locations(id);
CREATE INDEX IF NOT EXISTS appointments_location_id_idx ON public.appointments(location_id)
  WHERE location_id IS NOT NULL;

INSERT INTO public.appointment_locations (code,display_city,facility_type,street_address,city,state,zip_code,active)
VALUES
  ('DTW1','Romulus','Amazon Fulfillment Center','32801 Ecorse Rd','Romulus','MI','48174',true),
  ('DET6','Detroit','Amazon Delivery Station','20110 Woodward Ave','Detroit','MI','48203',true),
  ('DET1','Livonia','Amazon Fulfillment Center','39000 Amrhein Rd','Livonia','MI','48150',true),
  ('DET3','Pontiac','Amazon Fulfillment Center','1220 Featherstone Rd','Pontiac','MI','48342',true),
  ('DDT9','Canton','Amazon Delivery Station','49000 Michigan Ave','Canton Township','MI','48188',true),
  ('SMI1','Hazel Park','Amazon Sub-Same-Day Delivery','1400 E 10 Mile Rd Ste 190','Hazel Park','MI','48030',true),
  ('DTW3','Romulus Prescott','Amazon Fulfillment Center','33701 Prescott St','Romulus','MI','48174',true),
  ('DTW9','Romulus Prescott','Amazon Sort Center','33700 Prescott St','Romulus','MI','48174',true),
  ('DGR3','Sterling Heights','Amazon Delivery Station','33600 Mound Rd','Sterling Heights','MI','48310',true),
  ('DET2','Shelby Township','Amazon Fulfillment Center','50500 Mound Rd','Shelby Township','MI','48317',true),
  ('DTW8','Plymouth','Amazon Fulfillment Center','9075 Haggerty Rd','Plymouth','MI','48170',true)
ON CONFLICT (code) DO UPDATE SET
 display_city=EXCLUDED.display_city,facility_type=EXCLUDED.facility_type,
 street_address=EXCLUDED.street_address,city=EXCLUDED.city,state=EXCLUDED.state,
 zip_code=EXCLUDED.zip_code,active=true,updated_at=now()
WHERE (appointment_locations.display_city,appointment_locations.facility_type,
       appointment_locations.street_address,appointment_locations.city,
       appointment_locations.state,appointment_locations.zip_code,appointment_locations.active)
 IS DISTINCT FROM (EXCLUDED.display_city,EXCLUDED.facility_type,EXCLUDED.street_address,
                   EXCLUDED.city,EXCLUDED.state,EXCLUDED.zip_code,true);
