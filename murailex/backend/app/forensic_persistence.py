from __future__ import annotations

import uuid
from collections import Counter
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit
from .forensic_models import DerivedAudio, EvidenceSpan, ProviderToken
from .models import ProviderRun, Recording, TranscriptRevision
from .pipeline.text import CRITICAL_RISKS, match_key
from .providers.base import ProviderError


def _primary_runs(db: Session, rec: Recording) -> list[ProviderRun]:
    return list(
        db.execute(
            select(ProviderRun).where(
                ProviderRun.recording_id == rec.id,
                ProviderRun.role == "primary_asr",
                ProviderRun.scope_key == "full",
                ProviderRun.status == "succeeded",
            )
        ).scalars()
    )


def persist_derived_audio(db: Session, rec: Recording) -> None:
    derived = rec.derived or {}
    procedure = derived.get("procedure") or {}
    for name in ("analysis_wav", "analysis_flac", "playback"):
        item = derived.get(name)
        if not isinstance(item, dict) or not item.get("sha256"):
            continue
        digest = str(item["sha256"])
        exists = db.execute(
            select(DerivedAudio.id).where(
                DerivedAudio.recording_id == rec.id,
                DerivedAudio.derived_sha256 == digest,
            )
        ).first()
        if exists:
            continue
        db.add(
            DerivedAudio(
                recording_id=rec.id,
                parent_sha256=rec.sha256,
                derived_sha256=digest,
                transformation=str(procedure.get(name) or name),
                parameters={
                    "storage_key": item.get("key"),
                    "bytes": item.get("bytes"),
                    "content_type": item.get("content_type"),
                },
            )
        )
    db.flush()


def _comparison(a: str | None, b: str | None) -> str | None:
    if a is None and b is None:
        return None
    return f"{match_key(a or '')}\u241f{match_key(b or '')}"


def _item_primary_evidence(item: dict[str, Any]) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    if item.get("kind") == "dispute":
        for candidate in item.get("provenance") or []:
            if candidate.get("role") != "primary_asr":
                continue
            for token in candidate.get("tokens") or []:
                raw = str(token.get("text") or "")
                if not raw.strip():
                    continue
                evidence.append(
                    {
                        "provider": candidate.get("provider"),
                        "model": candidate.get("model"),
                        "run_id": candidate.get("run_id"),
                        "raw": raw,
                        "start_ms": int(token.get("start_ms") or 0),
                        "end_ms": int(token.get("end_ms") or 0),
                        "confidence": token.get("confidence"),
                    }
                )
        return evidence

    for prov in item.get("provenance") or []:
        run_id = prov.get("run_id")
        raw = str(prov.get("raw") or "")
        if not run_id or not raw.strip():
            continue
        evidence.append(
            {
                "provider": prov.get("provider"),
                "model": prov.get("model"),
                "run_id": run_id,
                "raw": raw,
                "start_ms": int(prov.get("start_ms") or item.get("start_ms") or 0),
                "end_ms": int(prov.get("end_ms") or item.get("end_ms") or 0),
                "confidence": prov.get("confidence"),
            }
        )
    return evidence


def _expected_tokens(runs: list[ProviderRun]) -> Counter[tuple[uuid.UUID, str, int, int]]:
    out: Counter[tuple[uuid.UUID, str, int, int]] = Counter()
    for run in runs:
        for token in (run.normalized or {}).get("tokens", []):
            raw = str(token.get("text") or "")
            if not raw.strip():
                continue
            out[(run.id, raw, int(token.get("start_ms") or 0), int(token.get("end_ms") or 0))] += 1
    return out


def _persisted_tokens(db: Session, run_ids: list[uuid.UUID]) -> Counter[tuple[uuid.UUID, str, int, int]]:
    out: Counter[tuple[uuid.UUID, str, int, int]] = Counter()
    if not run_ids:
        return out
    rows = db.execute(select(ProviderToken).where(ProviderToken.provider_run_id.in_(run_ids))).scalars()
    for token in rows:
        out[(token.provider_run_id, token.raw_token, token.start_ms, token.end_ms)] += 1
    return out


