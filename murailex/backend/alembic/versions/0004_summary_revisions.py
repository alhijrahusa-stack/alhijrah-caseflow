"""Preserve independent Summary revision history.

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE summaries DROP CONSTRAINT IF EXISTS summaries_recording_id_transcript_revision_id_summary_type_key")
    op.create_unique_constraint(
        "uq_summaries_revision_type_number",
        "summaries",
        ["recording_id", "transcript_revision_id", "summary_type", "summary_revision"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_summaries_revision_type_number", "summaries", type_="unique")
    op.create_unique_constraint(
        "summaries_recording_id_transcript_revision_id_summary_type_key",
        "summaries",
        ["recording_id", "transcript_revision_id", "summary_type"],
    )
