"""Durable, checkpointed processing of one recording.

Every provider call is persisted as a ProviderRun before and after it happens, so a
worker, API, server or provider interruption resumes from the last checkpoint: remote
jobs already submitted are polled, never resubmitted, and completed results are never
requested twice.
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

from .. import audio, audit, storage
from ..config import get_settings
from ..models import Dispute, ProviderRun, Recording, TranscriptRevision
from ..providers import registry
from ..providers.base import AsrAdapter, NotConfigured, Pending, ProviderError
from . import consensus as cons
from . import transcript as tx

log = logging.getLogger("murailex.pipeline")

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


# ---------------------------------------------------------------- stage 1: derive

def ensure_derived(db: Session, rec: Recording) -> dict[str, Any]:
    wd = _workdir(rec)
    if rec.derived and rec.derived.get("analysis_wav"):
        local = os.path.join(wd, "analysis.wav")
        if not os.path.exists(local):
            storage.download_to(rec.derived["analysis_wav"]["key"], local)
        return rec.derived

    _set_status(db, rec, "analyzing", "Creating derived working copies")
    original = os.path.join(wd, "original.bin")
    storage.download_to(rec.storage_key, original, rec.storage_version_id)
    digest = _file_sha(original)
    if digest != rec.sha256:
        audit.record(db, "integrity_failure", actor_label="system", recording_id=rec.id,
                     details={"expected_sha256": rec.sha256, "observed_sha256": digest})
        db.commit()
        raise ProviderError("Original object SHA-256 does not match the recorded hash.", retryable=False)
    info = audio.probe(original)
    analysis = os.path.join(wd, "analysis.wav")
    flac = os.path.join(wd, "analysis.flac")
    playback = os.path.join(wd, "playback.m4a")
    audio.derive_analysis_wav(original, analysis)
    audio.derive_flac(analysis, flac)
    audio.derive_playback(original, playback)
    peaks = audio.waveform_peaks(analysis)
    silences = audio.detect_silences(analysis)
    os.remove(original)  # the local read-only copy is no longer needed

    derived: dict[str, Any] = {"silences": silences}
    for name, path, ctype in (
        ("analysis_wav", analysis, "audio/wav"),
        ("analysis_flac", flac, "audio/flac"),
        ("playback", playback, "audio/mp4"),
    ):
        key = f"derived/{rec.id}/{os.path.basename(path)}"
        with open(path, "rb") as fh:
            storage.put_file(key, fh, ctype)
        derived[name] = {"key": key, "sha256": _file_sha(path), "bytes": os.path.getsize(path), "content_type": ctype}
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
    audit.record(db, "derived_copies_created", actor_label="system", recording_id=rec.id,
                 details={"original_sha256_verified": digest, "media": info,
                          "derived": {k: v.get("sha256") for k, v in derived.items() if isinstance(v, dict) and "sha256" in v}})
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

def _get_run(db: Session, rec: Recording, adapter: AsrAdapter, role: str, scope: str) -> ProviderRun | None:
    return db.execute(
        select(ProviderRun)
        .where(ProviderRun.recording_id == rec.id, ProviderRun.provider == adapter.name,
               ProviderRun.role == role, ProviderRun.scope_key == scope)
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
    """Advance one provider run by one step. Returns the run when terminal, raises Wait when pending."""
    info = adapter.info()
    run = _get_run(db, rec, adapter, role, scope)
    if run is not None and run.status in ("succeeded", "failed", "not_configured"):
        return run
    if not info.configured:
        if run is None:
            run = ProviderRun(recording_id=rec.id, provider=adapter.name, model=info.model, role=role, scope_key=scope,
                              parameters=info.parameters, status="not_configured",
                              window_start_ms=window[0] if window else None, window_end_ms=window[1] if window else None)
            db.add(run)
            db.commit()
        return run
    if run is None:
        run = ProviderRun(recording_id=rec.id, provider=adapter.name, model=info.model, role=role, scope_key=scope,
                          parameters=info.parameters, status="pending", input_sha256=context.get("input_sha256"),
                          window_start_ms=window[0] if window else None, window_end_ms=window[1] if window else None)
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
                audit.record(db, "provider_submitted", actor_label="system", recording_id=rec.id,
                             details={"run_id": str(run.id), "provider": run.provider, "model": run.model, "role": role, "scope": scope, "attempt": run.attempt})
                db.commit()
            result = adapter.fetch(run.remote_id)
            if isinstance(result, Pending):
                started = run.started_at or _now()
                if (_now() - started).total_seconds() > get_settings().provider_timeout_seconds:
                    raise ProviderError(f"{adapter.name} did not finish within the configured timeout", retryable=False)
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
            for t in normalized.get("tokens", []):
                t["start_ms"] += window[0]
                t["end_ms"] += window[0]
        run.raw_response = raw
        run.normalized = normalized
        run.status = "succeeded"
        run.error = None
        run.finished_at = _now()
        db.commit()
        audit.record(db, "provider_completed", actor_label="system", recording_id=rec.id,
                     details={"run_id": str(run.id), "provider": run.provider, "model": run.model, "role": role, "scope": scope,
                              "tokens": len(normalized.get("tokens", [])), "turns": len(normalized.get("turns", []))})
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
        audit.record(db, "provider_retry" if not permanent else "provider_failed", actor_label="system", recording_id=rec.id,
                     details={"run_id": str(run.id), "provider": run.provider, "error": str(exc), "attempt": run.attempt})
        db.commit()
        if permanent:
            return run
        raise Wait(min(300.0, get_settings().provider_retry_base_seconds * (2 ** run.attempt)), f"{adapter.name} retry scheduled") from exc


# ---------------------------------------------------------------- main entry

def process_recording(db: Session, rec: Recording) -> None:
    s = get_settings()
    if db.execute(select(TranscriptRevision.id).where(TranscriptRevision.recording_id == rec.id)).first():
        return  # already produced its first draft; idempotent
    derived = ensure_derived(db, rec)
    wd = _workdir(rec)
    analysis = os.path.join(wd, "analysis.wav")
    flac = os.path.join(wd, "analysis.flac")
    if not os.path.exists(flac):
        storage.download_to(derived["analysis_flac"]["key"], flac)
    locale = rec.language_hint
    if registry.fixtures_enabled() and locale not in registry.SUPPORTED_LOCALES:
        locale = "ar-YE"  # automated fixtures only; Production never receives this fallback
    if locale not in registry.SUPPORTED_LOCALES:
        _set_status(db, rec, "failed", "A supported recording locale is required before forensic processing.")
        audit.record(db, "processing_blocked", actor_label="system", recording_id=rec.id,
                     details={"reason": "missing_or_invalid_language_locale", "language_locale": locale})
        db.commit()
        return

    ctx = {"recording_id": str(rec.id), "expected_speakers": rec.expected_speakers,
           "language_locale": locale, "derived_sha256": derived["analysis_wav"]["sha256"],
           "input_sha256": derived["analysis_wav"]["sha256"]}

    primaries = registry.primary_asr(locale)
    diarizers = registry.diarization()
    verifiers = registry.verification_asr(locale)
    required = [(a, "primary_asr") for a in primaries] + [(d, "diarization") for d in diarizers] + [(v, "verification_asr") for v in verifiers]
    missing = [(a, role) for a, role in required if not a.info().configured]
    if missing:
        for a, role in missing:
            drive_run(db, rec, a, role, analysis, ctx, scope="configuration-check")
        names = [f"{a.name}:{a.info().model}" for a, _ in missing]
        _set_status(db, rec, "provider_not_configured", "Required forensic provider(s) not configured: " + ", ".join(names))
        audit.record(db, "processing_blocked", actor_label="system", recording_id=rec.id,
                     details={"reason": "mandatory_provider_not_configured", "language_locale": locale, "providers": names})
        db.commit()
        return

    _set_status(db, rec, "transcribing", "Primary engines and diarization running")
    waits: list[Wait] = []
    runs: dict[str, ProviderRun | None] = {}
    for a in primaries:
        path = flac if a.name == "google_chirp3" else analysis
        try:
            runs[a.name] = drive_run(db, rec, a, "primary_asr", path, ctx)
        except Wait as w:
            waits.append(w)
    for dz in diarizers:
        try:
            runs[dz.name] = drive_run(db, rec, dz, "diarization", analysis, ctx)
        except Wait as w:
            waits.append(w)
    if waits:
        raise Wait(min(w.seconds for w in waits), "; ".join(str(w) for w in waits))

    ok_primary = [runs[a.name] for a in primaries if runs.get(a.name) and runs[a.name].status == "succeeded"]  # type: ignore[union-attr]
    if len(ok_primary) != len(primaries):
        _set_status(db, rec, "failed", "Mandatory primary ASR engine failed; forensic consensus was not produced.")
        audit.record(db, "processing_failed", actor_label="system", recording_id=rec.id,
                     details={"reason": "mandatory_primary_failed", "language_locale": locale,
                              "primary_status": {a.name: (runs.get(a.name).status if runs.get(a.name) else "missing") for a in primaries}})
        db.commit()
        return
    diar_run = next((runs[d.name] for d in diarizers if runs.get(d.name) and runs[d.name].status == "succeeded"), None)  # type: ignore[union-attr]
    if diarizers and diar_run is None:
        _set_status(db, rec, "failed", "Mandatory independent diarization failed.")
        audit.record(db, "processing_failed", actor_label="system", recording_id=rec.id,
                     details={"reason": "mandatory_diarization_failed", "language_locale": locale})
        db.commit()
        return

    _set_status(db, rec, "aligning", "Aligning tokens and computing consensus")
    primary_inputs = [
        ({"provider": r.provider, "model": r.model, "run_id": str(r.id)}, (r.normalized or {}).get("tokens", []))
        for r in ok_primary[:2]
        if r is not None
    ]
    assert diar_run is not None
    turns = diar_run.normalized["turns"]  # type: ignore[index]
    diar_source = {"provider": diar_run.provider, "model": diar_run.model, "run_id": str(diar_run.id), "independent": True}
    result = cons.analyze(primary_inputs, turns, s.low_confidence_threshold)
    columns, regions = result["columns"], result["regions"]

    if verifiers:
        _set_status(db, rec, "verifying", f"Targeted reprocessing of {sum(1 for r in regions if r['requires_independent_check'])} regions")
    waits = []
    for r in regions:
        if not r["requires_independent_check"] or not verifiers:
            continue
        ws = max(0, r["start_ms"] - s.context_padding_ms)
        we = min(rec.duration_ms or r["end_ms"] + s.context_padding_ms, r["end_ms"] + s.context_padding_ms)
        clip = os.path.join(wd, f"region-{r['start_ms']}-{r['end_ms']}.wav")
        if not os.path.exists(clip):
            audio.cut_segment(analysis, clip, ws, we)
        for v in verifiers:
            try:
                drive_run(db, rec, v, "verification_asr", clip,
                          {**ctx, "window_start_ms": ws, "window_end_ms": we, "input_sha256": _file_sha(clip)},
                          scope=f"region:{r['start_ms']}-{r['end_ms']}", window=(ws, we))
            except Wait as w:
                waits.append(w)
    if waits:
        raise Wait(min(w.seconds for w in waits), "verification pending")

    verifier_failures: list[dict[str, str]] = []
    for r in regions:
        if not r["requires_independent_check"]:
            continue
        scope = f"region:{r['start_ms']}-{r['end_ms']}"
        for v in verifiers:
            vr = _get_run(db, rec, v, "verification_asr", scope)
            if vr is None or vr.status != "succeeded":
                verifier_failures.append({"provider": v.name, "scope": scope, "status": vr.status if vr else "missing"})
    if verifier_failures:
        _set_status(db, rec, "failed", "Mandatory verification engine failed; forensic transcript was not finalized.")
        audit.record(db, "processing_failed", actor_label="system", recording_id=rec.id,
                     details={"reason": "mandatory_verifier_failed", "language_locale": locale, "failures": verifier_failures})
        db.commit()
        return

    _set_status(db, rec, "building", "Creating disputes and draft transcript")
    raw_speakers = [c["speaker_raw"] for c in columns] + [t["speaker"] for t in turns]
    smap = tx.speaker_map([c["speaker_raw"] for c in columns] or raw_speakers)
    for sp in raw_speakers:
        if sp is not None and sp not in smap:
            smap[sp] = f"S{len(smap) + 1}"

    accepted: set[int] = set()
    region_items: list[dict[str, Any]] = []
    in_region: set[int] = set()
    disputes: list[Dispute] = []
    auto_closed = 0
    for r in regions:
        in_region.update(r["columns"])
        needs_check = r["requires_independent_check"]
        if not needs_check:
            accepted.update(r["columns"])  # agreed, non-critical escalation (e.g. negation) — flags retained
            continue
        cands = []
        for meta, toks in primary_inputs:
            cands.append(cons.candidate(meta, cons.tokens_in_window(toks, r["start_ms"], r["end_ms"]), "primary_asr"))
        for v in verifiers:
            vr = _get_run(db, rec, v, "verification_asr", f"region:{r['start_ms']}-{r['end_ms']}")
            if vr is not None and vr.status == "succeeded":
                norm = vr.normalized or {}
                toks = norm.get("tokens", [])
                cands.append(cons.candidate(
                    {"provider": vr.provider, "model": vr.model, "run_id": str(vr.id)},
                    cons.tokens_in_window(toks, r["start_ms"], r["end_ms"]),
                    "verification_asr",
                    region_text=norm.get("text"),
                    region_start_ms=r["start_ms"],
                    region_end_ms=r["end_ms"],
                ))
        cons.annotate_agreement(cands)
        winner = cons.auto_resolution(r, cands, s.low_confidence_threshold)
        spk = smap.get(r["speaker_raw"]) if r["speaker_raw"] is not None else None
        if winner is not None:
            auto_closed += 1
            for t in winner["tokens"]:
                region_items.append({
                    "kind": "word", "text": t["text"], "start_ms": t["start_ms"], "end_ms": t["end_ms"], "speaker": spk,
                    "risks": r["risks"], "source": "unanimous_verification",
                    "provenance": [{"provider": c["provider"], "model": c["model"], "run_id": c["run_id"], "text": c["text"]} for c in cands],
                })
            continue
        d = Dispute(recording_id=rec.id, ordinal=len(disputes) + 1, start_ms=r["start_ms"], end_ms=r["end_ms"], speaker=spk,
                    reasons=sorted(set(r["reasons"]) | {f"risk:{x}" for x in r["risks"]}), candidates=cands, status="open")
        db.add(d)
        db.flush()
        disputes.append(d)
        region_items.append({"kind": "dispute", "dispute_id": str(d.id), "text": "", "start_ms": r["start_ms"], "end_ms": r["end_ms"],
                             "speaker": spk, "risks": r["risks"], "source": "consensus", "provenance": []})
    for c in columns:
        if c["index"] not in in_region:
            accepted.add(c["index"])

    items = tx.build_items(columns, accepted, region_items, derived.get("silences", []), smap)
    segments = tx.segment(items)
    speakers = sorted(set(smap.values()), key=lambda x: int(x[1:]))
    method = {
        "primary_engines": [m for m, _ in primary_inputs],
        "diarization": diar_source,
        "verification_engines": [{"provider": v.name, "model": v.info().model} for v in verifiers],
        "single_engine_mode": result["single_engine"],
        "language_locale": locale,
        "confidence_policy": "provenance_only_no_acceptance_gate",
        "context_padding_ms": s.context_padding_ms,
        "regions_escalated": len(regions),
        "regions_auto_closed_unanimous": auto_closed,
        "disputes_opened": len(disputes),
        "consensus_rules": (cons.__doc__ or "").strip(),
    }
    content = tx.new_content(
        {"id": str(rec.id), "sha256": rec.sha256, "filename": rec.original_filename, "duration_ms": rec.duration_ms},
        segments, speakers, method,
    )
    rev = TranscriptRevision(recording_id=rec.id, number=1, status="draft", content=content)
    db.add(rev)
    db.flush()
    audit.record(db, "consensus_completed", actor_label="system", recording_id=rec.id,
                 details={"revision_id": str(rev.id), "disputes": len(disputes), "auto_closed": auto_closed,
                          "single_engine": result["single_engine"], "diarization_independent": diar_source["independent"]})
    rec.status = "needs_review" if disputes else "ready"
    rec.status_detail = f"{len(disputes)} region(s) need review" if disputes else "Ready to lock"
    db.commit()
