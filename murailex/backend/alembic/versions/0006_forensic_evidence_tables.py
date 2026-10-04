"""Persist forensic evidence spans, review provenance, provider tokens, PDFs and benchmarks.

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "derived_audio",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("recording_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("recordings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_sha256", sa.String(64), nullable=False),
        sa.Column("derived_sha256", sa.String(64), nullable=False),
        sa.Column("transformation", sa.Text(), nullable=False),
        sa.Column("parameters", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("recording_id", "derived_sha256", name="uq_derived_audio_recording_sha"),
    )
    op.create_index("ix_derived_audio_recording_id", "derived_audio", ["recording_id"])

    op.create_table(
        "evidence_spans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("recording_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("recordings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("transcript_revisions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("start_ms", sa.BigInteger(), nullable=False),
        sa.Column("end_ms", sa.BigInteger(), nullable=False),
        sa.Column("speaker_id", sa.String(20), nullable=True),
        sa.Column("overlap_state", sa.String(30), nullable=False, server_default="none"),
        sa.Column("provider_a_text", sa.Text(), nullable=True),
        sa.Column("provider_b_text", sa.Text(), nullable=True),
        sa.Column("comparison_value", sa.Text(), nullable=True),
        sa.Column("resolution_state", sa.String(30), nullable=False),
        sa.Column("critical_flags", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("final_verbatim_text", sa.Text(), nullable=True),
        sa.Column("provenance", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("start_ms >= 0 AND end_ms >= start_ms", name="ck_evidence_spans_time"),
        sa.CheckConstraint("resolution_state IN ('CONSENSUS','DISPUTED','HUMAN_VERIFIED','UNRESOLVED','OVERLAP')", name="ck_evidence_spans_resolution"),
    )
    op.create_index("ix_evidence_spans_recording_time", "evidence_spans", ["recording_id", "start_ms", "end_ms"])
    op.create_index("ix_evidence_spans_revision_id", "evidence_spans", ["revision_id"])

    op.create_table(
        "provider_tokens",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("provider_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("provider_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("raw_token", sa.Text(), nullable=False),
        sa.Column("start_ms", sa.BigInteger(), nullable=False),
        sa.Column("end_ms", sa.BigInteger(), nullable=False),
        sa.Column("confidence_metadata", postgresql.JSONB(), nullable=True),
        sa.Column("evidence_span_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("evidence_spans.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("resolution_state", sa.String(30), nullable=False),
        sa.CheckConstraint("start_ms >= 0 AND end_ms >= start_ms", name="ck_provider_tokens_time"),
        sa.CheckConstraint("length(trim(raw_token)) > 0", name="ck_provider_tokens_nonempty"),
        sa.CheckConstraint("resolution_state IN ('CONSENSUS','DISPUTED','HUMAN_VERIFIED')", name="ck_provider_tokens_resolution"),
    )
    op.create_index("ix_provider_tokens_run", "provider_tokens", ["provider_run_id"])
    op.create_index("ix_provider_tokens_span", "provider_tokens", ["evidence_span_id"])

    op.create_table(
        "review_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("evidence_span_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("evidence_spans.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("reviewer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("before_value", sa.Text(), nullable=True),
        sa.Column("after_value", sa.Text(), nullable=True),
        sa.Column("audio_region", postgresql.JSONB(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_review_events_span", "review_events", ["evidence_span_id", "reviewed_at"])

    op.create_table(
        "benchmark_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("dataset_version", sa.String(200), nullable=False),
        sa.Column("split", sa.String(20), nullable=False),
        sa.Column("commit_sha", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(60), nullable=False),
        sa.Column("model", sa.String(120), nullable=False),
        sa.Column("locale", sa.String(20), nullable=False),
        sa.Column("parameters", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("sample_count", sa.Integer(), nullable=False),
        sa.Column("audio_hours", sa.Float(), nullable=True),
        sa.Column("raw_wer", sa.Float(), nullable=True),
        sa.Column("normalized_wer", sa.Float(), nullable=True),
        sa.Column("raw_cer", sa.Float(), nullable=True),
        sa.Column("normalized_cer", sa.Float(), nullable=True),
        sa.Column("critical_entity_accuracy", postgresql.JSONB(), nullable=True),
        sa.Column("der", sa.Float(), nullable=True),
        sa.Column("der_protocol", postgresql.JSONB(), nullable=True),
        sa.Column("service_rtf", postgresql.JSONB(), nullable=True),
        sa.Column("inference_rtf", postgresql.JSONB(), nullable=True),
        sa.Column("end_to_end_rtf", postgresql.JSONB(), nullable=True),
        sa.Column("environment", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("ground_truth_status", sa.String(40), nullable=False),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("split IN ('development','held_out')", name="ck_benchmark_runs_split"),
        sa.CheckConstraint("sample_count > 0", name="ck_benchmark_runs_sample_count"),
        sa.CheckConstraint("ground_truth_status = 'HUMAN VERIFIED'", name="ck_benchmark_runs_human_gt"),
    )
    op.create_index("ix_benchmark_runs_dataset_split", "benchmark_runs", ["dataset_version", "split", "locale"])
    op.create_index("ix_benchmark_runs_commit", "benchmark_runs", ["commit_sha"])

    op.create_table(
        "pdf_artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("recording_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("recordings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("transcript_revision_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("transcript_revisions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("transcript_sha256", sa.String(64), nullable=False),
        sa.Column("summary_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("summaries.id", ondelete="SET NULL"), nullable=True),
        sa.Column("type", sa.String(40), nullable=False),
        sa.Column("pdf_sha256", sa.String(64), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("type IN ('summary','transcript','complete_case')", name="ck_pdf_artifacts_type"),
        sa.CheckConstraint("status IN ('generated','failed')", name="ck_pdf_artifacts_status"),
    )
    op.create_index("ix_pdf_artifacts_recording_revision", "pdf_artifacts", ["recording_id", "transcript_revision_id"])


def downgrade() -> None:
    op.drop_index("ix_pdf_artifacts_recording_revision", table_name="pdf_artifacts")
    op.drop_table("pdf_artifacts")
    op.drop_index("ix_benchmark_runs_commit", table_name="benchmark_runs")
    op.drop_index("ix_benchmark_runs_dataset_split", table_name="benchmark_runs")
    op.drop_table("benchmark_runs")
    op.drop_index("ix_review_events_span", table_name="review_events")
    op.drop_table("review_events")
    op.drop_index("ix_provider_tokens_span", table_name="provider_tokens")
    op.drop_index("ix_provider_tokens_run", table_name="provider_tokens")
    op.drop_table("provider_tokens")
    op.drop_index("ix_evidence_spans_revision_id", table_name="evidence_spans")
    op.drop_index("ix_evidence_spans_recording_time", table_name="evidence_spans")
    op.drop_table("evidence_spans")
    op.drop_index("ix_derived_audio_recording_id", table_name="derived_audio")
    op.drop_table("derived_audio")
