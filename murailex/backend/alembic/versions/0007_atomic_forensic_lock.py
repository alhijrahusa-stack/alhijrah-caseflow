"""Enforce forensic review propagation and atomic lock invariants in PostgreSQL.

Revision ID: 0007
Revises: 0006
"""
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION murailex_resolved_dispute_evidence()
        RETURNS trigger AS $$
        DECLARE
            span_row RECORD;
            result_text text;
        BEGIN
            IF OLD.status = 'open' AND NEW.status = 'resolved' THEN
                result_text := COALESCE(NEW.resolution->>'text', '');
                FOR span_row IN
                    SELECT id, final_verbatim_text, start_ms, end_ms
                    FROM evidence_spans
                    WHERE recording_id = NEW.recording_id
                      AND start_ms < NEW.end_ms
                      AND end_ms > NEW.start_ms
                LOOP
                    UPDATE evidence_spans
                    SET resolution_state = 'HUMAN_VERIFIED',
                        final_verbatim_text = CASE WHEN result_text <> '' THEN result_text ELSE final_verbatim_text END
                    WHERE id = span_row.id;

                    UPDATE provider_tokens
                    SET resolution_state = 'HUMAN_VERIFIED'
                    WHERE evidence_span_id = span_row.id;

                    INSERT INTO review_events (
                        id, evidence_span_id, reviewer_id, action, before_value,
                        after_value, audio_region, note, reviewed_at
                    ) VALUES (
                        md5(random()::text || clock_timestamp()::text || span_row.id::text)::uuid,
                        span_row.id,
                        NEW.resolved_by,
                        COALESCE(NEW.resolution->>'action', 'review'),
                        span_row.final_verbatim_text,
                        NULLIF(result_text, ''),
                        jsonb_build_object('start_ms', NEW.start_ms, 'end_ms', NEW.end_ms, 'dispute_id', NEW.id),
                        NULL,
                        COALESCE(NEW.resolved_at, now())
                    );
                END LOOP;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_murailex_resolved_dispute_evidence ON disputes;
        CREATE TRIGGER trg_murailex_resolved_dispute_evidence
        AFTER UPDATE OF status ON disputes
        FOR EACH ROW
        EXECUTE FUNCTION murailex_resolved_dispute_evidence();
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION murailex_atomic_transcript_lock_guard()
        RETURNS trigger AS $$
        DECLARE
            primary_count bigint;
            span_count bigint;
            token_count bigint;
        BEGIN
            IF NEW.status = 'locked' AND OLD.status <> 'locked' THEN
                IF EXISTS (
                    SELECT 1 FROM disputes
                    WHERE recording_id = NEW.recording_id AND status = 'open'
                ) THEN
                    RAISE EXCEPTION 'forensic_lock_rejected: unresolved disputes remain';
                END IF;

                SELECT count(*) INTO primary_count
                FROM provider_runs
                WHERE recording_id = NEW.recording_id
                  AND role = 'primary_asr'
                  AND scope_key = 'full'
                  AND status = 'succeeded';

                SELECT count(*) INTO span_count
                FROM evidence_spans
                WHERE recording_id = NEW.recording_id AND revision_id = NEW.id;

                IF primary_count > 0 AND span_count = 0 THEN
                    RAISE EXCEPTION 'forensic_lock_rejected: persisted evidence spans are missing';
                END IF;

                IF EXISTS (
                    SELECT 1 FROM evidence_spans
                    WHERE revision_id = NEW.id
                      AND resolution_state NOT IN ('CONSENSUS', 'HUMAN_VERIFIED')
                ) THEN
                    RAISE EXCEPTION 'forensic_lock_rejected: unresolved evidence spans remain';
                END IF;

                SELECT count(*) INTO token_count
                FROM provider_tokens pt
                JOIN evidence_spans es ON es.id = pt.evidence_span_id
                WHERE es.revision_id = NEW.id;

                IF primary_count > 0 AND token_count = 0 THEN
                    RAISE EXCEPTION 'forensic_lock_rejected: provider token traceability is missing';
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM provider_tokens pt
                    JOIN evidence_spans es ON es.id = pt.evidence_span_id
                    WHERE es.revision_id = NEW.id
                      AND pt.resolution_state NOT IN ('CONSENSUS', 'HUMAN_VERIFIED')
                ) THEN
                    RAISE EXCEPTION 'forensic_lock_rejected: unresolved provider tokens remain';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_murailex_atomic_transcript_lock_guard ON transcript_revisions;
        CREATE TRIGGER trg_murailex_atomic_transcript_lock_guard
        BEFORE UPDATE OF status ON transcript_revisions
        FOR EACH ROW
        EXECUTE FUNCTION murailex_atomic_transcript_lock_guard();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_murailex_atomic_transcript_lock_guard ON transcript_revisions")
    op.execute("DROP FUNCTION IF EXISTS murailex_atomic_transcript_lock_guard()")
    op.execute("DROP TRIGGER IF EXISTS trg_murailex_resolved_dispute_evidence ON disputes")
    op.execute("DROP FUNCTION IF EXISTS murailex_resolved_dispute_evidence()")
