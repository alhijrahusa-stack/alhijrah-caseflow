"""Bind every transcript segment to the row's immutable revision id.

Revision ID: 0005
Revises: 0004
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


_BIND_FUNCTION = r"""
CREATE OR REPLACE FUNCTION murailex_bind_revision_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    rebound jsonb;
BEGIN
    IF NEW.content IS NULL OR jsonb_typeof(NEW.content) <> 'object' THEN
        RETURN NEW;
    END IF;

    IF jsonb_typeof(NEW.content->'segments') = 'array' THEN
        SELECT COALESCE(
            jsonb_agg(
                jsonb_set(segment, '{revision_id}', to_jsonb(NEW.id::text), true)
                ORDER BY ordinal
            ),
            '[]'::jsonb
        )
        INTO rebound
        FROM jsonb_array_elements(NEW.content->'segments') WITH ORDINALITY AS items(segment, ordinal);

        NEW.content := jsonb_set(NEW.content, '{segments}', rebound, true);
    END IF;

    RETURN NEW;
END;
$$;
"""


def upgrade() -> None:
    op.execute(_BIND_FUNCTION)
    op.execute("DROP TRIGGER IF EXISTS murailex_bind_revision_content_trigger ON transcript_revisions")
    op.execute(
        """
        CREATE TRIGGER murailex_bind_revision_content_trigger
        BEFORE INSERT OR UPDATE OF content ON transcript_revisions
        FOR EACH ROW
        EXECUTE FUNCTION murailex_bind_revision_content()
        """
    )
    op.execute(
        """
        UPDATE transcript_revisions
        SET content = content
        WHERE status <> 'locked'
          AND jsonb_typeof(content->'segments') = 'array'
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS murailex_bind_revision_content_trigger ON transcript_revisions")
    op.execute("DROP FUNCTION IF EXISTS murailex_bind_revision_content()")
