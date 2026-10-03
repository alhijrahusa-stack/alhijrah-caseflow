from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import audit, jobs, storage
from ..db import get_db
from ..exports.render import content_hash
from ..models import (
    AuditEvent,
    Dispute,
    Job,
    ProviderRun,
    Recording,
    RecordingAccess,
    TranscriptRevision,
    Translation,
    User,
)
from ..pipeline import transcript as tx
from ..pipeline.text import CRITICAL_RISKS, UNCLEAR_MARKERS
from ..security import (
    Principal,
    current_principal,
    load_recording,
    sign_media,
    verify_media,
)
from .common import (
    current_revision,
    dispute_out,
    draft_for_update,
    iso,
    parse_uuid,
    recording_out,
    revision_out,
    run_out,
    translation_out,
)
from .strict import StrictIn

router = APIRouter(prefix="/api")


def _users(db: Session) -> dict[uuid.UUID, str]:
    return {u.id: u.email for u in db.execute(select(User)).scalars()}


@router.get("/recordings")
def list_recordings(
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
    q: str | None = None,
    case_id: str | None = None,
):
    stmt = select(Recording).where(
        or_(Recording.recording_type.is_(None), Recording.recording_type != "system_canary")
    ).order_by(Recording.created_at.desc())
    if not p.is_admin:
        shared = select(RecordingAccess.recording_id).where(RecordingAccess.user_id == p.user.id)
        stmt = stmt.where(or_(Recording.owner_id == p.user.id, Recording.id.in_(shared)))
    if q:
        stmt = stmt.where(Recording.title.ilike(f"%{q}%"))
    if case_id:
        stmt = stmt.where(Recording.case_id == parse_uuid(case_id))
    recs = list(db.execute(stmt.limit(500)).scalars())
    open_counts = dict(
        db.execute(
            select(Dispute.recording_id, func.count()).where(Dispute.status == "open", Dispute.recording_id.in_([r.id for r in recs]))
            .group_by(Dispute.recording_id)
        ).all()
    ) if recs else {}
    return {"recordings": [{**recording_out(r), "open_disputes": open_counts.get(r.id, 0)} for r in recs]}


@router.get("/recordings/{recording_id}")
def get_recording(recording_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id))
    runs = db.execute(select(ProviderRun).where(ProviderRun.recording_id == rec.id).order_by(ProviderRun.created_at)).scalars()
    job = db.execute(select(Job).where(Job.recording_id == rec.id, Job.kind == "process_recording").order_by(Job.created_at.desc())).scalars().first()
    derived = rec.derived or {}
    return {
        "recording": recording_out(rec),
        "derived": {k: v for k, v in derived.items() if k in ("analysis_wav", "analysis_flac", "playback", "procedure")},
        "provider_runs": [run_out(r) for r in runs],
        "job": {"status": job.status, "attempts": job.attempts, "last_error": job.last_error, "run_after": iso(job.run_after)} if job else None,
    }


@router.post("/recordings/{recording_id}/reprocess")
def reprocess(recording_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id), "upload")
    if rec.status not in ("failed", "provider_not_configured"):
        raise HTTPException(409, "Only failed or unconfigured recordings can be reprocessed.")
    if db.execute(select(TranscriptRevision.id).where(TranscriptRevision.recording_id == rec.id)).first():
        raise HTTPException(409, "A transcript already exists for this recording.")
    active = db.execute(select(Job).where(Job.recording_id == rec.id, Job.status.in_(["queued", "running"]))).first()
    if active:
        raise HTTPException(409, "Processing is already scheduled.")
    rec.status, rec.status_detail = "queued", "Re-queued for processing"
    jobs.enqueue(db, "process_recording", rec.id)
    audit.record(db, "reprocess_requested", actor=p.user, recording_id=rec.id)
    db.commit()
    return {"recording": recording_out(rec)}


# ------------------------------------------------------------- media

@router.get("/recordings/{recording_id}/media-url")
def media_url(recording_id: str, variant: str = Query("original", pattern="^(original|playback)$"),
              p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id))
    if variant == "playback" and not (rec.derived or {}).get("playback"):
        raise HTTPException(404, "Playback copy not ready.")
    return {"url": f"/api/media/{rec.id}/{variant}?{sign_media(rec.id, variant, p.user.id)}", "variant": variant,
            "label": "Original evidence bytes" if variant == "original" else "Derived playback copy (not evidence)"}


