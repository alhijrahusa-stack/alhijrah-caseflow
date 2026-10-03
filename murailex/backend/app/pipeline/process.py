"""Durable, checkpointed forensic processing for one recording.

Provider calls are persisted before and after execution so processing resumes from the
last checkpoint. The original recording is immutable and verified by SHA-256 before any
derived audio is used.

Primary-token invariant: different providers may emit different token counts. Every
non-empty token emitted by every Primary must remain traceable through deterministic
alignment and must finish in a classified consensus/disputed path. No token-count voting,
provider preference, semantic reconstruction, or silent deletion is permitted.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audio, audio_quality, audit, storage
from ..config import get_settings
from ..models import Dispute, ProviderRun, Recording, TranscriptRevision
from ..providers import registry
from ..providers.base import AsrAdapter, NotConfigured, Pending, ProviderError
from . import consensus as cons
from . import transcript as tx
from . import verification as xv

log = logging.getLogger("murailex.pipeline")

PIPELINE_VERSION = "murailex.pipeline/2"
ALIGNMENT_VERSION = "murailex.align/1"

WORK_ROOT = os.environ.get("MURAILEX_WORK_DIR", os.path.join(tempfile.gettempdir(), "murailex-work"))


class Wait(Exception):
    def __init__(self, seconds: float, reason: str):
        super().__init__(reason)
        self.seconds = seconds


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _workdir(rec: Recording) -> str:
    d = os.path.join(WORK_ROOT, str(rec.id))
    os.makedirs(d, mode=0o700, exist_ok=True)
    return d


def _set_status(db: Session, rec: Recording, status: str, detail: str | None = None) -> None:
    rec.status = status
    rec.status_detail = detail
    db.commit()


def _run_status(run: ProviderRun | None) -> str:
    return run.status if run is not None else "missing"


def _token_identity(run_id: str, token: dict[str, Any]) -> tuple[str, str, int, int]:
    return (
        run_id,
        str(token.get("text") or ""),
        int(token.get("start_ms") or 0),
        int(token.get("end_ms") or 0),
    )


def _primary_trace_failures(
    primary_inputs: list[tuple[dict[str, Any], list[dict[str, Any]]]],
    columns: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return Primary tokens that disappeared from deterministic alignment provenance."""
    traced: set[tuple[str, str, int, int]] = set()
    for column in columns:
        for prov in column.get("provenance") or []:
            run_id = str(prov.get("run_id") or "")
            raw = str(prov.get("raw") or "")
            if not run_id or not raw.strip():
                continue
            traced.add(
                (
                    run_id,
                    raw,
                    int(prov.get("start_ms") or 0),
                    int(prov.get("end_ms") or 0),
                )
            )

    failures: list[dict[str, Any]] = []
    for meta, tokens in primary_inputs:
        run_id = str(meta["run_id"])
        for index, token in enumerate(tokens):
            if not str(token.get("text") or "").strip():
                continue
            if _token_identity(run_id, token) not in traced:
                failures.append(
                    {
                        "provider": meta["provider"],
                        "model": meta["model"],
                        "run_id": run_id,
                        "token_index": index,
                        "text": token.get("text"),
                        "start_ms": token.get("start_ms"),
                        "end_ms": token.get("end_ms"),
                    }
                )
    return failures


def _classification_failures(
    columns: list[dict[str, Any]],
    accepted: set[int],
    disputed_or_verified: set[int],
) -> list[int]:
    classified = accepted | disputed_or_verified
    return [int(c["index"]) for c in columns if int(c["index"]) not in classified]


def _clock(ms: int) -> str:
    sec = max(0, ms) // 1000
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def _yield_check(recording_id: Any) -> Any:
    """True when other work is waiting for the (single) worker; used between long-form windows."""
    from ..db import session_factory
    from ..models import Job

    def check() -> bool:
        try:
            with session_factory()() as s:
                now = datetime.now(timezone.utc)
                return s.execute(
                    select(Job.id).where(
                        Job.recording_id != recording_id,
                        Job.kind.in_(["process_recording", "provider_self_test"]),
                        Job.run_after <= now,
                        (Job.status == "queued") | ((Job.status == "running") & (Job.locked_until < now)),
                    ).limit(1)
                ).first() is not None
        except Exception:  # noqa: BLE001
            return False

    return check


