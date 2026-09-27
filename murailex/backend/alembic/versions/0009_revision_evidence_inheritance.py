"""Inherit persisted forensic evidence into child transcript revisions.

Revision ID: 0009
Revises: 0008
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION murailex_inherit_revision_evidence()
        RETURNS trigger AS $$
        DECLARE
            span_row RECORD;
            inherited_span_id uuid;
        BEGIN
            IF NEW.parent_id IS NULL THEN
                RETURN NEW;
            END IF;

            FOR span_row IN
                SELECT *
                FROM evidence_spans
                WHERE recording_id = NEW.recording_id
                  AND revision_id = NEW.parent_id
                ORDER BY start_ms, end_ms, id
            LOOP
                inherited_span_id := md5(
                    random()::text || clock_timestamp()::text || span_row.id::text || NEW.id::text
                )::uuid;

                INSERT INTO evidence_spans (
                    id,
                    recording_id,
                    revision_id,
                    start_ms,
                    end_ms,
                    speaker_id,
                    overlap_state,
                    provider_a_text,
                    provider_b_text,
                    comparison_value,
                    resolution_state,
                    critical_flags,
                    final_verbatim_text,
                    provenance
                ) VALUES (
                    inherited_span_id,
                    NEW.recording_id,
                    NEW.id,
                    span_row.start_ms,
                    span_row.end_ms,
                    span_row.speaker_id,
                    span_row.overlap_state,
                    span_row.provider_a_text,
                    span_row.provider_b_text,
                    span_row.comparison_value,
                    span_row.resolution_state,
                    span_row.critical_flags,
                    span_row.final_verbatim_text,
                    span_row.provenance
                );

                INSERT INTO provider_tokens (
                    provider_run_id,
                    raw_token,
                    start_ms,
                    end_ms,
                    confidence_metadata,
                    evidence_span_id,
                    resolution_state
                )
                SELECT
                    provider_run_id,
                    raw_token,
                    start_ms,
                    end_ms,
                    confidence_metadata,
                    inherited_span_id,
                    resolution_state
                FROM provider_tokens
                WHERE evidence_span_id = span_row.id
                ORDER BY id;
            END LOOP;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_murailex_inherit_revision_evidence ON transcript_revisions;
        CREATE TRIGGER trg_murailex_inherit_revision_evidence
        AFTER INSERT ON transcript_revisions
        FOR EACH ROW
        EXECUTE FUNCTION murailex_inherit_revision_evidence();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_murailex_inherit_revision_evidence ON transcript_revisions")
    op.execute("DROP FUNCTION IF EXISTS murailex_inherit_revision_evidence()")
