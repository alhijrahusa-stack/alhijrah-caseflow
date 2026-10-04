from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base
from .models import new_id, utcnow


class DerivedAudio(Base):
    __tablename__ = "derived_audio"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    recording_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("recordings.id"), nullable=False)
    parent_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    derived_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    transformation: Mapped[str] = mapped_column(Text, nullable=False)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EvidenceSpan(Base):
    __tablename__ = "evidence_spans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    recording_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("recordings.id"), nullable=False)
    revision_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("transcript_revisions.id"))
    start_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    end_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    speaker_id: Mapped[str | None] = mapped_column(String(20))
    overlap_state: Mapped[str] = mapped_column(String(30), nullable=False, default="none")
    provider_a_text: Mapped[str | None] = mapped_column(Text)
    provider_b_text: Mapped[str | None] = mapped_column(Text)
    comparison_value: Mapped[str | None] = mapped_column(Text)
    resolution_state: Mapped[str] = mapped_column(String(30), nullable=False)
    critical_flags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    final_verbatim_text: Mapped[str | None] = mapped_column(Text)
    provenance: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProviderToken(Base):
    __tablename__ = "provider_tokens"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    provider_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("provider_runs.id"), nullable=False)
    raw_token: Mapped[str] = mapped_column(Text, nullable=False)
    start_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    end_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    confidence_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    evidence_span_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("evidence_spans.id"), nullable=False)
    resolution_state: Mapped[str] = mapped_column(String(30), nullable=False)


class ReviewEvent(Base):
    __tablename__ = "review_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    evidence_span_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("evidence_spans.id"), nullable=False)
    reviewer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    before_value: Mapped[str | None] = mapped_column(Text)
    after_value: Mapped[str | None] = mapped_column(Text)
    audio_region: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BenchmarkRun(Base):
    __tablename__ = "benchmark_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    dataset_version: Mapped[str] = mapped_column(String(200), nullable=False)
    split: Mapped[str] = mapped_column(String(20), nullable=False)
    commit_sha: Mapped[str] = mapped_column(String(64), nullable=False)
    provider: Mapped[str] = mapped_column(String(60), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    locale: Mapped[str] = mapped_column(String(20), nullable=False)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False)
    audio_hours: Mapped[float | None] = mapped_column(Float)
    raw_wer: Mapped[float | None] = mapped_column(Float)
    normalized_wer: Mapped[float | None] = mapped_column(Float)
    raw_cer: Mapped[float | None] = mapped_column(Float)
    normalized_cer: Mapped[float | None] = mapped_column(Float)
    critical_entity_accuracy: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    der: Mapped[float | None] = mapped_column(Float)
    der_protocol: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    service_rtf: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    inference_rtf: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    end_to_end_rtf: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    environment: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    ground_truth_status: Mapped[str] = mapped_column(String(40), nullable=False)
    executed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PdfArtifact(Base):
    __tablename__ = "pdf_artifacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    recording_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("recordings.id"), nullable=False)
    transcript_revision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("transcript_revisions.id"), nullable=False)
    transcript_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    summary_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("summaries.id"))
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    pdf_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProviderSelfTest(Base):
    __tablename__ = "provider_self_tests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_id)
    provider: Mapped[str] = mapped_column(String(60), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    locale: Mapped[str] = mapped_column(String(20), nullable=False)
    role: Mapped[str] = mapped_column(String(40), nullable=False)
    recording_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("recordings.id"), nullable=False)
    provider_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("provider_runs.id"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="BLOCKED")
    latency_ms: Mapped[int | None] = mapped_column(BigInteger)
    response_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    requested_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


__all__ = [
    "BenchmarkRun",
    "DerivedAudio",
    "EvidenceSpan",
    "PdfArtifact",
    "ProviderSelfTest",
    "ProviderToken",
    "ReviewEvent",
]
