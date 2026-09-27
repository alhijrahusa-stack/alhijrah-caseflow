from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, storage
from ..canonical import sha256_hex
from ..db import get_db
from ..exports import professional, render
from ..models import (
    AuditEvent,
    Dispute,
    ExportRecord,
    ProviderRun,
    Recording,
    TranscriptRevision,
    Translation,
    User,
)
from ..security import Principal, current_principal, load_recording
from .common import dispute_out, iso, parse_uuid, run_out, translation_out

router = APIRouter(prefix="/api")

CONTENT_TYPES = {
    "txt": "text/plain; charset=utf-8",
    "json": "application/json",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
    "zip": "application/zip",
}


class ExportIn(BaseModel):
    format: str = Field(pattern="^(txt|docx|pdf|json|zip)$")
    revision_id: str | None = None
    translation_id: str | None = None


def build_context(db: Session, rec: Recording, rev: TranscriptRevision) -> dict[str, Any]:
    users = {u.id: u.email for u in db.execute(select(User)).scalars()}
    engines = [
        {"provider": r.provider, "model": r.model, "role": r.role}
        for r in db.execute(select(ProviderRun).where(ProviderRun.recording_id == rec.id, ProviderRun.status == "succeeded",
                                                      ProviderRun.scope_key == "full")).scalars()
    ]
    return {
        "recording": {"id": str(rec.id), "title": rec.title, "original_filename": rec.original_filename, "mime_type": rec.mime_type,
                      "byte_size": rec.byte_size, "sha256": rec.sha256, "uploaded_at": iso(rec.uploaded_at), "duration_ms": rec.duration_ms,
                      "storage_version_id": rec.storage_version_id},
        "revision": {"id": str(rev.id), "number": rev.number, "status": rev.status, "sha256": rev.sha256,
                     "locked_at": iso(rev.locked_at), "locked_by": users.get(rev.locked_by) if rev.locked_by else None},
        "engines": engines,
        "content": rev.content,
    }


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:80] or "recording"


