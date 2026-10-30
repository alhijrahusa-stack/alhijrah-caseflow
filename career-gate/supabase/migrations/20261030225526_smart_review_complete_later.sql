-- Match confirmations record observed verification; approval may retain follow-up work.
-- Keep reviewer attribution, review timestamps and the canonical client link mandatory.
begin;

alter table public.client_import_cases
  drop constraint client_import_cases_approved_ck;

alter table public.client_import_cases
  add constraint client_import_cases_approved_ck check (
    status <> 'APPROVED_FILE'
    or (
      reviewer_id is not null
      and review_started_at is not null
      and reviewed_at is not null
      and approved_by is not null
      and approved_at is not null
      and created_client_id is not null
    )
  );

commit;
