"""On-demand evidence integrity verification (e.g. when a case is reopened).

Recomputes, from storage and the database, the SHA-256 of the immutable original, of the
working (analysis) audio, and the content hash of every locked revision, and compares each
with its persisted value. Any mismatch moves the recording to INTEGRITY_FAILURE, which blocks
locking, summaries and exports until a later verification passes again.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, storage
from ..db import get_db
from ..exports.render import content_hash
from ..models import Recording, TranscriptRevision
from ..security import Principal, current_principal, load_recording
from .common import parse_uuid, recording_out

router = APIRouter(prefix="/api")
INTEGRITY_FAILURE = "integrity_failure"


def verify_recording_integrity(db: Session, rec: Recording) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    try:
        digest, size = storage.sha256_of_object(rec.storage_key, rec.storage_version_id)
    except Exception as exc:  # noqa: BLE001 - a missing object is an integrity failure, not a crash
        digest, size = f"unreadable: {type(exc).__name__}", -1
    checks.append({"check": "original_sha256", "expected": rec.sha256, "observed": digest,
                   "bytes_expected": rec.byte_size, "bytes_observed": size,
                   "ok": digest == rec.sha256 and size == rec.byte_size})
    wav = (rec.derived or {}).get("analysis_wav")
    if wav and wav.get("sha256"):
        try:
            observed, _ = storage.sha256_of_object(wav["key"])
        except Exception as exc:  # noqa: BLE001
            observed = f"unreadable: {type(exc).__name__}"
        checks.append({"check": "working_audio_sha256", "expected": wav["sha256"], "observed": observed, "ok": observed == wav["sha256"]})
    revs = list(db.execute(select(TranscriptRevision).where(TranscriptRevision.recording_id == rec.id).order_by(TranscriptRevision.number)).scalars())
    by_id = {r.id: r for r in revs}
    for rev in revs:
        if rev.status != "locked":
            continue
        parent = by_id.get(rev.parent_id) if rev.parent_id else None
        recomputed = content_hash(rec.sha256, rev.number, parent.sha256 if parent else None, rev.content)
        checks.append({"check": f"revision_{rev.number}_sha256", "expected": rev.sha256, "observed": recomputed, "ok": recomputed == rev.sha256})
    return {"ok": all(c["ok"] for c in checks), "checks": checks, "verified_at": datetime.now(timezone.utc).isoformat()}


@router.post("/recordings/{recording_id}/integrity")
def verify_integrity(recording_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id))
    result = verify_recording_integrity(db, rec)
    if not result["ok"]:
        failed = [c["check"] for c in result["checks"] if not c["ok"]]
        if rec.status != INTEGRITY_FAILURE:
            audit.record(db, "integrity_failure", actor=p.user, recording_id=rec.id,
                         details={"stage": "on_demand", "previous_status": rec.status, **result})
        rec.status, rec.status_detail = INTEGRITY_FAILURE, "Integrity failure: " + ", ".join(failed)
    else:
        if rec.status == INTEGRITY_FAILURE:
            locked = any(c["check"].startswith("revision_") for c in result["checks"])
            rec.status = "locked" if locked else "needs_review"
            rec.status_detail = "Integrity restored and re-verified"
            audit.record(db, "integrity_restored", actor=p.user, recording_id=rec.id, details=result)
        audit.record(db, "integrity_verified", actor=p.user, recording_id=rec.id, details=result)
    db.commit()
    return {"integrity": result, "recording": recording_out(rec)}