_RANGE = re.compile(r"bytes=(\d*)-(\d*)$")


@router.get("/media/{recording_id}/{variant}")
def stream_media(recording_id: str, variant: str, request: Request, exp: int, sig: str,
                 p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rid = parse_uuid(recording_id)
    if variant not in ("original", "playback") or not verify_media(rid, variant, p.user.id, exp, sig):
        raise HTTPException(403, "Media link expired or invalid.")
    rec = load_recording(db, p, rid)
    if variant == "original":
        key, version, ctype = rec.storage_key, rec.storage_version_id, rec.mime_type
    else:
        pb = (rec.derived or {}).get("playback")
        if not pb:
            raise HTTPException(404, "Not found.")
        key, version, ctype = pb["key"], None, "audio/mp4"
    size = int(storage.head(key, version)["ContentLength"])
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "Content-Type": ctype,
               "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff"}
    rng = request.headers.get("range")
    if rng:
        m = _RANGE.match(rng.strip())
        if not m or (not m.group(1) and not m.group(2)):
            raise HTTPException(416, "Invalid range.")
        if m.group(1):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
        else:
            start = max(0, size - int(m.group(2)))
            end = size - 1
        end = min(end, size - 1)
        if start > end:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        obj = storage.get_stream(key, version, f"bytes={start}-{end}")
        headers.update({"Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(end - start + 1)})
        return StreamingResponse(obj["Body"].iter_chunks(256 * 1024), status_code=206, headers=headers)
    obj = storage.get_stream(key, version)
    headers["Content-Length"] = str(size)
    return StreamingResponse(obj["Body"].iter_chunks(256 * 1024), headers=headers)


@router.get("/recordings/{recording_id}/peaks")
def peaks(recording_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id))
    pk = (rec.derived or {}).get("peaks")
    if not pk:
        raise HTTPException(404, "Waveform not ready.")
    return json.loads(storage.get_bytes(pk["key"]))


# ------------------------------------------------------------- transcript

@router.get("/recordings/{recording_id}/transcript")
def get_transcript(recording_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db),
                   revision: str | None = None):
    rec = load_recording(db, p, parse_uuid(recording_id))
    revs = list(db.execute(select(TranscriptRevision).where(TranscriptRevision.recording_id == rec.id)
                           .order_by(TranscriptRevision.number)).scalars())
    if not revs:
        return {"revision": None, "revisions": []}
    users = _users(db)
    chosen = revs[-1]
    if revision:
        chosen = next((r for r in revs if str(r.id) == revision), None)  # type: ignore[assignment]
        if chosen is None:
            raise HTTPException(404, "Revision not found.")
    return {
        "revision": revision_out(chosen, users),
        "revisions": [{k: v for k, v in revision_out(r, users).items() if k != "content"} for r in revs],
    }


@router.get("/recordings/{recording_id}/disputes")
def list_disputes(recording_id: str, status: str | None = None, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id))
    q = select(Dispute).where(Dispute.recording_id == rec.id).order_by(Dispute.ordinal)
    if status:
        q = q.where(Dispute.status == status)
    return {"disputes": [dispute_out(d) for d in db.execute(q).scalars()]}


class ResolveIn(StrictIn):
    action: str = Field(pattern="^(accept_candidate|type_exact|mark_inaudible|mark_unclear_name|mark_unclear_number|mark_overlap)$")
    candidate_index: int | None = None
    text: str | None = Field(default=None, max_length=5000)


MARK_ACTIONS = {
    "mark_inaudible": "inaudible",
    "mark_unclear_name": "unclear_name",
    "mark_unclear_number": "unclear_number",
    "mark_overlap": "overlap",
}


