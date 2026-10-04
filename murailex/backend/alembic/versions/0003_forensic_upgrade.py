"""Forensic upgrade: six-locale routing, Summary workspace, enhanced recording metadata, review state.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Update Recording table: rename language_hint → language_locale, add recording_type/expected_terms
    op.add_column("recordings", sa.Column("language_locale", sa.String(20), nullable=True))
    op.add_column("recordings", sa.Column("recording_type", sa.String(40), nullable=True))
    op.add_column("recordings", sa.Column("expected_terms", postgresql.JSONB(), nullable=True))
    op.execute("UPDATE recordings SET language_locale = language_hint WHERE language_hint IS NOT NULL")
    op.drop_column("recordings", "language_hint")

    # Update UploadSession table: rename language_hint → language_locale, add recording_type/expected_terms
    op.add_column("upload_sessions", sa.Column("language_locale", sa.String(20), nullable=True))
    op.add_column("upload_sessions", sa.Column("recording_type", sa.String(40), nullable=True))
    op.add_column("upload_sessions", sa.Column("expected_terms", postgresql.JSONB(), nullable=True))
    op.execute("UPDATE upload_sessions SET language_locale = language_hint WHERE language_hint IS NOT NULL")
    op.drop_column("upload_sessions", "language_hint")

    # Add review_state to TranscriptRevision
    op.add_column(
        "transcript_revisions",
        sa.Column("review_state", sa.String(20), nullable=False, server_default="unreviewed"),
    )

    # Create Summary table
    op.create_table(
        "summaries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("recording_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("transcript_revision_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("transcript_sha256", sa.String(64), nullable=False),
        sa.Column("summary_type", sa.String(40), nullable=False),
        sa.Column("summary_revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("content", postgresql.JSONB(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("generation_model", sa.String(100), nullable=False, server_default="extractive"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["recording_id"], ["recordings.id"]),
        sa.ForeignKeyConstraint(["transcript_revision_id"], ["transcript_revisions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("recording_id", "transcript_revision_id", "summary_type"),
    )

    # Update ExportRecord: add summary_id, rename export_type → document_type
    op.add_column("exports", sa.Column("summary_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("exports", sa.Column("document_type", sa.String(40), nullable=False, server_default="transcript"))
    op.create_foreign_key("fk_exports_summary_id", "exports", "summaries", ["summary_id"], ["id"])
    op.execute("UPDATE exports SET document_type = 'transcript' WHERE document_type IS NULL")


def downgrade() -> None:
    # Reverse ExportRecord changes
    op.drop_constraint("fk_exports_summary_id", "exports", type_="foreignkey")
    op.drop_column("exports", "document_type")
    op.drop_column("exports", "summary_id")

    # Drop Summary table
    op.drop_table("summaries")

    # Remove review_state from TranscriptRevision
    op.drop_column("transcript_revisions", "review_state")

    # Restore UploadSession (reverse language_locale → language_hint)
    op.add_column("upload_sessions", sa.Column("language_hint", sa.String(20), nullable=True))
    op.execute("UPDATE upload_sessions SET language_hint = language_locale WHERE language_locale IS NOT NULL")
    op.drop_column("upload_sessions", "expected_terms")
    op.drop_column("upload_sessions", "recording_type")
    op.drop_column("upload_sessions", "language_locale")

    # Restore Recording (reverse language_locale → language_hint)
    op.add_column("recordings", sa.Column("language_hint", sa.String(20), nullable=True))
    op.execute("UPDATE recordings SET language_hint = language_locale WHERE language_locale IS NOT NULL")
    op.drop_column("recordings", "expected_terms")
    op.drop_column("recordings", "recording_type")
    op.drop_column("recordings", "language_locale")