def _progress_reporter(recording_id: Any, status: str = "transcribing", label: str = "Transcribing") -> Any:
    """Report real long-form decoding progress (windows done, audio position) on its own
    short transaction so the main processing transaction is unaffected."""
    from ..db import session_factory

    def report(done: int, total: int, decoded_ms: int, duration_ms: int) -> None:
        try:
            with session_factory()() as s:
                row = s.get(Recording, recording_id)
                if row is not None and row.status == status:
                    row.status_detail = (
                        f"{label} — window {done}/{total} · decoded {_clock(decoded_ms)} of {_clock(duration_ms)}"
                    )
                    s.commit()
        except Exception:  # noqa: BLE001 - progress is informational; never fail the job for it
            log.warning("progress update failed", exc_info=True)

    return report


# ---------------------------------------------------------------- stage 1: derive


def ensure_derived(db: Session, rec: Recording, *, announce: bool = True) -> dict[str, Any]:
    """Create derived working copies. `announce=False` (provider self-tests) leaves the
    recording's processing status untouched: a self-test is not processing."""
    wd = _workdir(rec)
    if rec.derived and rec.derived.get("analysis_wav"):
        local = os.path.join(wd, "analysis.wav")
        if not os.path.exists(local):
            storage.download_to(rec.derived["analysis_wav"]["key"], local)
        return rec.derived

    if announce:
        _set_status(db, rec, "analyzing", "Creating derived working copies")
    original = os.path.join(wd, "original.bin")
    storage.download_to(rec.storage_key, original, rec.storage_version_id)
    digest = _file_sha(original)
    if digest != rec.sha256:
        audit.record(
            db,
            "integrity_failure",
            actor_label="system",
            recording_id=rec.id,
            details={"expected_sha256": rec.sha256, "observed_sha256": digest},
        )
        db.commit()
        raise ProviderError("Original object SHA-256 does not match the recorded hash.", retryable=False)

    info = audio.probe(original)
    analysis = os.path.join(wd, "analysis.wav")
    flac = os.path.join(wd, "analysis.flac")
    playback = os.path.join(wd, "playback.m4a")
    audio.derive_analysis_wav(original, analysis)
    info = audio.with_decoded_duration(info, analysis)
    limit_ms = get_settings().max_recording_duration_seconds * 1000
    if info["duration_ms"] > limit_ms:
        os.remove(original)
        audit.record(
            db,
            "processing_blocked",
            actor_label="system",
            recording_id=rec.id,
            details={"reason": "recording_too_long", "duration_ms": info["duration_ms"], "limit_ms": limit_ms},
        )
        db.commit()
        raise ProviderError(
            f"Recording is {info['duration_ms'] / 60000:.1f} min; the configured maximum is {limit_ms / 60000:.0f} min.",
            retryable=False,
        )
    audio.derive_flac(analysis, flac)
    audio.derive_playback(original, playback)
    peaks = audio.waveform_peaks(analysis)
    silences = audio.detect_silences(analysis)
    os.remove(original)

    derived: dict[str, Any] = {"silences": silences}
    try:
        derived["quality"] = audio_quality.analyze(analysis, info)
    except Exception as exc:  # noqa: BLE001 - quality is advisory; it never stops processing
        derived["quality"] = {"version": audio_quality.VERSION, "overall": "NOT_ASSESSED", "error": f"{type(exc).__name__}: {exc}"}
    for name, path, ctype in (
        ("analysis_wav", analysis, "audio/wav"),
        ("analysis_flac", flac, "audio/flac"),
        ("playback", playback, "audio/mp4"),
    ):
        key = f"derived/{rec.id}/{os.path.basename(path)}"
        with open(path, "rb") as fh:
            storage.put_file(key, fh, ctype)
        derived[name] = {
            "key": key,
            "sha256": _file_sha(path),
            "bytes": os.path.getsize(path),
            "content_type": ctype,
        }

    peaks_key = f"derived/{rec.id}/peaks.json"
    storage.put_bytes(peaks_key, json.dumps(peaks).encode(), "application/json")
    derived["peaks"] = {"key": peaks_key}
    derived["procedure"] = {
        "analysis_wav": "ffmpeg -i ORIGINAL -vn -ac 1 -ar 16000 -c:a pcm_s16le",
        "analysis_flac": "ffmpeg -i analysis.wav -c:a flac",
        "playback": "ffmpeg -i ORIGINAL -vn -c:a aac -b:a 128k",
        "note": "Derived copies only. The original object is never modified.",
    }
    rec.derived = derived
    rec.media_info = info
    rec.duration_ms = info["duration_ms"]
    audit.record(
        db,
        "derived_copies_created",
        actor_label="system",
        recording_id=rec.id,
        details={
            "original_sha256_verified": digest,
            "media": info,
            "derived": {
                k: v.get("sha256")
                for k, v in derived.items()
                if isinstance(v, dict) and "sha256" in v
            },
        },
    )
    db.commit()
    return derived