@router.post("/disputes/{dispute_id}/resolve")
def resolve(dispute_id: str, body: ResolveIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    d = db.execute(select(Dispute).where(Dispute.id == parse_uuid(dispute_id)).with_for_update()).scalar_one_or_none()
    if d is None:
        raise HTTPException(404, "Not found.")
    rec = load_recording(db, p, d.recording_id, "review")
    if d.status != "open":
        raise HTTPException(409, "This region is already resolved.")
    rev = draft_for_update(db, rec)
    now = datetime.now(timezone.utc)
    base = {"start_ms": d.start_ms, "end_ms": d.end_ms, "speaker": d.speaker, "risks": [r[5:] for r in d.reasons if r.startswith("risk:")]}
    resolution: dict[str, Any] = {"action": body.action, "by": p.user.email, "at": now.isoformat()}
    if body.action == "accept_candidate":
        if body.candidate_index is None or not (0 <= body.candidate_index < len(d.candidates)):
            raise HTTPException(422, "Choose a candidate.")
        c = d.candidates[body.candidate_index]
        if not c["tokens"]:
            raise HTTPException(422, "This candidate contains no words; mark the region instead.")
        items = [{**base, "kind": "word", "text": t["text"], "start_ms": t["start_ms"], "end_ms": t["end_ms"], "source": "reviewer_accepted_candidate",
                  "provenance": [{"provider": c["provider"], "model": c["model"], "run_id": c["run_id"], "raw": t["text"],
                                  "confidence": t.get("confidence"), "accepted_by": p.user.email, "dispute_id": str(d.id)}]}
                 for t in c["tokens"]]
        resolution.update({"provider": c["provider"], "model": c["model"], "run_id": c["run_id"], "text": c["text"]})
    elif body.action == "type_exact":
        if not body.text or not body.text.strip():
            raise HTTPException(422, "Type exactly what you hear.")
        items = [{**base, "kind": "word", "text": body.text, "source": "human",
                  "provenance": [{"method": "type_exactly_what_i_hear", "by": p.user.email, "dispute_id": str(d.id)}]}]
        resolution["text"] = body.text
    else:
        marker = UNCLEAR_MARKERS[MARK_ACTIONS[body.action]]
        items = [{**base, "kind": "marker", "text": marker, "source": "human",
                  "provenance": [{"method": body.action, "by": p.user.email, "dispute_id": str(d.id)}]}]
        resolution["text"] = marker
    try:
        rev.content = tx.resolve_dispute(rev.content, str(d.id), items)
    except KeyError as exc:
        raise HTTPException(409, "Dispute is not present in the current draft.") from exc
    d.status = "resolved"
    d.resolution = resolution
    d.resolved_by = p.user.id
    d.resolved_at = now
    audit.record(db, "review_decision", actor=p.user, recording_id=rec.id, details={
        "dispute_id": str(d.id), "ordinal": d.ordinal, "revision_id": str(rev.id), "action": body.action,
        "start_ms": d.start_ms, "end_ms": d.end_ms, "result": resolution.get("text"), "candidate_provider": resolution.get("provider")})
    remaining = db.execute(select(func.count()).select_from(Dispute).where(Dispute.recording_id == rec.id, Dispute.status == "open")).scalar_one()
    if remaining == 0 and rec.status == "needs_review":
        rec.status, rec.status_detail = "ready", "Review complete — ready to lock"
    elif remaining:
        rec.status_detail = f"{remaining} region(s) need review"
    db.commit()
    return {"dispute": dispute_out(d), "remaining": remaining}


class SegmentTextIn(StrictIn):
    text: str = Field(min_length=1, max_length=20000)


@router.post("/recordings/{recording_id}/segments/{segment_id}/text")
def correct_segment(recording_id: str, segment_id: str, body: SegmentTextIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id), "review")
    rev = draft_for_update(db, rec)
    try:
        rev.content, before = tx.replace_segment_text(rev.content, segment_id, body.text, p.user.email)
    except KeyError as exc:
        raise HTTPException(404, "Segment not found.") from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    audit.record(db, "correction", actor=p.user, recording_id=rec.id,
                 details={"revision_id": str(rev.id), "segment_id": segment_id, "before": before, "after": body.text})
    db.commit()
    return {"ok": True}


class SpeakerIn(StrictIn):
    speaker: str = Field(pattern=r"^S\d{1,3}$")


@router.post("/recordings/{recording_id}/segments/{segment_id}/speaker")
def change_speaker(recording_id: str, segment_id: str, body: SpeakerIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id), "review")
    rev = draft_for_update(db, rec)
    try:
        rev.content, before = tx.set_segment_speaker(rev.content, segment_id, body.speaker)
    except KeyError as exc:
        raise HTTPException(404, "Segment not found.") from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    audit.record(db, "speaker_change", actor=p.user, recording_id=rec.id,
                 details={"revision_id": str(rev.id), "segment_id": segment_id, "before": before, "after": body.speaker})
    db.commit()
    return {"ok": True}


@router.post("/recordings/{recording_id}/speakers")
def add_speaker(recording_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id), "review")
    rev = draft_for_update(db, rec)
    rev.content, sid = tx.add_speaker(rev.content)
    audit.record(db, "speaker_added", actor=p.user, recording_id=rec.id, details={"revision_id": str(rev.id), "speaker": sid})
    db.commit()
    return {"speaker": sid}


