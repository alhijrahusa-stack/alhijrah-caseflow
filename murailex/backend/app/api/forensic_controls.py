from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, storage
from ..config import get_settings
from ..db import get_db
from ..models import Job, Recording, TranscriptRevision
from ..providers import privacy, registry
from ..security import Principal, current_principal, load_recording
from .common import parse_uuid, recording_out

router = APIRouter(prefix="/api")

LOCALE_PATTERN = r"^(ar|ar-YE|ar-EG|ar-SY|ar-LB|ar-IQ)$"

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
    rec.language_locale = body.language_locale
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


def _engine_state(adapter, locale: str) -> dict[str, Any]:
    name = adapter.name
    context = {"language_locale": locale, "expected_terms": None, "expected_speakers": None}
    info = adapter.info(context)
    credential = CREDENTIAL_ENV.get(name)
    credential_present = bool(credential and os.environ.get(credential))
    privacy_state = privacy.status(name) if name in PRIVACY_ENV else {"approved": True, "status": "NOT APPLICABLE"}
    benchmark_ok = registry.benchmark_routing_approved()
    blocker: str | None = None
    required_env: list[str] = []
    if credential and not credential_present:
        blocker = "Required provider credential is not configured."
        required_env.append(credential)
    elif not privacy_state.get("approved"):
        blocker = "BLOCKED BY DATA POLICY"
        if name in PRIVACY_ENV:
            required_env.append(PRIVACY_ENV[name])
    elif not benchmark_ok and get_settings().environment != "test":
        blocker = "BLOCKED — no approved human-ground-truth benchmark routing."
        required_env.extend(
            ["BENCHMARK_ROUTING_APPROVED", "BENCHMARK_DATASET_VERSION", "BENCHMARK_HELD_OUT_RUN_ID"]
        )
    elif not info.configured:
        blocker = "Provider adapter is not configured for this routing context."
    return {
        "provider": name,
        "model": info.model,
        "locale": locale,
        "status": "READY_FOR_DISPATCH" if blocker is None and info.configured else "BLOCKED",
        "blocker": blocker,
        "required_environment_variables": required_env,
        "parameters": info.parameters,
    }


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
    if not rec.sha256 or len(rec.sha256) != 64:
        blockers.append({"code": "MISSING_ORIGINAL_SHA256", "reason": "Original SHA-256 is missing."})
    original_verified = False
    if rec.sha256:
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
        routed = (
            [(adapter, "primary_asr") for adapter in registry.primary_asr(locale)]
            + [(adapter, "diarization") for adapter in registry.diarization()]
            + [(adapter, "verification_asr") for adapter in registry.verification_asr(locale)]
        )
        for adapter, role in routed:
            state = _engine_state(adapter, locale)
            state["role"] = role
            engines.append(state)
            if state["status"] != "READY_FOR_DISPATCH":
                blockers.append(
                    {
                        "code": "ENGINE_BLOCKED",
                        "provider": state["provider"],
                        "model": state["model"],
                        "locale": locale,
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
