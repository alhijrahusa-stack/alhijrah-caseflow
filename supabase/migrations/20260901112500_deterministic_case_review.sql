begin;

create unique index if not exists form_findings_open_deterministic_key_uidx
  on public.form_findings (case_id, ((rule_source ->> 'deterministic_key')))
  where created_by_type = 'deterministic'
    and status = 'open'
    and nullif(rule_source ->> 'deterministic_key', '') is not null;

comment on index public.form_findings_open_deterministic_key_uidx is
  'At most one open deterministic finding exists for a case and deterministic finding identity.';

commit;
