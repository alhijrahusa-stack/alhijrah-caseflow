from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from . import audit, storage
from .forensic_models import ProviderSelfTest
from .models import ProviderRun, Recording
from .pipeline.process import Wait, drive_run, ensure_derived
from .providers import registry
from .providers.base import AsrAdapter, DiarizationAdapter, ProviderError


def _now() -> datetime:
    return datetime.now(timezone.utc)


def routed_adapters(locale: str) -> list[tuple[AsrAdapter | DiarizationAdapter, str]]:
    return (
        [(adapter, "primary_asr") for adapter in registry.primary_asr(locale)]
        + [(adapter, "diarization") for adapter in registry.diarization()]
        + [(adapter, "verification_asr") for adapter in registry.verification_asr(locale)]
    )


def _selected_adapter(test: ProviderSelfTest, locale: str) -> AsrAdapter | DiarizationAdapter:
    matches = [
        adapter
        for adapter, role in routed_adapters(locale)
        if adapter.name == test.provider and role == test.role and adapter.info({"language_locale": locale}).model == test.model
    ]
    if len(matches) != 1:
        raise ProviderError("Self-test route no longer matches the active engine registry.", retryable=False)
    return matches[0]


def _validate_normalized(role: str, normalized: dict[str, Any] | None) -> dict[str, Any]:
    normalized = normalized or {}
    token_count = len(normalized.get("tokens") or [])
    turn_count = len(normalized.get("turns") or [])
    if role in {"primary_asr", "verification_asr"} and token_count == 0:
        raise ProviderError("Real self-test response parsed successfully but contained no ASR tokens.", retryable=False)
    if role == "diarization" and turn_count == 0:
        raise ProviderError("Real self-test response parsed successfully but contained no diarization turns.", retryable=False)
    return {"token_count": token_count, "turn_count": turn_count}


def run_provider_self_test(db: Session, test: ProviderSelfTest) -> None:
    rec = db.get(Recording, test.recording_id)
    if rec is None:
        test.status = "FAILED"
        test.error = "Authorized canary recording no longer exists."
        test.completed_at = _now()
        db.commit()
        return
    locale = rec.language_locale
    if locale not in registry.SUPPORTED_LOCALES:
        test.status = "BLOCKED"
        test.error = "Authorized canary recording has no valid language_locale."
        test.completed_at = _now()
        db.commit()
        return

    adapter = _selected_adapter(test, locale)
    info = adapter.info(
        {
            "language_locale": locale,
            "expected_terms": rec.expected_terms,
            "expected_speakers": rec.expected_speakers,
        }
    )
    if not info.configured:
        test.status = "BLOCKED"
        test.error = str(info.parameters.get("benchmark_gate") or "Provider is not configured for this exact route.")
        test.completed_at = _now()
        db.commit()
        return

    derived = ensure_derived(db, rec)
    work_dir = os.path.join(os.environ.get("MURAILEX_WORK_DIR", "/tmp/murailex-work"), str(rec.id))
    analysis_wav = os.path.join(work_dir, "analysis.wav")
    analysis_flac = os.path.join(work_dir, "analysis.flac")
    if not os.path.exists(analysis_wav):
        storage.download_to(derived["analysis_wav"]["key"], analysis_wav)
    if not os.path.exists(analysis_flac):
        storage.download_to(derived["analysis_flac"]["key"], analysis_flac)
    audio_path = analysis_flac if adapter.name == "google_chirp3" else analysis_wav
    input_sha = derived["analysis_flac" if adapter.name == "google_chirp3" else "analysis_wav"]["sha256"]
    context = {
        "recording_id": str(rec.id),
        "language_locale": locale,
        "expected_terms": rec.expected_terms,
        "expected_speakers": rec.expected_speakers,
        "derived_sha256": input_sha,
        "input_sha256": input_sha,
    }
    try:
        run = drive_run(
            db,
            rec,
            adapter,  # type: ignore[arg-type]
            test.role,
            audio_path,
            context,
            scope=f"self-test:{test.id}",
        )
    except Wait:
        raise
    except Exception as exc:
        test = db.get(ProviderSelfTest, test.id)
        assert test is not None
        test.status = "FAILED"
        test.error = f"{type(exc).__name__}: {exc}"[:1000]
        test.completed_at = _now()
        db.commit()
        return

    test = db.get(ProviderSelfTest, test.id)
    assert test is not None
    if run is None:
        test.status = "FAILED"
        test.error = "Provider run did not produce a persisted result."
        test.completed_at = _now()
        db.commit()
        return
    test.provider_run_id = run.id
    if run.status == "not_configured":
        test.status = "NOT_CONFIGURED"
        test.error = run.error or "Provider route is not configured."
    elif run.status == "failed":
        test.status = "FAILED"
        test.error = run.error or "Provider request failed."
    elif run.status == "succeeded":
        parsed = _validate_normalized(test.role, run.normalized)
        test.status = "READY"
        test.error = None
        if run.started_at and run.finished_at:
            test.latency_ms = max(0, int((run.finished_at - run.started_at).total_seconds() * 1000))
        test.response_metadata = {
            "provider_run_id": str(run.id),
            "actual_persisted_model": run.model,
            "requested_locale": locale,
            "parameters": run.parameters,
            **parsed,
        }
    else:
        raise Wait(2.0, f"self-test provider run status {run.status}")
    test.completed_at = _now()
    audit.record(
        db,
        "provider_self_test_completed",
        actor_label="system",
        recording_id=rec.id,
        details={
            "self_test_id": str(test.id),
            "provider": test.provider,
            "model": test.model,
            "locale": test.locale,
            "role": test.role,
            "status": test.status,
            "latency_ms": test.latency_ms,
            "provider_run_id": str(run.id),
        },
    )
    db.commit()
