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

LOCALE_PATTERN = r"^(ar|ar-YE|ar-EG|ar-SY|ar-LB|ar-IQ)$"
RECORDING_TYPE_PATTERN = (
    r"^(interrogation|witness_testimony|meeting|phone_call|court_session|"
    r"third_circuit_transcript|michigan_appellate_transcript|other)$"
)


class UploadIn(BaseModel):
    filename: str = Field(min_length=1, max_length=500)
    mime_type: str = Field(default="application/octet-stream", max_length=100)
    size: int = Field(gt=0)
    fingerprint: str = Field(min_length=1, max_length=200)
    title: str = Field(default="", max_length=300)
    source: str = Field(default="upload", pattern="^(upload|recording)$")
    language_locale: str = Field(pattern=LOCALE_PATTERN)
    recording_type: str = Field(pattern=RECORDING_TYPE_PATTERN)
    expected_terms: list[str] | None = Field(default=None, max_length=50)
    expected_speakers: int | None = Field(default=None, ge=1, le=20)


def _session_out(session: UploadSession) -> dict:
    received = sorted(int(n) for n in session.parts)
    return {
        "id": str(session.id),
        "status": session.status,
        "chunk_size": session.chunk_size,
        "total_size": session.total_size,
        "received_parts": received,
        "total_parts": -(-session.total_size // session.chunk_size),
        "received_bytes": sum(int(part["size"]) for part in session.parts.values()),
        "recording_id": str(session.recording_id) if session.recording_id else None,
    }


@router.post("")
def create_upload(
    body: UploadIn,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    require_capability(p, "upload")
    settings = get_settings()
    if body.size > settings.max_upload_bytes:
        raise HTTPException(413, "File exceeds the maximum upload size.")
    ext = os.path.splitext(body.filename.lower())[1]
    if ext not in audio.ALLOWED_EXTENSIONS:
        raise HTTPException(415, "Unsupported audio file type.")
    accepted_mimes = {
        "video/mp4",
        "video/webm",
        "video/3gpp",
        "video/quicktime",
        "application/octet-stream",
    }
    if not (body.mime_type.startswith("audio/") or body.mime_type in accepted_mimes):
        raise HTTPException(415, "Unsupported MIME type.")

    existing = db.execute(
        select(UploadSession).where(
            UploadSession.owner_id == p.user.id,
            UploadSession.fingerprint == body.fingerprint,
            UploadSession.status == "open",
            UploadSession.total_size == body.size,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _session_out(existing)

    upload_id = new_id()
    key = f"originals/{p.user.id}/{upload_id}/original{ext}"
    s3_upload_id = storage.start_multipart(key, body.mime_type)
    session = UploadSession(
        id=upload_id,
        owner_id=p.user.id,
        title=body.title or os.path.splitext(body.filename)[0],
        source=body.source,
        filename=body.filename,
        declared_mime=body.mime_type,
        total_size=body.size,
        chunk_size=settings.upload_chunk_bytes,
        fingerprint=body.fingerprint,
        storage_key=key,
        s3_upload_id=s3_upload_id,
        parts={},
        language_locale=body.language_locale,
        recording_type=body.recording_type,
        expected_terms=body.expected_terms,
        expected_speakers=body.expected_speakers,
    )
    db.add(session)
    db.commit()
    return _session_out(session)


def _own_session(
    db: Session,
    principal: Principal,
    upload_id: str,
    lock: bool = False,
) -> UploadSession:
    query = select(UploadSession).where(UploadSession.id == parse_uuid(upload_id))
    if lock:
        query = query.with_for_update()
    session = db.execute(query).scalar_one_or_none()
    if session is None or session.owner_id != principal.user.id:
        raise HTTPException(404, "Upload not found.")
    return session


@router.get("/{upload_id}")
def get_upload(
    upload_id: str,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    return _session_out(_own_session(db, p, upload_id))


@router.put("/{upload_id}/parts/{part_number}")
async def put_part(
    upload_id: str,
    part_number: int,
    request: Request,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    session = _own_session(db, p, upload_id)
    if session.status != "open":
        raise HTTPException(409, "Upload is not open.")
    total = -(-session.total_size // session.chunk_size)
    if part_number < 1 or part_number > total:
        raise HTTPException(422, "Invalid part number.")
    expected = (
        session.chunk_size
        if part_number < total
        else session.total_size - session.chunk_size * (total - 1)
    )
    data = await request.body()
    if len(data) != expected:
        raise HTTPException(422, f"Part {part_number} must be exactly {expected} bytes.")
    digest = hashlib.sha256(data).hexdigest()
    claimed = request.headers.get("x-chunk-sha256")
    if claimed and claimed.lower() != digest:
        raise HTTPException(422, "Chunk checksum mismatch; resend this part.")
    if part_number == 1 and audio.sniff_mime(data[:64]) is None:
        raise HTTPException(415, "File content is not a recognised audio container.")

    etag = storage.upload_part(session.storage_key, session.s3_upload_id, part_number, data)
    session = _own_session(db, p, upload_id, lock=True)
    parts = dict(session.parts)
    parts[str(part_number)] = {"etag": etag, "size": len(data), "sha256": digest}
    if part_number == 1:
        parts["1"]["sniffed_mime"] = audio.sniff_mime(data[:64])
    session.parts = parts
    db.commit()
    return _session_out(session)


@router.post("/{upload_id}/complete")
def complete_upload(
    upload_id: str,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    session = _own_session(db, p, upload_id, lock=True)
    if session.status == "complete" and session.recording_id:
        recording = db.get(Recording, session.recording_id)
        assert recording is not None
        return {"recording": recording_out(recording)}

    total = -(-session.total_size // session.chunk_size)
    missing = [number for number in range(1, total + 1) if str(number) not in session.parts]
    if missing:
        raise HTTPException(409, {"message": "Upload incomplete.", "missing_parts": missing[:50]})

    result = storage.complete_multipart(
        session.storage_key,
        session.s3_upload_id,
        [(int(number), value["etag"]) for number, value in session.parts.items()],
    )
    version_id = result.get("VersionId")
    digest, size = storage.sha256_of_object(session.storage_key, version_id)
    if size != session.total_size:
        raise HTTPException(500, "Stored size does not match the declared size.")

    uploaded_at = datetime.now(timezone.utc)
    sniffed = session.parts["1"].get("sniffed_mime")
    recording = Recording(
        owner_id=p.user.id,
        title=session.title,
        source=session.source,
        original_filename=session.filename,
        mime_type=sniffed or session.declared_mime,
        byte_size=size,
        sha256=digest,
        storage_key=session.storage_key,
        storage_version_id=version_id,
        uploaded_at=uploaded_at,
        language_locale=session.language_locale,
        recording_type=session.recording_type,
        expected_terms=session.expected_terms,
        expected_speakers=session.expected_speakers,
        status="queued",
        status_detail="Queued for processing",
    )
    db.add(recording)
    db.flush()
    session.status = "complete"
    session.recording_id = recording.id
    audit.record(
        db,
        "upload",
        actor=p.user,
        recording_id=recording.id,
        details={
            "filename": session.filename,
            "declared_mime": session.declared_mime,
            "detected_mime": sniffed,
            "byte_size": size,
            "storage_key": session.storage_key,
            "storage_version_id": version_id,
            "source": session.source,
            "language_locale": session.language_locale,
            "recording_type": session.recording_type,
            "expected_terms": session.expected_terms,
            "uploaded_at_utc": uploaded_at.isoformat(),
            "parts": len(session.parts),
        },
    )
    audit.record(
        db,
        "hash_created",
        actor_label="system",
        recording_id=recording.id,
        details={"algorithm": "SHA-256", "sha256": digest, "byte_size": size},
    )
    jobs.enqueue(db, "process_recording", recording.id)
    db.commit()
    return {"recording": recording_out(recording)}


@router.delete("/{upload_id}")
def abort_upload(
    upload_id: str,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    session = _own_session(db, p, upload_id, lock=True)
    if session.status != "open":
        raise HTTPException(409, "Upload is not open.")
    storage.abort_multipart(session.storage_key, session.s3_upload_id)
    session.status = "aborted"
    db.commit()
    return {"ok": True}
