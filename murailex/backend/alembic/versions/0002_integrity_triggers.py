"""evidence integrity triggers

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


UPGRADE = r"""
-- Audit history is append-only.
create or replace function murailex_forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'MURAILEX integrity: % on % is forbidden', tg_op, tg_table_name
    using errcode = 'P0001';
end $$;

create trigger audit_events_append_only
  before update or delete on audit_events
  for each row execute function murailex_forbid_mutation();

create trigger audit_events_no_truncate
  before truncate on audit_events
  for each statement execute function murailex_forbid_mutation();

-- Original evidence metadata is immutable once written.
create or replace function murailex_recording_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'MURAILEX integrity: recordings cannot be deleted' using errcode = 'P0001';
  end if;
  if new.sha256 is distinct from old.sha256
     or new.storage_key is distinct from old.storage_key
     or new.storage_version_id is distinct from old.storage_version_id
     or new.byte_size is distinct from old.byte_size
     or new.original_filename is distinct from old.original_filename
     or new.mime_type is distinct from old.mime_type
     or new.uploaded_at is distinct from old.uploaded_at
     or new.owner_id is distinct from old.owner_id then
    raise exception 'MURAILEX integrity: original evidence metadata is immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger recordings_immutable_evidence
  before update or delete on recordings
  for each row execute function murailex_recording_guard();

-- Locked transcript revisions are immutable; revisions are never deleted.
create or replace function murailex_revision_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'MURAILEX integrity: transcript revisions cannot be deleted' using errcode = 'P0001';
  end if;
  if old.status = 'locked' then
    raise exception 'MURAILEX integrity: locked revision % is immutable', old.id using errcode = 'P0001';
  end if;
  if new.status = 'locked' and (new.sha256 is null or new.locked_at is null) then
    raise exception 'MURAILEX integrity: locking requires sha256 and locked_at' using errcode = 'P0001';
  end if;
  if new.recording_id is distinct from old.recording_id or new.number is distinct from old.number then
    raise exception 'MURAILEX integrity: revision identity is immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger transcript_revisions_guard
  before update or delete on transcript_revisions
  for each row execute function murailex_revision_guard();

-- Only one open draft per recording.
create unique index transcript_revisions_one_draft
  on transcript_revisions (recording_id) where status = 'draft';

-- Completed provider results are preserved exactly as received.
create or replace function murailex_provider_run_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'MURAILEX integrity: provider runs cannot be deleted' using errcode = 'P0001';
  end if;
  if old.status = 'succeeded' then
    raise exception 'MURAILEX integrity: completed provider run % is immutable', old.id using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger provider_runs_guard
  before update or delete on provider_runs
  for each row execute function murailex_provider_run_guard();

-- Completed translations and exports are immutable.
create or replace function murailex_completed_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'MURAILEX integrity: % rows cannot be deleted', tg_table_name using errcode = 'P0001';
  end if;
  if old.status = 'succeeded' then
    raise exception 'MURAILEX integrity: completed % row is immutable', tg_table_name using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger translations_guard
  before update or delete on translations
  for each row execute function murailex_completed_guard();

create trigger exports_immutable
  before update or delete on exports
  for each row execute function murailex_forbid_mutation();

create index jobs_claim_idx on jobs (status, run_after);
create index provider_runs_recording_idx on provider_runs (recording_id, role, scope_key);
create index disputes_recording_idx on disputes (recording_id, status);
"""

DOWNGRADE = r"""
drop trigger if exists exports_immutable on exports;
drop trigger if exists translations_guard on translations;
drop trigger if exists provider_runs_guard on provider_runs;
drop trigger if exists transcript_revisions_guard on transcript_revisions;
drop trigger if exists recordings_immutable_evidence on recordings;
drop trigger if exists audit_events_no_truncate on audit_events;
drop trigger if exists audit_events_append_only on audit_events;
drop index if exists transcript_revisions_one_draft;
drop index if exists jobs_claim_idx;
drop index if exists provider_runs_recording_idx;
drop index if exists disputes_recording_idx;
drop function if exists murailex_completed_guard();
drop function if exists murailex_provider_run_guard();
drop function if exists murailex_revision_guard();
drop function if exists murailex_recording_guard();
drop function if exists murailex_forbid_mutation();
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
