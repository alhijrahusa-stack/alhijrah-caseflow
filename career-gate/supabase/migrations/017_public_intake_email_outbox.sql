-- Reconciled from live Supabase migration 20261001135030 public_intake_email_outbox.
create table if not exists public.career_gate_email_outbox (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.career_gate_applications(id) on delete cascade,
  template_key text not null,
  recipient_email text not null,
  locale text not null check (locale in ('ar','en')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sent','delivered','bounced')),
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  unique(application_id, template_key)
);
create index if not exists career_gate_email_outbox_pending_idx
  on public.career_gate_email_outbox(status, created_at)
  where status = 'pending';
create unique index if not exists career_gate_email_outbox_provider_message_uidx
  on public.career_gate_email_outbox(provider_message_id)
  where provider_message_id is not null;
alter table public.career_gate_email_outbox enable row level security;
revoke all on public.career_gate_email_outbox from anon;
revoke all on public.career_gate_email_outbox from authenticated;