def validate_primary_traceability(db: Session, rec: Recording) -> dict[str, Any]:
    runs = _primary_runs(db, rec)
    expected = _expected_tokens(runs)
    actual = _persisted_tokens(db, [run.id for run in runs])
    missing = expected - actual
    extra = actual - expected
    return {
        "ok": not missing and not extra,
        "expected_tokens": sum(expected.values()),
        "persisted_tokens": sum(actual.values()),
        "untraceable_tokens": sum(missing.values()),
        "extra_tokens": sum(extra.values()),
    }


def persist_transcript_evidence(db: Session, rec: Recording, rev: TranscriptRevision) -> dict[str, Any]:
    existing = db.execute(select(EvidenceSpan.id).where(EvidenceSpan.revision_id == rev.id)).first()
    if existing:
        result = validate_primary_traceability(db, rec)
        if not result["ok"]:
            raise ProviderError("Persisted Primary token traceability invariant failed.", retryable=False)
        return result

    primary_runs = {str(run.id): run for run in _primary_runs(db, rec)}
    for segment in rev.content.get("segments", []):
        for item in segment.get("items", []):
            primary = [p for p in _item_primary_evidence(item) if str(p.get("run_id")) in primary_runs]
            if not primary:
                continue
            by_run: list[tuple[str, list[dict[str, Any]]]] = []
            for run_id in dict.fromkeys(str(p["run_id"]) for p in primary):
                by_run.append((run_id, [p for p in primary if str(p["run_id"]) == run_id]))
            a_text = " ".join(p["raw"] for p in by_run[0][1]) if by_run else None
            b_text = " ".join(p["raw"] for p in by_run[1][1]) if len(by_run) > 1 else None
            state = "DISPUTED" if item.get("kind") == "dispute" else "CONSENSUS"
            risks = sorted(set(item.get("risks") or []) & CRITICAL_RISKS)
            span = EvidenceSpan(
                recording_id=rec.id,
                revision_id=rev.id,
                start_ms=int(item.get("start_ms") or 0),
                end_ms=int(item.get("end_ms") or item.get("start_ms") or 0),
                speaker_id=item.get("speaker"),
                overlap_state="overlap" if "overlap" in set(item.get("risks") or []) else "none",
                provider_a_text=a_text,
                provider_b_text=b_text,
                comparison_value=_comparison(a_text, b_text),
                resolution_state=state,
                critical_flags=risks,
                final_verbatim_text=str(item.get("text") or "") if state == "CONSENSUS" else None,
                provenance=primary,
            )
            db.add(span)
            db.flush()
            for prov in primary:
                run = primary_runs[str(prov["run_id"])]
                db.add(
                    ProviderToken(
                        provider_run_id=run.id,
                        raw_token=str(prov["raw"]),
                        start_ms=int(prov["start_ms"]),
                        end_ms=int(prov["end_ms"]),
                        confidence_metadata={"provider_confidence": prov.get("confidence")},
                        evidence_span_id=span.id,
                        resolution_state=state,
                    )
                )
    db.flush()
    result = validate_primary_traceability(db, rec)
    if not result["ok"]:
        raise ProviderError(
            f"Primary output accounting failed: {result['untraceable_tokens']} untraceable token(s), "
            f"{result['extra_tokens']} extra persisted token(s).",
            retryable=False,
        )
    audit.record(
        db,
        "primary_output_traceability_verified",
        actor_label="system",
        recording_id=rec.id,
        details={"revision_id": str(rev.id), **result},
    )
    db.commit()
    return result


def persist_forensic_state(db: Session, rec: Recording) -> None:
    persist_derived_audio(db, rec)
    rev = db.execute(
        select(TranscriptRevision)
        .where(TranscriptRevision.recording_id == rec.id)
        .order_by(TranscriptRevision.number.desc())
        .limit(1)
    ).scalar_one_or_none()
    if rev is not None:
        persist_transcript_evidence(db, rec, rev)
    else:
        db.commit()
