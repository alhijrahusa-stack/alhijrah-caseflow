"""TOTP multi-factor authentication, session metadata, and cases.

Revision ID: 0010
Revises: 0009
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("totp_secret_enc", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("totp_pending_enc", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("mfa_enabled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("totp_last_step", sa.BigInteger(), nullable=True))
    op.add_column("auth_sessions", sa.Column("ip", sa.String(64), nullable=True))
    op.add_column("auth_sessions", sa.Column("user_agent", sa.String(300), nullable=True))
    op.add_column("auth_sessions", sa.Column("mfa_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("auth_sessions", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "cases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reference", sa.String(120), nullable=False),
        sa.Column("title", sa.String(300), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("owner_id", "reference", name="uq_cases_owner_reference"),
    )
    op.add_column("recordings", sa.Column("case_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("cases.id"), nullable=True))
    op.create_index("ix_recordings_case_id", "recordings", ["case_id"])


def downgrade() -> None:
    op.drop_index("ix_recordings_case_id", table_name="recordings")
    op.drop_column("recordings", "case_id")
    op.drop_table("cases")
    for col in ("last_seen_at", "mfa_verified", "user_agent", "ip"):
        op.drop_column("auth_sessions", col)
    for col in ("totp_last_step", "mfa_enabled_at", "totp_pending_enc", "totp_secret_enc"):
        op.drop_column("users", col)
