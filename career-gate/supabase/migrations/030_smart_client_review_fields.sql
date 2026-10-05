alter table public.clients
  add column if not exists english_proficiency text null;

alter table public.clients
  drop constraint if exists clients_english_proficiency_check;

alter table public.clients
  add constraint clients_english_proficiency_check
  check (english_proficiency is null or english_proficiency in ('EXCELLENT','GOOD','FAIR','WEAK','NONE'));