class VerifyNameIn(StrictIn):
    name: str | None = Field(default=None, max_length=200)
    confirm_human_verification: bool = False


@router.post("/recordings/{recording_id}/speakers/{sid}/verify")
def verify_speaker(recording_id: str, sid: str, body: VerifyNameIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id), "review")
    if body.name and not body.confirm_human_verification:
        raise HTTPException(422, "A real name may be assigned only with explicit human verification.")
    rev = draft_for_update(db, rec)
    try:
        rev.content = tx.verify_speaker_name(rev.content, sid, (body.name or "").strip() or None, p.user.email, datetime.now(timezone.utc).isoformat())
    except KeyError as exc:
        raise HTTPException(404, "Speaker not found.") from exc
    audit.record(db, "speaker_identity_verified" if body.name else "speaker_identity_cleared", actor=p.user, recording_id=rec.id,
                 details={"revision_id": str(rev.id), "speaker": sid, "name": body.name})
    db.commit()
    return {"ok": True}


@router.post("/recordings/{recording_id}/lock")
def lock(recording_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id), "lock")
    rev = draft_for_update(db, rec)
    open_ids = tx.open_dispute_ids(rev.content)
    open_rows = db.execute(select(func.count()).select_from(Dispute).where(Dispute.recording_id == rec.id, Dispute.status == "open")).scalar_one()
    if open_ids or open_rows:
        raise HTTPException(409, f"{max(len(open_ids), open_rows)} disputed region(s) must be resolved before locking.")
    pending_critical = []
    reviewed_sources = {"human", "reviewer_accepted_candidate"}
    for seg in rev.content.get("segments", []):
        for item in seg.get("items", []):
            risks = set(item.get("risks") or [])
            if risks & CRITICAL_RISKS and item.get("source") not in reviewed_sources:
                pending_critical.append({"segment_id": seg.get("id"), "risks": sorted(risks & CRITICAL_RISKS)})
    if pending_critical:
        raise HTTPException(409, {"message": "Critical item(s) require human review before locking.", "items": pending_critical[:100]})
    observed_sha, observed_size = storage.sha256_of_object(rec.storage_key, rec.storage_version_id)
    if observed_sha != rec.sha256 or observed_size != rec.byte_size:
        audit.record(db, "integrity_failure", actor=p.user, recording_id=rec.id,
                     details={"stage": "pre_lock", "expected_sha256": rec.sha256, "observed_sha256": observed_sha,
                              "expected_bytes": rec.byte_size, "observed_bytes": observed_size})
        db.commit()
        raise HTTPException(409, "Original evidence integrity check failed; transcript cannot be locked.")
    audit.record(db, "pre_lock_integrity_verified", actor=p.user, recording_id=rec.id,
                 details={"sha256_before": rec.sha256, "sha256_after": observed_sha, "byte_size": observed_size})
    parent_sha = None
    if rev.parent_id:
        parent = db.get(TranscriptRevision, rev.parent_id)
        parent_sha = parent.sha256 if parent else None
    now = datetime.now(timezone.utc)
    rev.sha256 = content_hash(rec.sha256, rev.number, parent_sha, rev.content)
    rev.status = "locked"
    rev.locked_at = now
    rev.locked_by = p.user.id
    rec.status, rec.status_detail = "locked", f"Revision {rev.number} locked"
    audit.record(db, "transcript_locked", actor=p.user, recording_id=rec.id,
                 details={"revision_id": str(rev.id), "number": rev.number, "sha256": rev.sha256, "parent_sha256": parent_sha})
    db.commit()
    return {"revision": revision_out(rev, _users(db))}


@router.post("/recordings/{recording_id}/revisions")
def new_revision(recording_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id), "review")
    latest = current_revision(db, rec)
    if latest is None or latest.status != "locked":
        raise HTTPException(409, "A new revision can be created only from a locked revision.")
    rev = TranscriptRevision(recording_id=rec.id, number=latest.number + 1, parent_id=latest.id, status="draft",
                             content=json.loads(json.dumps(latest.content)), created_by=p.user.id)
    db.add(rev)
    rec.status, rec.status_detail = "ready", f"Revision {rev.number} draft open"
    db.flush()
    audit.record(db, "revision_created", actor=p.user, recording_id=rec.id,
                 details={"revision_id": str(rev.id), "number": rev.number, "parent_id": str(latest.id), "parent_sha256": latest.sha256})
    db.commit()
    return {"revision": revision_out(rev, _users(db))}