@router.post("/recordings/{recording_id}/exports")
def create_export(recording_id: str, body: ExportIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id), "export")
    q = select(TranscriptRevision).where(TranscriptRevision.recording_id == rec.id, TranscriptRevision.status == "locked")
    if body.revision_id:
        q = q.where(TranscriptRevision.id == parse_uuid(body.revision_id))
    rev = db.execute(q.order_by(TranscriptRevision.number.desc()).limit(1)).scalar_one_or_none()
    if rev is None:
        raise HTTPException(409, "Exports are generated only from a locked forensic transcript.")
    ctx = build_context(db, rec, rev)
    translation = None
    if body.translation_id:
        t = db.get(Translation, parse_uuid(body.translation_id))
        if t is None or t.recording_id != rec.id or t.status != "succeeded":
            raise HTTPException(404, "Translation not found or not complete.")
        translation = translation_out(t)
    base = f"MURAILEX_{_safe(rec.title)}_r{rev.number}"
    details: dict[str, Any] = {}
    if body.format == "zip":
        digest, size = storage.sha256_of_object(rec.storage_key, rec.storage_version_id)
        reverified = {"sha256": digest, "bytes": size, "matches": digest == rec.sha256 and size == rec.byte_size}
        if not reverified["matches"]:
            audit.record(db, "integrity_failure", actor=p.user, recording_id=rec.id, details=reverified)
            db.commit()
            raise HTTPException(500, "Original evidence failed SHA-256 re-verification. Export refused.")
        translations = [translation_out(t) for t in db.execute(
            select(Translation).where(Translation.recording_id == rec.id, Translation.status == "succeeded",
                                      Translation.source_revision_id == rev.id)).scalars()]
        revisions = [{"id": str(r.id), "number": r.number, "status": r.status, "sha256": r.sha256, "parent_id": str(r.parent_id) if r.parent_id else None,
                      "created_at": iso(r.created_at), "locked_at": iso(r.locked_at)}
                     for r in db.execute(select(TranscriptRevision).where(TranscriptRevision.recording_id == rec.id).order_by(TranscriptRevision.number)).scalars()]
        events = [audit.serialize(e) for e in db.execute(select(AuditEvent).where(AuditEvent.recording_id == rec.id).order_by(AuditEvent.id)).scalars()]
        runs = [run_out(r, include_raw=True) for r in db.execute(select(ProviderRun).where(ProviderRun.recording_id == rec.id).order_by(ProviderRun.created_at)).scalars()]
        disputes = [dispute_out(d) for d in db.execute(select(Dispute).where(Dispute.recording_id == rec.id).order_by(Dispute.ordinal)).scalars()]
        data, manifest = render.build_package(ctx, {
            "revisions": revisions, "audit": events, "provider_runs": runs, "disputes": disputes, "translations": translations,
            "actor": p.user.email, "reverified": reverified, "audit_chain": audit.verify_chain(db)})
        filename = f"MURAILEX Forensic Evidence Package - {_safe(rec.title)} r{rev.number}.zip"
        details["manifest_files"] = len(manifest["files"])
    elif body.format == "txt":
        data, filename = render.render_txt(ctx, translation), f"{base}.txt"
    elif body.format == "docx":
        data, filename = render.render_docx(ctx, translation), f"{base}.docx"
    elif body.format == "pdf":
        if translation is None:
            data = professional.render_professional_pdf(ctx)
            filename = f"MURAILEX Forensic Audio Report - {_safe(rec.title)} r{rev.number}.pdf"
            details["layout"] = "professional_forensic_report"
            details["summary"] = "extractive_from_locked_transcript"
        else:
            data, filename = render.render_pdf(ctx, translation), f"{base}.pdf"
    else:
        data = render.render_json(ctx) if translation is None else __import__("json").dumps(translation, ensure_ascii=False, indent=2).encode()
        filename = f"{base}.json"
    if translation:
        filename = filename.replace(base, f"{base}_{translation['mode']}")
    digest = sha256_hex(data)
    key = f"exports/{rec.id}/{digest[:16]}-{_safe(filename)}"
    storage.put_bytes(key, data, CONTENT_TYPES[body.format], lock=True)
    exp = ExportRecord(recording_id=rec.id, revision_id=rev.id, format=body.format, storage_key=key, filename=filename,
                       byte_size=len(data), sha256=digest, created_by=p.user.id)
    db.add(exp)
    db.flush()
    audit.record(db, "export", actor=p.user, recording_id=rec.id, details={
        "export_id": str(exp.id), "format": body.format, "revision_id": str(rev.id), "revision_sha256": rev.sha256,
        "translation_id": translation["id"] if translation else None, "sha256": digest, "bytes": len(data), **details})
    db.commit()
    return {"export": {"id": str(exp.id), "format": exp.format, "filename": filename, "sha256": digest, "bytes": len(data),
                       "download_url": f"/api/exports/{exp.id}/download"}}


@router.get("/recordings/{recording_id}/exports")
def list_exports(recording_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rec = load_recording(db, p, parse_uuid(recording_id))
    rows = db.execute(select(ExportRecord).where(ExportRecord.recording_id == rec.id).order_by(ExportRecord.created_at.desc())).scalars()
    return {"exports": [{"id": str(e.id), "format": e.format, "filename": e.filename, "sha256": e.sha256, "bytes": e.byte_size,
                         "created_at": iso(e.created_at), "download_url": f"/api/exports/{e.id}/download"} for e in rows]}


@router.get("/exports/{export_id}/download")
def download_export(export_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    exp = db.get(ExportRecord, parse_uuid(export_id))
    if exp is None:
        raise HTTPException(404, "Not found.")
    load_recording(db, p, exp.recording_id, "export")
    obj = storage.get_stream(exp.storage_key)
    from urllib.parse import quote

    return StreamingResponse(obj["Body"].iter_chunks(256 * 1024), media_type=CONTENT_TYPES[exp.format], headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(exp.filename)}", "Cache-Control": "private, no-store",
        "X-Content-SHA256": exp.sha256})