def _file_sha(path: str) -> str:
    import hashlib

    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- provider runs


def _get_run(
    db: Session,
    rec: Recording,
    adapter: AsrAdapter,
    role: str,
    scope: str,
) -> ProviderRun | None:
    return db.execute(
        select(ProviderRun)
        .where(
            ProviderRun.recording_id == rec.id,
            ProviderRun.provider == adapter.name,
            ProviderRun.role == role,
            ProviderRun.scope_key == scope,
        )
        .order_by(ProviderRun.created_at.desc())
    ).scalars().first()


def drive_run(
    db: Session,
    rec: Recording,
    adapter: AsrAdapter,
    role: str,
    audio_path: str,
    context: dict[str, Any],
    scope: str = "full",
    window: tuple[int, int] | None = None,
) -> ProviderRun | None:
    """Advance one provider run by one step; terminal runs are never resubmitted."""
    info = adapter.info(context)
    run = _get_run(db, rec, adapter, role, scope)
    if run is not None and run.status in ("succeeded", "failed", "not_configured"):
        return run
    if not info.configured:
        if run is None:
            run = ProviderRun(
                recording_id=rec.id,
                provider=adapter.name,
                model=info.model,
                role=role,
                scope_key=scope,
                parameters=info.parameters,
                status="not_configured",
                window_start_ms=window[0] if window else None,
                window_end_ms=window[1] if window else None,
            )
            db.add(run)
            db.commit()
        return run

    if run is None:
        run = ProviderRun(
            recording_id=rec.id,
            provider=adapter.name,
            model=info.model,
            role=role,
            scope_key=scope,
            parameters=info.parameters,
            status="pending",
            input_sha256=context.get("input_sha256"),
            window_start_ms=window[0] if window else None,
            window_end_ms=window[1] if window else None,
        )
        db.add(run)
        db.commit()

    try:
        if adapter.asynchronous:
            if not run.remote_id:
                run.attempt += 1
                run.started_at = run.started_at or _now()
                run.status = "submitting"
                db.commit()
                remote = adapter.submit(audio_path, context)
                run.remote_id = remote
                run.status = "running"
                db.commit()
                audit.record(
                    db,
                    "provider_submitted",
                    actor_label="system",
                    recording_id=rec.id,
                    details={
                        "run_id": str(run.id),
                        "provider": run.provider,
                        "model": run.model,
                        "role": role,
                        "scope": scope,
                        "attempt": run.attempt,
                    },
                )
                db.commit()
            result = adapter.fetch(run.remote_id)
            if isinstance(result, Pending):
                started = run.started_at or _now()
                if (_now() - started).total_seconds() > get_settings().provider_timeout_seconds:
                    raise ProviderError(
                        f"{adapter.name} did not finish within the configured timeout",
                        retryable=False,
                    )
                raise Wait(get_settings().provider_poll_seconds, f"{adapter.name} {result.status}")
            raw = result
        else:
            run.attempt += 1
            run.started_at = run.started_at or _now()
            run.status = "running"
            db.commit()
            raw = adapter.transcribe(audio_path, context)

        normalized = adapter.normalize(raw)
        if window:
            for token in normalized.get("tokens", []):
                token["start_ms"] += window[0]
                token["end_ms"] += window[0]
        run.raw_response = raw
        run.normalized = normalized
        run.status = "succeeded"
        run.error = None
        run.finished_at = _now()
        db.commit()
        audit.record(
            db,
            "provider_completed",
            actor_label="system",
            recording_id=rec.id,
            details={
                "run_id": str(run.id),
                "provider": run.provider,
                "model": run.model,
                "role": role,
                "scope": scope,
                "tokens": len(normalized.get("tokens", [])),
                "turns": len(normalized.get("turns", [])),
            },
        )
        db.commit()
        return run
    except Wait:
        raise
    except NotConfigured:
        run.status = "not_configured"
        db.commit()
        return run
    except ProviderError as exc:
        db.rollback()
        run = db.get(ProviderRun, run.id)
        assert run is not None
        run.error = str(exc)
        permanent = not exc.retryable or run.attempt >= 4
        run.status = "failed" if permanent else "error"
        run.finished_at = _now() if permanent else None
        db.commit()
        audit.record(
            db,
            "provider_retry" if not permanent else "provider_failed",
            actor_label="system",
            recording_id=rec.id,
            details={
                "run_id": str(run.id),
                "provider": run.provider,
                "error": str(exc),
                "attempt": run.attempt,
            },
        )
        db.commit()
        if permanent:
            return run
        raise Wait(
            min(300.0, get_settings().provider_retry_base_seconds * (2**run.attempt)),
            f"{adapter.name} retry scheduled",
        ) from exc