# ------------------------------------------------------------- translations

class TranslationIn(StrictIn):
    mode: str = Field(pattern="^(ar_en|en_ar|bilingual)$")


@router.post("/recordings/{recording_id}/translations")
def create_translation(recording_id: str, body: TranslationIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    from ..providers import local_mt, registry
    from ..providers import translate as gt
    from ..translation import MODES

    rec = load_recording(db, p, parse_uuid(recording_id), "translate")
    latest = db.execute(select(TranscriptRevision).where(TranscriptRevision.recording_id == rec.id, TranscriptRevision.status == "locked")
                        .order_by(TranscriptRevision.number.desc()).limit(1)).scalar_one_or_none()
    if latest is None:
        raise HTTPException(409, "Lock the forensic transcript before translating.")
    src, tgt = MODES[body.mode]
    if registry.local_mode():
        # On-device only: legal text never leaves the machine in local mode.
        if not local_mt.configured(src, tgt):
            raise HTTPException(503, f"On-device translation model {src}->{tgt} is NOT INSTALLED.")
        provider, model = local_mt.NAME, local_mt.model_id(src, tgt)
    else:
        if not gt.configured():
            raise HTTPException(503, "Translation provider (Google Cloud Translation) is NOT CONFIGURED.")
        provider, model = "google_translate", gt.MODEL
    tr = Translation(recording_id=rec.id, source_revision_id=latest.id, mode=body.mode, source_language=src, target_language=tgt,
                     provider=provider, model=model[:100], status="queued", created_by=p.user.id)
    db.add(tr)
    db.flush()
    jobs.enqueue(db, "translate", rec.id, {"translation_id": str(tr.id)})
    audit.record(db, "translation_requested", actor=p.user, recording_id=rec.id,
                 details={"translation_id": str(tr.id), "mode": body.mode, "source_revision_id": str(latest.id), "source_sha256": latest.sha256})
    db.commit()
    return {"translation": translation_out(tr)}


@router.get("/recordings/{recording_id}/translations")
def list_translations(recording_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id))
    rows = db.execute(select(Translation).where(Translation.recording_id == rec.id).order_by(Translation.created_at.desc())).scalars()
    return {"translations": [translation_out(t) for t in rows]}


# ------------------------------------------------------------- audit

@router.get("/recordings/{recording_id}/audit")
def recording_audit(recording_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id))
    rows = db.execute(select(AuditEvent).where(AuditEvent.recording_id == rec.id).order_by(AuditEvent.id)).scalars()
    return {"events": [audit.serialize(e) for e in rows], "chain": audit.verify_chain(db)}


@router.get("/review/queue")
def review_queue(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    stmt = (select(Recording, func.count(Dispute.id)).join(Dispute, Dispute.recording_id == Recording.id)
            .where(Dispute.status == "open").group_by(Recording.id).order_by(Recording.created_at.desc()))
    if not p.is_admin:
        shared = select(RecordingAccess.recording_id).where(RecordingAccess.user_id == p.user.id, RecordingAccess.permission == "review")
        stmt = stmt.where(or_(Recording.owner_id == p.user.id, Recording.id.in_(shared)))
    return {"items": [{**recording_out(r), "open_disputes": n} for r, n in db.execute(stmt).all()]}


class AccessIn(StrictIn):
    email: str
    permission: str = Field(pattern="^(view|review)$")


@router.post("/recordings/{recording_id}/access")
def grant_access(recording_id: str, body: AccessIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id), "upload")
    if not (p.is_admin or rec.owner_id == p.user.id):
        raise HTTPException(403, "Only the owner can share this recording.")
    u = db.execute(select(User).where(func.lower(User.email) == body.email.lower())).scalar_one_or_none()
    if u is None:
        raise HTTPException(404, "User not found.")
    row = db.execute(select(RecordingAccess).where(RecordingAccess.recording_id == rec.id, RecordingAccess.user_id == u.id)).scalar_one_or_none()
    if row is None:
        db.add(RecordingAccess(recording_id=rec.id, user_id=u.id, permission=body.permission))
    else:
        row.permission = body.permission
    audit.record(db, "access_granted", actor=p.user, recording_id=rec.id, details={"user": u.email, "permission": body.permission})
    db.commit()
    return {"ok": True}
