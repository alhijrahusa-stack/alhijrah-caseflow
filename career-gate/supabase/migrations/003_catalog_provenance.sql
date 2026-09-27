-- Career Gate 003: preference snapshots carry the official opening's
-- provenance and full pay detail, frozen at selection time.
alter table public.client_preferences
  add column amazon_job_id text,
  add column shift_name text,
  add column source_url text,
  add column source_verified_at text,
  add column pay_detail jsonb;