def _derive_region_run(
    db: Session, rec: Recording, adapter: AsrAdapter, full: ProviderRun, scope: str, ws: int, we: int
) -> ProviderRun:
    """Persist the full independent pass's tokens for one region window as a region run.

    Deterministic and traceable: the run records the source run id and window; no text is
    created or changed. Idempotent: an existing terminal run for the scope is returned."""
    existing = _get_run(db, rec, adapter, "verification_asr", scope)
    if existing is not None and existing.status == "succeeded":
        return existing
    tokens = [dict(t) for t in (full.normalized or {}).get("tokens", []) if t["end_ms"] > ws and t["start_ms"] < we]
    run = existing or ProviderRun(
        recording_id=rec.id,
        provider=adapter.name,
        model=full.model,
        role="verification_asr",
        scope_key=scope,
        parameters=full.parameters,
        window_start_ms=ws,
        window_end_ms=we,
    )
    run.status = "succeeded"
    run.input_sha256 = full.input_sha256
    run.raw_response = {"method": "slice_of_full_independent_pass", "source_run_id": str(full.id), "window_ms": [ws, we]}
    run.normalized = {"tokens": tokens, "text": " ".join(t["text"] for t in tokens)}
    run.started_at = run.started_at or _now()
    run.finished_at = _now()
    if existing is None:
        db.add(run)
    db.commit()
    return run


# ---------------------------------------------------------------- main entry


