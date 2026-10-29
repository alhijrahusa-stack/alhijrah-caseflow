DO $$
DECLARE constraint_definition text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO constraint_definition
  FROM pg_constraint c WHERE c.conrelid='public.appointments'::regclass
    AND c.conname='appointments_client_no_overlap' AND c.contype='x';
  IF constraint_definition IS NULL
    OR constraint_definition NOT LIKE '%client_id WITH =%'
    OR constraint_definition NOT LIKE '%tstzrange(scheduled_at, ends_at%'
  THEN
    RAISE EXCEPTION 'Client-only exclusion constraint missing or changed; abort appointment migration';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.appointment_amazon_sites (
  code text PRIMARY KEY,
  city text NOT NULL,
  facility_name text NOT NULL,
  street_address text NOT NULL,
  full_address text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.appointment_amazon_sites (code, city, facility_name, street_address, full_address, active) VALUES
('DTW1','Romulus','Amazon Fulfillment Center','32801 Ecorse Rd','32801 Ecorse Rd, Romulus, MI 48174',true),
('DET6','Detroit','Amazon Delivery Station','20110 Woodward Ave','20110 Woodward Ave, Detroit, MI 48203',true),
('DET1','Livonia','Amazon Fulfillment Center','39000 Amrhein Rd','39000 Amrhein Rd, Livonia, MI 48150',true),
('DET3','Pontiac','Amazon Fulfillment Center','1220 Featherstone Rd','1220 Featherstone Rd, Pontiac, MI 48342',true),
('DDT9','Canton','Amazon Delivery Station','49000 Michigan Ave','49000 Michigan Ave, Canton Township, MI 48188',true),
('SMI1','Hazel Park','Amazon Sub-Same-Day Delivery','1400 E 10 Mile Rd Ste 190','1400 E 10 Mile Rd Ste 190, Hazel Park, MI 48030',true),
('DTW3','Romulus','Amazon Fulfillment Center','33701 Prescott St','33701 Prescott St, Romulus, MI 48174',true),
('DTW9','Romulus','Amazon Sort Center','33700 Prescott St','33700 Prescott St, Romulus, MI 48174',true),
('DGR3','Sterling Heights','Amazon Delivery Station','33600 Mound Rd','33600 Mound Rd, Sterling Heights, MI 48310',true),
('DET2','Shelby Township','Amazon Fulfillment Center','50500 Mound Rd','50500 Mound Rd, Shelby Township, MI 48317',true),
('DTW8','Plymouth','Amazon Fulfillment Center','9075 Haggerty Rd','9075 Haggerty Rd, Plymouth, MI 48170',true)
ON CONFLICT (code) DO UPDATE SET
city=EXCLUDED.city, facility_name=EXCLUDED.facility_name,street_address=EXCLUDED.street_address,
full_address=EXCLUDED.full_address,active=EXCLUDED.active,updated_at=now();

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS location_id text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='appointments_location_id_fkey'
    AND conrelid='public.appointments'::regclass) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_location_id_fkey FOREIGN KEY (location_id)
      REFERENCES public.appointment_amazon_sites(code);
  END IF;
END $$;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_idempotency_key_uniq
  ON public.notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.appointment_amazon_sites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS appointment_sites_authenticated_read ON public.appointment_amazon_sites;
CREATE POLICY appointment_sites_authenticated_read ON public.appointment_amazon_sites
  FOR SELECT TO authenticated USING ((select auth.uid()) IS NOT NULL);
REVOKE ALL ON public.appointment_amazon_sites FROM PUBLIC, anon;
GRANT SELECT ON public.appointment_amazon_sites TO authenticated, service_role;
