from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audio, audit, jobs, storage
from ..config import get_settings
from ..db import get_db
from ..models import Recording, UploadSession, new_id
from ..security import Principal, current_principal, require_capability
from .common import parse_uuid, recording_out

router = APIRouter(prefix="/api/uploads")


class UploadIn(BaseModel):
    filename: str = Field(min_length=1, max_length=500)
    mime_type: str = Field(default="application/octet-stream", max_length=100)
    size: int = Field(gt=0)
    fingerprint: str = Field(min_length=1, max_length=200)
    title: str = Field(default="", max_length=300)
    source: str = Field(default="upload", pattern="^(upload|recording)$")
    language_hint: str | None = Field(default=None, pattern=r"^(ar-YE|ar-EG|ar-SY|ar-LB|ar-IQ)$")
    expected_speakers: int | None = Field(default=None, ge=1, le=20)


def _session_out(s: UploadSession) -> dict:
    received = sorted(int(n) for n in s.parts)
    return {
        "id": str(s.id), "status": s.status, "chunk_size": s.chunk_size, "total_size": s.total_size,
        "received_parts": received, "total_parts": -(-s.total_size // s.chunk_size),
        "received_bytes": sum(int(p["size"]) for p in s.parts.values()),
        "recording_id": str(s.recording_id) if s.recording_id else None,
    }


@router.post("")
def create_upload(body: UploadIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    require_capability(p, "upload")
    s = get_settings()
    if body.size > s.max_upload_bytes:
        raise HTTPException(413, "File exceeds the maximum upload size.")
    ext = os.path.splitext(body.filename.lower())[1]
    if ext not in audio.ALLOWED_EXTENSIONS:
        raise HTTPException(415, "Unsupported audio file type.")
    if not (body.mime_type.startswith("audio/") or body.mime_type in ("video/mp4", "video/webm", "video/3gpp", "video/quicktime", "application/octet-stream")):
        raise HTTPException(415, "Unsupported MIME type.")
    existing = db.execute(
        select(UploadSession).where(UploadSession.owner_id == p.user.id, UploadSession.fingerprint == body.fingerprint,
                                    UploadSession.status == "open", UploadSession.total_size == body.size)
    ).scalar_one_or_none()
    if existing is not None:
        return _session_out(existing)  # resume
    uid = new_id()
    key = f"originals/{p.user.id}/{uid}/original{ext}"
    upload_id = storage.start_multipart(key, body.mime_type)
    sess = UploadSession(
        id=uid, owner_id=p.user.id, title=body.title or os.path.splitext(body.filename)[0], source=body.source,
        filename=body.filename, declared_mime=body.mime_type, total_size=body.size, chunk_size=s.upload_chunk_bytes,
        fingerprint=body.fingerprint, storage_key=key, s3_upload_id=upload_id, parts={},
        language_hint=body.language_hint, expected_speakers=body.expected_speakers,
    )
    db.add(sess)
    db.commit()
    return _session_out(sess)


def _own_session(db: Session, p: Principal, upload_id: str, lock: bool = False) -> UploadSession:
    q = select(UploadSession).where(UploadSession.id == parse_uuid(upload_id))
    if lock:
        q = q.with_for_update()
    sess = db.execute(q).scalar_one_or_none()
    if sess is None or sess.owner_id != p.user.id:
        raise HTTPException(404, "Upload not found.")
    return sess


@router.get("/{upload_id}")
def get_upload(upload_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return _session_out(_own_session(db, p, upload_id))


@router.put("/{upload_id}/parts/{part_number}")
async def put_part(upload_id: str, part_number: int, request: Request, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    sess = _own_session(db, p, upload_id)
    if sess.status != "open":
        raise HTTPException(409, "Upload is not open.")
    total = -(-sess.total_size // sess.chunk_size)
    if part_number < 1 or part_number > total:
        raise HTTPException(422, "Invalid part number.")
    expected = sess.chunk_size if part_number < total else sess.total_size - sess.chunk_size * (total - 1)
    data = await request.body()
    if len(data) != expected:
        raise HTTPException(422, f"Part {part_number} must be exactly {expected} bytes.")
    digest = hashlib.sha256(data).hexdigest()
    claimed = request.headers.get("x-chunk-sha256")
    if claimed and claimed.lower() != digest:
        raise HTTPException(422, "Chunk checksum mismatch; resend this part.")
    if part_number == 1:
        head = data[:64]
        sniffed = audio.sniff_mime(head)
        if sniffed is None:
            raise HTTPException(415, "File content is not a recognised audio container.")
    etag = storage.upload_part(sess.storage_key, sess.s3_upload_id, part_number, data)
    sess = _own_session(db, p, upload_id, lock=True)
    parts = dict(sess.parts)
    parts[str(part_number)] = {"etag": etag, "size": len(data), "sha256": digest}
    if part_number == 1:
        parts["1"]["sniffed_mime"] = audio.sniff_mime(data[:64])
    sess.parts = parts
    db.commit()
    return _session_out(sess)


@router.post("/{upload_id}/complete")
def complete_upload(upload_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    sess = _own_session(db, p, upload_id, lock=True)
    if sess.status == "complete" and sess.recording_id:
        rec = db.get(Recording, sess.recording_id)
        assert rec is not None
        return {"recording": recording_out(rec)}  # idempotent
    total = -(-sess.total_size // sess.chunk_size)
    missing = [n for n in range(1, total + 1) if str(n) not in sess.parts]
    if missing:
        raise HTTPException(409, {"message": "Upload incomplete.", "missing_parts": missing[:50]})
    result = storage.complete_multipart(sess.storage_key, sess.s3_upload_id, [(int(n), v["etag"]) for n, v in sess.parts.items()])
    version_id = result.get("VersionId")
    # SHA-256 of the stored original, computed immediately from the stored bytes.
    digest, size = storage.sha256_of_object(sess.storage_key, version_id)
    if size != sess.total_size:
        raise HTTPException(500, "Stored size does not match the declared size.")
    uploaded_at = datetime.now(timezone.utc)
    sniffed = sess.parts["1"].get("sniffed_mime")
    rec = Recording(
        owner_id=p.user.id, title=sess.title, source=sess.source, original_filename=sess.filename,
        mime_type=sniffed or sess.declared_mime, byte_size=size, sha256=digest, storage_key=sess.storage_key,
        storage_version_id=version_id, uploaded_at=uploaded_at, language_hint=sess.language_hint,
        expected_speakers=sess.expected_speakers, status="queued", status_detail="Queued for processing",
    )
    db.add(rec)
    db.flush()
    sess.status = "complete"
    sess.recording_id = rec.id
    audit.record(db, "upload", actor=p.user, recording_id=rec.id, details={
        "filename": sess.filename, "declared_mime": sess.declared_mime, "detected_mime": sniffed, "byte_size": size,
        "storage_key": sess.storage_key, "storage_version_id": version_id, "source": sess.source,
        "uploaded_at_utc": uploaded_at.isoformat(), "parts": len(sess.parts)})
    audit.record(db, "hash_created", actor_label="system", recording_id=rec.id, details={"algorithm": "SHA-256", "sha256": digest, "byte_size": size})
    jobs.enqueue(db, "process_recording", rec.id)
    db.commit()
    return {"recording": recording_out(rec)}


@router.delete("/{upload_id}")
def abort_upload(upload_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    sess = _own_session(db, p, upload_id, lock=True)
    if sess.status != "open":
        raise HTTPException(409, "Upload is not open.")
    storage.abort_multipart(sess.storage_key, sess.s3_upload_id)
    sess.status = "aborted"
    db.commit()
    return {"ok": True}
