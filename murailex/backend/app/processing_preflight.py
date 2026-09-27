from __future__ import annotations

import os
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, storage
from .config import get_settings
from .models import Job, Recording
from .providers import privacy, registry
from .providers.base import ProviderError

CREDENTIAL_ENV = {
    "assemblyai": "ASSEMBLYAI_API_KEY",
    "google_chirp3": "GOOGLE_CREDENTIALS_JSON",
    "deepgram": "DEEPGRAM_API_KEY",
    "openai": "OPENAI_API_KEY",
    "pyannoteai": "PYANNOTE_API_KEY",
}
PRIVACY_ENV = {
    "assemblyai": "ASSEMBLYAI_LEGAL_AUDIO_APPROVED",
    "google_chirp3": "GOOGLE_LEGAL_AUDIO_APPROVED",
    "deepgram": "DEEPGRAM_LEGAL_AUDIO_APPROVED",
    "openai": "OPENAI_LEGAL_AUDIO_APPROVED",
    "pyannoteai": "PYANNOTE_LEGAL_AUDIO_APPROVED",
}


def _block(db: Session, rec: Recording, reason: str, details: dict[str, Any], *, status: str = "failed") -> None:
    rec.status = status
    rec.status_detail = reason[:500]
    audit.record(
        db,
        "processing_preflight_blocked",
        actor_label="system",
        recording_id=rec.id,
        details={"reason": reason, **details},
    )
    db.commit()
    raise ProviderError(reason, retryable=False)


def enforce_processing_preflight(
    db: Session,
    rec: Recording,
    *,
    current_job_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Fail closed before any production provider dispatch.

    Automated fixture tests retain the deterministic test pipeline and never use this
    production credential/privacy/benchmark gate.
    """
    settings = get_settings()
    if settings.environment == "test":
        return {"pass": True, "test_environment": True}

    if rec.language_locale not in registry.SUPPORTED_LOCALES:
        _block(
            db,
            rec,
            "A valid language_locale is required before processing.",
            {"code": "INVALID_LOCALE", "language_locale": rec.language_locale},
        )
    if not rec.sha256 or len(rec.sha256) != 64:
        _block(db, rec, "Original SHA-256 is missing.", {"code": "MISSING_ORIGINAL_SHA256"})

    q = select(Job.id).where(
        Job.recording_id == rec.id,
        Job.kind == "process_recording",
        Job.status.in_(["queued", "running"]),
    )
    if current_job_id is not None:
        q = q.where(Job.id != current_job_id)
    if db.execute(q).first():
        _block(
            db,
            rec,
            "Duplicate active processing is forbidden.",
            {"code": "DUPLICATE_PROCESSING"},
        )

    try:
        observed_sha, observed_size = storage.sha256_of_object(rec.storage_key, rec.storage_version_id)
    except Exception as exc:  # noqa: BLE001
        _block(
            db,
            rec,
            f"Original audio is not accessible: {type(exc).__name__}.",
            {"code": "ORIGINAL_NOT_ACCESSIBLE"},
        )
    if observed_sha != rec.sha256 or observed_size != rec.byte_size:
        _block(
            db,
            rec,
            "Original evidence integrity verification failed.",
            {
                "code": "ORIGINAL_INTEGRITY_FAILURE",
                "expected_sha256": rec.sha256,
                "observed_sha256": observed_sha,
                "expected_bytes": rec.byte_size,
                "observed_bytes": observed_size,
            },
        )

    locale = rec.language_locale
    assert locale is not None
    routed = (
        [(a, "primary_asr") for a in registry.primary_asr(locale)]
        + [(a, "diarization") for a in registry.diarization()]
        + [(a, "verification_asr") for a in registry.verification_asr(locale)]
    )
    context = {
        "recording_id": str(rec.id),
        "language_locale": locale,
        "expected_terms": rec.expected_terms,
        "expected_speakers": rec.expected_speakers,
    }
    blocked: list[dict[str, Any]] = []
    for adapter, role in routed:
        name = adapter.name
        credential = CREDENTIAL_ENV.get(name)
        required: list[str] = []
        reason: str | None = None
        if credential and not os.environ.get(credential):
            reason = "required credential is not configured"
            required.append(credential)
        elif name in PRIVACY_ENV and privacy.status(name) != "APPROVED":
            reason = "BLOCKED BY DATA POLICY"
            required.append(PRIVACY_ENV[name])
        elif not registry.benchmark_routing_approved():
            reason = "human-ground-truth benchmark routing is not approved"
            required.extend(
                ["BENCHMARK_ROUTING_APPROVED", "BENCHMARK_DATASET_VERSION", "BENCHMARK_HELD_OUT_RUN_ID"]
            )
        elif not adapter.info(context).configured:
            reason = "adapter is not configured for the exact production route"
        if reason:
            blocked.append(
                {
                    "provider": name,
                    "model": adapter.info(context).model,
                    "role": role,
                    "locale": locale,
                    "reason": reason,
                    "required_environment_variables": required,
                }
            )
    if blocked:
        _block(
            db,
            rec,
            "Required forensic engine preflight failed.",
            {"code": "ENGINE_PREFLIGHT_BLOCKED", "engines": blocked},
            status="provider_not_configured",
        )

    audit.record(
        db,
        "processing_preflight_passed",
        actor_label="system",
        recording_id=rec.id,
        details={
            "language_locale": locale,
            "original_sha256_verified": True,
            "engine_count": len(routed),
            "benchmark_dataset_version": settings.benchmark_dataset_version,
            "benchmark_held_out_run_id": settings.benchmark_held_out_run_id,
        },
    )
    db.commit()
    return {"pass": True, "engine_count": len(routed), "original_sha256_verified": True}
