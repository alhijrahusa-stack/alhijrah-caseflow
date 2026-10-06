-- Career Gate 031: Smart review canonical persistence.
-- Keeps the existing Client as authority and adds only the reviewed Smart fields
-- that have no equivalent canonical storage.

alter table public.clients
  alter column preferred_language drop default,
  alter column preferred_language drop not null;

alter table public.clients
  add column if not exists preferred_location text,
  add column if not exists location_option_1 text,
  add column if not exists location_option_2 text,
  add column if not exists shift_days text[],
  add column if not exists shift_start_time time without time zone,
  add column if not exists shift_end_time time without time zone;

alter table public.clients
  drop constraint if exists clients_shift_days_check;

alter table public.clients
  add constraint clients_shift_days_check
  check (
    shift_days is null
    or shift_days <@ array['SUN','MON','TUE','WED','THU','FRI','SAT']::text[]
  );
