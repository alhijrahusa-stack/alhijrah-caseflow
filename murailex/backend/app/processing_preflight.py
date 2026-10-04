from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, storage
from .config import get_settings
from .models import Job, Recording
from .providers import registry
from .providers.base import ProviderError


def _block(
    db: Session,
    rec: Recording,
    reason: str,
    details: dict[str, Any],
    *,
    status: str = "failed",
) -> None:
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
    """Fail closed before any production provider dispatch."""
    settings = get_settings()
    if settings.environment == "test":
        return {"pass": True, "test_environment": True}

    persisted = db.get(Recording, rec.id)
    if persisted is None:
        raise ProviderError("Recording does not exist.", retryable=False)
    rec = persisted

    if rec.language_locale not in registry.SUPPORTED_LOCALES:
        _block(
            db,
            rec,
            "A valid language_locale is required before processing.",
            {"code": "INVALID_LOCALE", "language_locale": rec.language_locale},
        )
    if not rec.storage_key:
        _block(db, rec, "Original source audio is not defined.", {"code": "MISSING_SOURCE_AUDIO"})
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
    try:
        routed = registry.routed_adapters(locale)
    except Exception as exc:  # noqa: BLE001
        _block(
            db,
            rec,
            f"Engine routing is invalid: {type(exc).__name__}: {exc}",
            {"code": "INVALID_ENGINE_ROUTING"},
            status="provider_not_configured",
        )

    roles = {role for _, role in routed}
    missing_roles = sorted(registry.required_roles() - roles)
    if not routed or missing_roles:
        _block(
            db,
            rec,
            "Required forensic engines are not fully defined for this locale.",
            {"code": "MISSING_REQUIRED_ENGINES", "missing_roles": missing_roles},
            status="provider_not_configured",
        )

    context = {
        "recording_id": str(rec.id),
        "language_locale": locale,
        "expected_terms": rec.expected_terms,
        "expected_speakers": rec.expected_speakers,
    }
    blocked: list[dict[str, Any]] = []
    ready_ids: list[str] = []
    for adapter, role in routed:
        state = registry.engine_state(db, adapter, role, locale, context)
        if state["status"] == "READY":
            ready_ids.append(state["internal_id"])
            continue
        blocked.append(
            {
                "internal_id": state["internal_id"],
                "provider": state["provider"],
                "model": state["model"],
                "role": role,
                "locale": locale,
                "status": state["status"],
                "reason": state["blocker"],
                "required_environment_variables": state["required_environment_variables"],
            }
        )
    if blocked and registry.local_mode():
        from .local_canary import ensure_engine_self_tests, pending_self_test
        from .pipeline.process import Wait
        from .providers.privacy import LOCAL_PROVIDERS

        def all_pending() -> bool:
            return all(pending_self_test(db, row["provider"], row["model"], locale, row["role"]) for row in blocked)

        # A local route that is merely unvalidated (new or changed fingerprint, no self-test yet)
        # gets its real self-test queued here, so a job reaching preflight before the worker's
        # startup validation pass waits instead of failing. FAILED/NOT_CONFIGURED still block.
        if not all_pending() and all(row["status"] == "BLOCKED" and row["provider"] in LOCAL_PROVIDERS for row in blocked):
            ensure_engine_self_tests()
            db.expire_all()
        if all_pending():
            # Automatic engine validation is running; wait for it instead of failing the upload.
            rec.status = "queued"
            rec.status_detail = "Waiting for automatic engine validation"
            db.commit()
            raise Wait(15.0, "engine self-test in progress")
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
            "ready_engine_ids": ready_ids,
            "benchmark_dataset_version": settings.benchmark_dataset_version,
            "benchmark_held_out_run_id": settings.benchmark_held_out_run_id,
            "benchmark_routing": registry.LOCAL_BENCHMARK_LABEL if registry.personal_local() else "APPROVED",
        },
    )
    db.commit()
    return {
        "pass": True,
        "engine_count": len(routed),
        "ready_engine_ids": ready_ids,
        "original_sha256_verified": True,
    }
