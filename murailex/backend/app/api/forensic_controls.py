from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, jobs, storage
from ..db import get_db
from ..forensic_models import ProviderSelfTest
from ..models import Job, Recording, TranscriptRevision
from ..providers import registry
from ..security import Principal, current_principal, load_recording, require_admin
from .common import iso, parse_uuid, recording_out

router = APIRouter(prefix="/api")

LOCALE_PATTERN = r"^(ar|ar-YE|ar-EG|ar-SY|ar-LB|ar-IQ)$"


class LocaleIn(BaseModel):
    language_locale: str = Field(pattern=LOCALE_PATTERN)


def _active_processing(db: Session, recording_id) -> bool:
    return bool(
        db.execute(
            select(Job.id).where(
                Job.recording_id == recording_id,
                Job.kind == "process_recording",
                Job.status.in_(["queued", "running"]),
            )
        ).first()
    )


@router.patch("/recordings/{recording_id}/locale")
def repair_locale(
    recording_id: str,
    body: LocaleIn,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    rec = load_recording(db, p, parse_uuid(recording_id), "upload")
    if db.execute(
        select(TranscriptRevision.id).where(TranscriptRevision.recording_id == rec.id)
    ).first():
        raise HTTPException(409, "Locale is immutable after a transcript revision exists.")
    if _active_processing(db, rec.id):
        raise HTTPException(409, "Locale cannot be changed while processing is active.")
    before = rec.language_locale
    original_sha256 = rec.sha256
    rec.language_locale = body.language_locale
    if rec.id != parse_uuid(recording_id) or rec.sha256 != original_sha256:
        raise HTTPException(500, "Recording identity or original SHA-256 changed during locale repair.")
    audit.record(
        db,
        "recording_locale_updated",
        actor=p.user,
        recording_id=rec.id,
        details={
            "before": before,
            "after": body.language_locale,
            "original_sha256": rec.sha256,
            "same_recording_id": str(rec.id),
        },
    )
    db.commit()
    return {"recording": recording_out(rec)}


def _engine_rows(db: Session, rec: Recording) -> list[dict[str, Any]]:
    locale = rec.language_locale
    if locale not in registry.SUPPORTED_LOCALES:
        return []
    context = {
        "recording_id": str(rec.id),
        "language_locale": locale,
        "expected_terms": rec.expected_terms,
        "expected_speakers": rec.expected_speakers,
    }
    return [
        registry.engine_state(db, adapter, role, locale, context)
        for adapter, role in registry.routed_adapters(locale)
    ]


@router.get("/recordings/{recording_id}/preflight")
def preflight(
    recording_id: str,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    rec: Recording = load_recording(db, p, parse_uuid(recording_id))
    blockers: list[dict[str, Any]] = []
    locale = rec.language_locale
    if locale not in registry.SUPPORTED_LOCALES:
        blockers.append(
            {
                "code": "INVALID_LOCALE",
                "reason": "A valid language_locale is required before processing.",
                "required": sorted(registry.SUPPORTED_LOCALES),
            }
        )
    if not rec.storage_key:
        blockers.append({"code": "MISSING_SOURCE_AUDIO", "reason": "Original source audio is not defined."})
    if not rec.sha256 or len(rec.sha256) != 64:
        blockers.append({"code": "MISSING_ORIGINAL_SHA256", "reason": "Original SHA-256 is missing."})

    original_verified = False
    if rec.storage_key and rec.sha256:
        try:
            observed_sha, observed_size = storage.sha256_of_object(rec.storage_key, rec.storage_version_id)
            original_verified = observed_sha == rec.sha256 and observed_size == rec.byte_size
            if not original_verified:
                blockers.append(
                    {
                        "code": "ORIGINAL_INTEGRITY_FAILURE",
                        "reason": "Original object SHA-256 or byte size does not match ingestion metadata.",
                    }
                )
        except Exception as exc:  # noqa: BLE001
            blockers.append(
                {
                    "code": "ORIGINAL_NOT_ACCESSIBLE",
                    "reason": f"Original audio is not accessible: {type(exc).__name__}.",
                }
            )

    active = _active_processing(db, rec.id)
    if active:
        blockers.append({"code": "DUPLICATE_PROCESSING", "reason": "An active processing job already exists."})

    engines: list[dict[str, Any]] = []
    if locale in registry.SUPPORTED_LOCALES:
        try:
            engines = _engine_rows(db, rec)
        except Exception as exc:  # noqa: BLE001
            blockers.append(
                {
                    "code": "INVALID_ENGINE_ROUTING",
                    "reason": f"Engine routing is invalid: {type(exc).__name__}: {exc}",
                }
            )
        roles = {row["role"] for row in engines}
        missing_roles = sorted({"primary_asr", "diarization", "verification_asr"} - roles)
        if missing_roles:
            blockers.append(
                {
                    "code": "MISSING_REQUIRED_ENGINES",
                    "reason": "Required forensic engines are not fully defined for this locale.",
                    "missing_roles": missing_roles,
                }
            )
        for state in engines:
            if state["status"] != "READY":
                blockers.append(
                    {
                        "code": "ENGINE_BLOCKED",
                        "internal_id": state["internal_id"],
                        "provider": state["provider"],
                        "model": state["model"],
                        "locale": state["locale"],
                        "status": state["status"],
                        "reason": state["blocker"],
                        "required_environment_variables": state["required_environment_variables"],
                    }
                )

    return {
        "recording_id": str(rec.id),
        "language_locale": locale,
        "original_sha256": rec.sha256,
        "original_sha256_verified": original_verified,
        "duplicate_processing": active,
        "engines": engines,
        "blockers": blockers,
        "pass": not blockers,
    }


def _self_test_out(test: ProviderSelfTest) -> dict[str, Any]:
    return {
        "id": str(test.id),
        "provider": test.provider,
        "model": test.model,
        "locale": test.locale,
        "role": test.role,
        "status": test.status,
        "provider_run_id": str(test.provider_run_id) if test.provider_run_id else None,
        "latency_ms": test.latency_ms,
        "error": test.error,
        "started_at": iso(test.started_at),
        "completed_at": iso(test.completed_at),
    }


@router.post("/recordings/{recording_id}/engine-self-tests")
def start_engine_self_tests(
    recording_id: str,
    p: Principal = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rec = load_recording(db, p, parse_uuid(recording_id), "upload")
    locale = rec.language_locale
    if locale not in registry.SUPPORTED_LOCALES:
        raise HTTPException(409, "A valid language_locale is required before provider self-tests.")
    if not rec.storage_key or not rec.sha256:
        raise HTTPException(409, "Original audio and original SHA-256 are required before provider self-tests.")

    tests: list[ProviderSelfTest] = []
    try:
        routed = registry.routed_adapters(locale)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(409, f"Engine routing is invalid: {type(exc).__name__}: {exc}") from exc
    if not routed:
        raise HTTPException(409, "No required engines are defined for this locale.")

    for adapter, role in routed:
        spec = registry.engine_spec(adapter, role, locale)
        test = ProviderSelfTest(
            provider=spec.provider,
            model=spec.model,
            locale=spec.locale,
            role=spec.role,
            recording_id=rec.id,
            status="BLOCKED",
            error="Real provider self-test is queued and has not passed yet.",
            requested_by=p.user.id,
        )
        db.add(test)
        db.flush()
        jobs.enqueue(
            db,
            "provider_self_test",
            rec.id,
            {"self_test_id": str(test.id)},
        )
        tests.append(test)

    audit.record(
        db,
        "provider_self_tests_requested",
        actor=p.user,
        recording_id=rec.id,
        details={
            "language_locale": locale,
            "self_test_ids": [str(test.id) for test in tests],
            "engine_count": len(tests),
        },
    )
    db.commit()
    return {"self_tests": [_self_test_out(test) for test in tests]}


@router.get("/recordings/{recording_id}/engine-self-tests")
def list_engine_self_tests(
    recording_id: str,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    rec = load_recording(db, p, parse_uuid(recording_id))
    tests = list(
        db.execute(
            select(ProviderSelfTest)
            .where(ProviderSelfTest.recording_id == rec.id)
            .order_by(ProviderSelfTest.started_at.desc())
        ).scalars()
    )
    return {"self_tests": [_self_test_out(test) for test in tests]}
