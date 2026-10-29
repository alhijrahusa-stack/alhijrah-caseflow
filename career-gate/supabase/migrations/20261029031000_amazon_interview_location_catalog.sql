CREATE TABLE IF NOT EXISTS public.amazon_interview_locations (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{4,5}$'),
  name text NOT NULL,
  kind text NOT NULL,
  address text NOT NULL,
  location_text text GENERATED ALWAYS AS (name || ' (' || code || '): ' || kind || ' - ' || address) STORED,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.amazon_interview_locations (code, name, kind, address, active)
VALUES
 ('DTW1','Romulus','Amazon Fulfillment Center','32801 Ecorse Rd, Romulus, MI 48174',true),
 ('DET6','Detroit','Amazon Delivery Station','20110 Woodward Ave, Detroit, MI 48203',true),
 ('DET1','Livonia','Amazon Fulfillment Center','39000 Amrhein Rd, Livonia, MI 48150',true),
 ('DET3','Pontiac','Amazon Fulfillment Center','1220 Featherstone Rd, Pontiac, MI 48342',true),
 ('DDT9','Canton','Amazon Delivery Station','49000 Michigan Ave, Canton Township, MI 48188',true),
 ('SMI1','Hazel Park','Amazon Sub-Same-Day Delivery','1400 E 10 Mile Rd Ste 190, Hazel Park, MI 48030',true),
 ('DTW3','Romulus Prescott','Amazon Fulfillment Center','33701 Prescott St, Romulus, MI 48174',true),
 ('DTW9','Romulus Prescott','Amazon Sort Center','33700 Prescott St, Romulus, MI 48174',true),
 ('DGR3','Sterling Heights','Amazon Delivery Station','33600 Mound Rd, Sterling Heights, MI 48310',true),
 ('DET2','Shelby Township','Amazon Fulfillment Center','50500 Mound Rd, Shelby Township, MI 48317',true),
 ('DTW8','Plymouth','Amazon Fulfillment Center','9075 Haggerty Rd, Plymouth, MI 48170',true)
ON CONFLICT (code) DO UPDATE
  SET name=EXCLUDED.name, kind=EXCLUDED.kind, address=EXCLUDED.address,
      active=EXCLUDED.active, updated_at=now()
  WHERE (amazon_interview_locations.name,amazon_interview_locations.kind,amazon_interview_locations.address,amazon_interview_locations.active)
    IS DISTINCT FROM (EXCLUDED.name,EXCLUDED.kind,EXCLUDED.address,EXCLUDED.active);

ALTER TABLE public.amazon_interview_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amazon_interview_locations_read ON public.amazon_interview_locations;
CREATE POLICY amazon_interview_locations_read ON public.amazon_interview_locations
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.amazon_interview_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.amazon_interview_locations TO authenticated, service_role;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS location_id text REFERENCES public.amazon_interview_locations(code);

CREATE OR REPLACE FUNCTION public.cg_sync_appointment_location()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $body$
BEGIN
  SELECT l.code INTO NEW.location_id
    FROM public.amazon_interview_locations l
    WHERE l.active AND l.location_text = NEW.location;
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS appointments_sync_location ON public.appointments;
CREATE TRIGGER appointments_sync_location
  BEFORE INSERT OR UPDATE OF location,location_id ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.cg_sync_appointment_location();

UPDATE public.appointments a
  SET location_id=l.code
  FROM public.amazon_interview_locations l
  WHERE a.location=l.location_text AND a.location_id IS DISTINCT FROM l.code;

CREATE INDEX IF NOT EXISTS appointments_location_id_idx ON public.appointments(location_id,scheduled_at)
  WHERE location_id IS NOT NULL;
