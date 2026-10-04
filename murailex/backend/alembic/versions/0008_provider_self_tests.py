"""Persist real provider canary/self-test evidence.

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "provider_self_tests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("provider", sa.String(60), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("locale", sa.String(20), nullable=False),
        sa.Column("role", sa.String(40), nullable=False),
        sa.Column("recording_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("recordings.id"), nullable=False),
        sa.Column("provider_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("provider_runs.id")),
        sa.Column("status", sa.String(20), nullable=False, server_default="BLOCKED"),
        sa.Column("latency_ms", sa.BigInteger()),
        sa.Column("response_metadata", postgresql.JSONB()),
        sa.Column("error", sa.Text()),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('READY','FAILED','BLOCKED','NOT_CONFIGURED')", name="ck_provider_self_tests_status"),
    )
    op.create_index(
        "ix_provider_self_tests_lookup",
        "provider_self_tests",
        ["provider", "model", "locale", "completed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_provider_self_tests_lookup", table_name="provider_self_tests")
    op.drop_table("provider_self_tests")