def process_recording(db: Session, rec: Recording) -> None:
    s = get_settings()
    if db.execute(
        select(TranscriptRevision.id).where(TranscriptRevision.recording_id == rec.id)
    ).first():
        return

    derived = ensure_derived(db, rec)
    wd = _workdir(rec)
    analysis = os.path.join(wd, "analysis.wav")
    flac = os.path.join(wd, "analysis.flac")
    if not os.path.exists(flac):
        storage.download_to(derived["analysis_flac"]["key"], flac)

    locale = rec.language_locale
    if registry.fixtures_enabled() and locale not in registry.SUPPORTED_LOCALES:
        locale = "ar-YE"
    if locale not in registry.SUPPORTED_LOCALES:
        _set_status(
            db,
            rec,
            "failed",
            "A supported recording locale is required before forensic processing.",
        )
        audit.record(
            db,
            "processing_blocked",
            actor_label="system",
            recording_id=rec.id,
            details={"reason": "missing_or_invalid_language_locale", "language_locale": locale},
        )
        db.commit()
        return

    ctx = {
        "recording_id": str(rec.id),
        "expected_speakers": rec.expected_speakers,
        "expected_terms": rec.expected_terms,
        "language_locale": locale,
        "derived_sha256": derived["analysis_wav"]["sha256"],
        "input_sha256": derived["analysis_wav"]["sha256"],
    }

    primaries = registry.primary_asr(locale)
    diarizers = registry.diarization()
    verifiers = registry.verification_asr(locale)
    required = (
        [(a, "primary_asr") for a in primaries]
        + [(d, "diarization") for d in diarizers]
        + [(v, "verification_asr") for v in verifiers]
    )
    missing = [(a, role) for a, role in required if not a.info(ctx).configured]
    if missing:
        for adapter, role in missing:
            drive_run(db, rec, adapter, role, analysis, ctx, scope="configuration-check")
        names = [f"{adapter.name}:{adapter.info(ctx).model}" for adapter, _ in missing]
        _set_status(
            db,
            rec,
            "provider_not_configured",
            "Required forensic provider(s) not configured: " + ", ".join(names),
        )
        audit.record(
            db,
            "processing_blocked",
            actor_label="system",
            recording_id=rec.id,
            details={
                "reason": "mandatory_provider_not_configured",
                "language_locale": locale,
                "providers": names,
            },
        )
        db.commit()
        return

    _set_status(db, rec, "transcribing", "Primary engines and diarization running")
    waits: list[Wait] = []
    runs: dict[str, ProviderRun | None] = {}
    for adapter in primaries:
        path = flac if adapter.name == "google_chirp3" else analysis
        try:
            runs[adapter.name] = drive_run(
                db, rec, adapter, "primary_asr", path, {**ctx, "on_progress": _progress_reporter(rec.id), "should_yield": _yield_check(rec.id)}
            )
        except Wait as wait:
            waits.append(wait)
    for diarizer in diarizers:
        try:
            runs[diarizer.name] = drive_run(
                db,
                rec,
                diarizer,
                "diarization",
                analysis,
                {**ctx, "on_progress": _progress_reporter(rec.id, "transcribing", "Speaker diarization")},
            )
        except Wait as wait:
            waits.append(wait)
    if waits:
        raise Wait(min(wait.seconds for wait in waits), "; ".join(str(wait) for wait in waits))

    ok_primary = [
        runs[adapter.name]
        for adapter in primaries
        if runs.get(adapter.name) and runs[adapter.name].status == "succeeded"  # type: ignore[union-attr]
    ]
    if len(ok_primary) != len(primaries):
        _set_status(
            db,
            rec,
            "failed",
            "Mandatory primary ASR engine failed; forensic consensus was not produced.",
        )
        audit.record(
            db,
            "processing_failed",
            actor_label="system",
            recording_id=rec.id,
            details={
                "reason": "mandatory_primary_failed",
                "language_locale": locale,
                "primary_status": {
                    adapter.name: _run_status(runs.get(adapter.name)) for adapter in primaries
                },
            },
        )
        db.commit()
        return

    diar_run = next(
        (
            runs[d.name]
            for d in diarizers
            if runs.get(d.name) and runs[d.name].status == "succeeded"  # type: ignore[union-attr]
        ),
        None,
    )
    if diarizers and diar_run is None:
        _set_status(db, rec, "failed", "Mandatory independent diarization failed.")
        audit.record(
            db,
            "processing_failed",
            actor_label="system",
            recording_id=rec.id,
            details={"reason": "mandatory_diarization_failed", "language_locale": locale},
        )
        db.commit()
        return

    xv_states: dict[Any, bool] | None = None
    xv_summary: dict[str, Any] | None = None
    full_by_provider: dict[str, ProviderRun] = {}
    if registry.local_mode() and verifiers:
        _set_status(db, rec, "verifying", "Independent verification pass over the full recording")
        full_runs = []
        for verifier in verifiers:
            vrun = drive_run(
                db, rec, verifier, "verification_asr", analysis,
                {
                    **ctx,
                    "on_progress": _progress_reporter(rec.id, "verifying", "Independent verification"),
                    "should_yield": _yield_check(rec.id),
                },
                scope="full",
            )
            if vrun is None or vrun.status != "succeeded":
                _set_status(db, rec, "failed", "Mandatory independent verification pass failed.")
                audit.record(db, "processing_failed", actor_label="system", recording_id=rec.id,
                             details={"reason": "mandatory_full_verification_failed", "provider": verifier.name})
                db.commit()
                return
            full_runs.append(vrun)
            full_by_provider[verifier.name] = vrun
        primary_tokens = (ok_primary[0].normalized or {}).get("tokens", []) if ok_primary and ok_primary[0] else []
        xv_states, xv_summary = xv.cross_verify(primary_tokens, (full_runs[0].normalized or {}).get("tokens", []))
        xv_summary["verifier"] = {"provider": full_runs[0].provider, "model": full_runs[0].model, "run_id": str(full_runs[0].id)}

    _set_status(db, rec, "aligning", "Aligning tokens and computing consensus")
    primary_inputs = [
        (
            {"provider": run.provider, "model": run.model, "run_id": str(run.id)},
            (run.normalized or {}).get("tokens", []),
        )
        for run in ok_primary[:2]
        if run is not None
    ]
    if diar_run is not None:
        turns = (diar_run.normalized or {}).get("turns", [])
        diar_source: dict[str, Any] = {
            "provider": diar_run.provider,
            "model": diar_run.model,
            "run_id": str(diar_run.id),
            "independent": True,
        }
    else:
        # Only reachable when the active routing defines no diarization engine (local mode):
        # speakers remain unattributed rather than inferred.
        turns = []
        diar_source = {"provider": None, "model": None, "run_id": None, "independent": False, "status": "not_performed"}
    result = cons.analyze(primary_inputs, turns, s.low_confidence_threshold)
    columns = result["columns"]
    regions = result["regions"]

    trace_failures = _primary_trace_failures(primary_inputs, columns)
    if trace_failures:
        audit.record(
            db,
            "token_conservation_failure",
            actor_label="system",
            recording_id=rec.id,
            details={
                "reason": "primary_token_missing_from_alignment_provenance",
                "language_locale": locale,
                "missing": trace_failures,
            },
        )
        rec.status = "failed"
        rec.status_detail = "Primary token traceability invariant failed."
        db.commit()
        return

    if verifiers:
        count = sum(1 for region in regions if region["requires_independent_check"])
        _set_status(db, rec, "verifying", f"Targeted reprocessing of {count} regions")

    waits = []
    for region in regions:
        if not region["requires_independent_check"] or not verifiers:
            continue
        ws = max(0, region["start_ms"] - s.context_padding_ms)
        we = min(
            rec.duration_ms or region["end_ms"] + s.context_padding_ms,
            region["end_ms"] + s.context_padding_ms,
        )
        scope = f"region:{region['start_ms']}-{region['end_ms']}"
        if all(v.name in full_by_provider for v in verifiers):
            # The independent verifier already decoded the whole recording; its reading of
            # this interval is taken from that persisted pass instead of re-decoding a clip.
            for verifier in verifiers:
                _derive_region_run(db, rec, verifier, full_by_provider[verifier.name], scope, ws, we)
            continue
        clip = os.path.join(wd, f"region-{region['start_ms']}-{region['end_ms']}.wav")
        if not os.path.exists(clip):
            audio.cut_segment(analysis, clip, ws, we)
        for verifier in verifiers:
            try:
                drive_run(
                    db,
                    rec,
                    verifier,
                    "verification_asr",
                    clip,
                    {
                        **ctx,
                        "window_start_ms": ws,
                        "window_end_ms": we,
                        "input_sha256": _file_sha(clip),
                    },
                    scope=f"region:{region['start_ms']}-{region['end_ms']}",
                    window=(ws, we),
                )
            except Wait as wait:
                waits.append(wait)
    if waits:
        raise Wait(min(wait.seconds for wait in waits), "verification pending")

    verifier_failures: list[dict[str, str]] = []
    for region in regions:
        if not region["requires_independent_check"]:
            continue
        scope = f"region:{region['start_ms']}-{region['end_ms']}"
        for verifier in verifiers:
            run = _get_run(db, rec, verifier, "verification_asr", scope)
            if run is None or run.status != "succeeded":
                verifier_failures.append(
                    {
                        "provider": verifier.name,
                        "scope": scope,
                        "status": run.status if run else "missing",
                    }
                )
    if verifier_failures:
        _set_status(
            db,
            rec,
            "failed",
            "Mandatory verification engine failed; forensic transcript was not finalized.",
        )
        audit.record(
            db,
            "processing_failed",
            actor_label="system",
            recording_id=rec.id,
            details={
                "reason": "mandatory_verifier_failed",
                "language_locale": locale,
                "failures": verifier_failures,
            },
        )
        db.commit()
        return

    _set_status(db, rec, "building", "Creating disputes and draft transcript")
    raw_speakers = [c["speaker_raw"] for c in columns] + [turn["speaker"] for turn in turns]
    smap = tx.speaker_map([c["speaker_raw"] for c in columns] or raw_speakers)
    for speaker in raw_speakers:
        if speaker is not None and speaker not in smap:
            smap[speaker] = f"S{len(smap) + 1}"

    accepted: set[int] = set()
    classified_region_columns: set[int] = set()
    region_items: list[dict[str, Any]] = []
    in_region: set[int] = set()
    disputes: list[Dispute] = []
    auto_closed = 0

    for region in regions:
        region_column_ids = {int(index) for index in region["columns"]}
        in_region.update(region_column_ids)
        needs_check = region["requires_independent_check"]
        if not needs_check:
            accepted.update(region_column_ids)
            continue

        candidates = []
        for meta, _tokens in primary_inputs:
            # Exactly the primary tokens aligned into this region's columns (never a time
            # window), so every primary token is accounted for once: in the region or outside it.
            region_tokens = [
                {"text": p["raw"], "start_ms": p["start_ms"], "end_ms": p["end_ms"], "confidence": p.get("confidence")}
                for index in sorted(region_column_ids)
                for p in columns[index]["provenance"]
                if p["run_id"] == meta["run_id"]
            ]
            candidates.append(cons.candidate(meta, region_tokens, "primary_asr"))
        for verifier in verifiers:
            run = _get_run(
                db,
                rec,
                verifier,
                "verification_asr",
                f"region:{region['start_ms']}-{region['end_ms']}",
            )
            if run is not None and run.status == "succeeded":
                norm = run.normalized or {}
                candidates.append(
                    cons.candidate(
                        {
                            "provider": run.provider,
                            "model": run.model,
                            "run_id": str(run.id),
                        },
                        cons.tokens_in_window(
                            norm.get("tokens", []),
                            region["start_ms"],
                            region["end_ms"],
                        ),
                        "verification_asr",
                        region_text=norm.get("text"),
                        region_start_ms=region["start_ms"],
                        region_end_ms=region["end_ms"],
                    )
                )
        cons.annotate_agreement(candidates)
        winner = cons.auto_resolution(region, candidates, s.low_confidence_threshold)
        speaker = (
            smap.get(region["speaker_raw"])
            if region["speaker_raw"] is not None
            else None
        )
        if winner is not None:
            auto_closed += 1
            classified_region_columns.update(region_column_ids)
            for token in winner["tokens"]:
                region_items.append(
                    {
                        "kind": "word",
                        "text": token["text"],
                        "start_ms": token["start_ms"],
                        "end_ms": token["end_ms"],
                        "speaker": speaker,
                        "risks": region["risks"],
                        "source": "unanimous_verification",
                        "review_state": "CONSENSUS",
                        "provenance": [
                            {
                                "provider": candidate["provider"],
                                "model": candidate["model"],
                                "run_id": candidate["run_id"],
                                "text": candidate["text"],
                            }
                            for candidate in candidates
                        ],
                    }
                )
            continue

        dispute = Dispute(
            recording_id=rec.id,
            ordinal=len(disputes) + 1,
            start_ms=region["start_ms"],
            end_ms=region["end_ms"],
            speaker=speaker,
            reasons=sorted(
                set(region["reasons"]) | {f"risk:{risk}" for risk in region["risks"]}
            ),
            candidates=candidates,
            status="open",
        )
        db.add(dispute)
        db.flush()
        disputes.append(dispute)
        classified_region_columns.update(region_column_ids)
        region_items.append(
            {
                "kind": "dispute",
                "dispute_id": str(dispute.id),
                "text": "",
                "start_ms": region["start_ms"],
                "end_ms": region["end_ms"],
                "speaker": speaker,
                "risks": region["risks"],
                "source": "consensus",
                "review_state": "DISPUTED",
                "provenance": [
                    {
                        "provider": candidate["provider"],
                        "model": candidate["model"],
                        "run_id": candidate["run_id"],
                        "role": candidate["role"],
                        "text": candidate["text"],
                        "tokens": candidate["tokens"],
                    }
                    for candidate in candidates
                ],
            }
        )

    for column in columns:
        if column["index"] not in in_region:
            accepted.add(column["index"])

    classification_failures = _classification_failures(
        columns,
        accepted,
        classified_region_columns,
    )
    if classification_failures:
        audit.record(
            db,
            "token_conservation_failure",
            actor_label="system",
            recording_id=rec.id,
            details={
                "reason": "aligned_column_not_classified",
                "language_locale": locale,
                "column_indices": classification_failures,
            },
        )
        rec.status = "failed"
        rec.status_detail = "Aligned token classification invariant failed."
        db.commit()
        return

    items = tx.build_items(
        columns,
        accepted,
        region_items,
        derived.get("silences", []),
        smap,
    )
    for item in items:
        if item["kind"] == "dispute":
            item["evidence_state"] = "DISPUTED"
        elif item["kind"] == "marker":
            item["evidence_state"] = "UNINTELLIGIBLE" if item.get("text") != tx.UNCLEAR_MARKERS["silence"] else "SILENCE"
        elif item.get("source") == "unanimous_verification":
            item["evidence_state"] = "CONFIRMED"
        elif xv_states is not None:
            item["evidence_state"] = "CONFIRMED" if xv_states.get(xv.token_id(item)) else "LOW_CONFIDENCE"
    segments = tx.segment(items)
    speakers = sorted(set(smap.values()), key=lambda value: int(value[1:]))
    method = {
        "primary_engines": [meta for meta, _ in primary_inputs],
        "diarization": diar_source,
        "verification_engines": [
            {"provider": verifier.name, "model": verifier.info(ctx).model}
            for verifier in verifiers
        ],
        "single_engine_mode": result["single_engine"],
        "benchmark_routing": registry.LOCAL_BENCHMARK_LABEL if registry.local_mode() else "APPROVED",
        "primary_coverage": [
            {"provider": run.provider, "model": run.model, **((run.normalized or {}).get("coverage") or {})}
            for run in ok_primary[:2]
            if run is not None
        ],
        "language_locale": locale,
        "confidence_policy": "provenance_only_no_acceptance_gate",
        "context_padding_ms": s.context_padding_ms,
        "regions_escalated": len(regions),
        "regions_auto_closed_unanimous": auto_closed,
        "disputes_opened": len(disputes),
        "primary_token_traceability": "verified",
        "consensus_rules": (cons.__doc__ or "").strip(),
        "verification": xv_summary,
        "provenance": {
            "pipeline_version": PIPELINE_VERSION,
            "source_sha256": rec.sha256,
            "working_audio_sha256": derived["analysis_wav"]["sha256"],
            "preprocessing": derived.get("procedure"),
            "alignment_version": ALIGNMENT_VERSION,
            "asr": [
                {
                    "provider": run.provider,
                    "model": run.model,
                    "run_id": str(run.id),
                    "engine_fingerprint": (run.raw_response or {}).get("engine_fingerprint")
                    if isinstance(run.raw_response, dict) else None,
                    "engine": (run.raw_response or {}).get("fingerprint_material")
                    if isinstance(run.raw_response, dict) else None,
                    "parameters": run.parameters,
                }
                for run in ok_primary[:2]
                if run is not None
            ],
            "verification": xv_summary.get("verifier") if xv_summary else None,
            "diarization": diar_source,
        },
    }
    content = tx.new_content(
        {
            "id": str(rec.id),
            "sha256": rec.sha256,
            "filename": rec.original_filename,
            "duration_ms": rec.duration_ms,
            "language_locale": locale,
            "recording_type": rec.recording_type,
        },
        segments,
        speakers,
        method,
    )
    rev = TranscriptRevision(
        recording_id=rec.id,
        number=1,
        status="draft",
        content=content,
        review_state="unreviewed",
    )
    db.add(rev)
    db.flush()
    rev.content = tx.bind_revision(content, str(rev.id))

    audit.record(
        db,
        "consensus_completed",
        actor_label="system",
        recording_id=rec.id,
        details={
            "revision_id": str(rev.id),
            "disputes": len(disputes),
            "auto_closed": auto_closed,
            "single_engine": result["single_engine"],
            "diarization_independent": diar_source["independent"],
            "primary_token_traceability": "verified",
        },
    )
    rec.status = "needs_review" if disputes else "ready"
    rec.status_detail = (
        f"{len(disputes)} region(s) need review" if disputes else "Ready to lock"
    )
    db.commit()
