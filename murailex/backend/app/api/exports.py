from __future__ import annotations

import json
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
from ..exports import legal_pdf, render
from ..models import (
    AuditEvent,
    Dispute,
    ExportRecord,
    ProviderRun,
    Recording,
    Summary,
    TranscriptRevision,
    Translation,
    User,
)
from ..security import Principal, current_principal, load_recording
from .common import dispute_out, iso, parse_uuid, run_out, translation_out
from .summaries import summary_out, transcript_binding_sha

router = APIRouter(prefix="/api")

CONTENT_TYPES = {
    "txt": "text/plain; charset=utf-8",
    "json": "application/json",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
    "zip": "application/zip",
}
PDF_DOCUMENT_TYPES = {"summary", "transcript", "complete_case"}


class ExportIn(BaseModel):
    format: str = Field(pattern="^(txt|docx|pdf|json|zip)$")
    revision_id: str | None = None
    translation_id: str | None = None
    document_type: str = Field(default="transcript", pattern="^(summary|transcript|complete_case)$")
    summary_id: str | None = None


def build_context(db: Session, rec: Recording, rev: TranscriptRevision) -> dict[str, Any]:
    users = {user.id: user.email for user in db.execute(select(User)).scalars()}
    engines = [
        {"provider": run.provider, "model": run.model, "role": run.role}
        for run in db.execute(
            select(ProviderRun).where(
                ProviderRun.recording_id == rec.id,
                ProviderRun.status == "succeeded",
                ProviderRun.scope_key == "full",
            )
        ).scalars()
    ]
    return {
        "recording": {
            "id": str(rec.id),
            "title": rec.title,
            "original_filename": rec.original_filename,
            "mime_type": rec.mime_type,
            "byte_size": rec.byte_size,
            "sha256": rec.sha256,
            "uploaded_at": iso(rec.uploaded_at),
            "duration_ms": rec.duration_ms,
            "storage_version_id": rec.storage_version_id,
            "language_locale": rec.language_locale,
            "recording_type": rec.recording_type,
            "expected_terms": rec.expected_terms,
        },
        "revision": {
            "id": str(rev.id),
            "number": rev.number,
            "status": rev.status,
            "review_state": rev.review_state,
            "sha256": rev.sha256,
            "locked_at": iso(rev.locked_at),
            "locked_by": users.get(rev.locked_by) if rev.locked_by else None,
        },
        "engines": engines,
        "content": rev.content,
        "transcript_binding_sha": transcript_binding_sha(rec, rev),
    }


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:80] or "recording"


def _revision(
    db: Session,
    rec: Recording,
    revision_id: str | None,
    *,
    require_locked: bool,
) -> TranscriptRevision:
    query = select(TranscriptRevision).where(TranscriptRevision.recording_id == rec.id)
    if require_locked:
        query = query.where(TranscriptRevision.status == "locked")
    if revision_id:
        query = query.where(TranscriptRevision.id == parse_uuid(revision_id))
    revision = db.execute(
        query.order_by(TranscriptRevision.number.desc()).limit(1)
    ).scalar_one_or_none()
    if revision is None:
        if require_locked:
            raise HTTPException(409, "Export requires a locked forensic transcript.")
        raise HTTPException(409, "Transcript revision not found.")
    return revision


def _summary_for_export(
    db: Session,
    rec: Recording,
    rev: TranscriptRevision,
    summary_id: str | None,
) -> Summary:
    query = select(Summary).where(
        Summary.recording_id == rec.id,
        Summary.transcript_revision_id == rev.id,
    )
    if summary_id:
        query = query.where(Summary.id == parse_uuid(summary_id))
    summary = db.execute(
        query.order_by(Summary.generated_at.desc(), Summary.summary_revision.desc()).limit(1)
    ).scalar_one_or_none()
    if summary is None:
        raise HTTPException(409, "Generate a summary for this transcript revision before export.")

    expected_sha = transcript_binding_sha(rec, rev)
    if summary.transcript_revision_id != rev.id:
        raise HTTPException(409, "EXPORT FAIL: summary/transcript revision mismatch.")
    if summary.transcript_sha256 != expected_sha:
        raise HTTPException(409, "EXPORT FAIL: summary/transcript SHA-256 mismatch.")
    if rev.status == "locked" and summary.transcript_sha256 != rev.sha256:
        raise HTTPException(409, "EXPORT FAIL: summary does not match the locked transcript SHA-256.")
    return summary


def _verify_original(db: Session, rec: Recording, principal: Principal) -> dict[str, Any]:
    digest, size = storage.sha256_of_object(rec.storage_key, rec.storage_version_id)
    result = {
        "sha256": digest,
        "bytes": size,
        "matches": digest == rec.sha256 and size == rec.byte_size,
    }
    if not result["matches"]:
        audit.record(
            db,
            "integrity_failure",
            actor=principal.user,
            recording_id=rec.id,
            details=result,
        )
        db.commit()
        raise HTTPException(500, "Original evidence failed SHA-256 re-verification. Export refused.")
    return result


@router.post("/recordings/{recording_id}/exports")
def create_export(
    recording_id: str,
    body: ExportIn,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    rec = load_recording(db, p, parse_uuid(recording_id), "export")
    is_legal_pdf = body.format == "pdf" and body.translation_id is None
    require_locked = not is_legal_pdf
    rev = _revision(db, rec, body.revision_id, require_locked=require_locked)
    ctx = build_context(db, rec, rev)

    translation = None
    if body.translation_id:
        translation_row = db.get(Translation, parse_uuid(body.translation_id))
        if (
            translation_row is None
            or translation_row.recording_id != rec.id
            or translation_row.status != "succeeded"
        ):
            raise HTTPException(404, "Translation not found or not complete.")
        if translation_row.source_revision_id != rev.id:
            raise HTTPException(409, "EXPORT FAIL: translation/revision mismatch.")
        translation = translation_out(translation_row)

    summary_row: Summary | None = None
    if is_legal_pdf and body.document_type in {"summary", "complete_case"}:
        summary_row = _summary_for_export(db, rec, rev, body.summary_id)

    base = f"MURAILEX_{_safe(rec.title)}_r{rev.number}"
    details: dict[str, Any] = {"document_type": body.document_type}

    if body.format == "zip":
        reverified = _verify_original(db, rec, p)
        translations = [
            translation_out(row)
            for row in db.execute(
                select(Translation).where(
                    Translation.recording_id == rec.id,
                    Translation.status == "succeeded",
                    Translation.source_revision_id == rev.id,
                )
            ).scalars()
        ]
        revisions = [
            {
                "id": str(row.id),
                "number": row.number,
                "status": row.status,
                "sha256": row.sha256,
                "parent_id": str(row.parent_id) if row.parent_id else None,
                "created_at": iso(row.created_at),
                "locked_at": iso(row.locked_at),
            }
            for row in db.execute(
                select(TranscriptRevision)
                .where(TranscriptRevision.recording_id == rec.id)
                .order_by(TranscriptRevision.number)
            ).scalars()
        ]
        events = [
            audit.serialize(event)
            for event in db.execute(
                select(AuditEvent)
                .where(AuditEvent.recording_id == rec.id)
                .order_by(AuditEvent.id)
            ).scalars()
        ]
        runs = [
            run_out(run, include_raw=True)
            for run in db.execute(
                select(ProviderRun)
                .where(ProviderRun.recording_id == rec.id)
                .order_by(ProviderRun.created_at)
            ).scalars()
        ]
        disputes = [
            dispute_out(dispute)
            for dispute in db.execute(
                select(Dispute)
                .where(Dispute.recording_id == rec.id)
                .order_by(Dispute.ordinal)
            ).scalars()
        ]
        data, manifest = render.build_package(
            ctx,
            {
                "revisions": revisions,
                "audit": events,
                "provider_runs": runs,
                "disputes": disputes,
                "translations": translations,
                "actor": p.user.email,
                "reverified": reverified,
                "audit_chain": audit.verify_chain(db),
            },
        )
        filename = f"MURAILEX Forensic Evidence Package - {_safe(rec.title)} r{rev.number}.zip"
        details["manifest_files"] = len(manifest["files"])
        details["document_type"] = "evidence_package"
    elif body.format == "txt":
        data = render.render_txt(ctx, translation)
        filename = f"{base}.txt"
    elif body.format == "docx":
        data = render.render_docx(ctx, translation)
        filename = f"{base}.docx"
    elif body.format == "pdf":
        if translation is not None:
            if body.document_type != "transcript":
                raise HTTPException(422, "Translated PDF supports transcript document type only.")
            data = render.render_pdf(ctx, translation)
            filename = f"{base}_{translation['mode']}.pdf"
        else:
            reverified = _verify_original(db, rec, p)
            ctx["integrity_verification"] = "VERIFIED" if reverified["matches"] else "FAILED"
            summary_doc = summary_out(summary_row) if summary_row is not None else None
            data = legal_pdf.render_legal_pdf(ctx, body.document_type, summary_doc)
            label = {
                "summary": "Summary",
                "transcript": "Transcript",
                "complete_case": "Complete Case",
            }[body.document_type]
            filename = f"MURAILEX {label} - {_safe(rec.title)} r{rev.number}.pdf"
            details.update(
                {
                    "layout": "professional_revision_bound_legal_pdf",
                    "summary_id": str(summary_row.id) if summary_row else None,
                    "transcript_binding_sha256": transcript_binding_sha(rec, rev),
                    "integrity_reverified": reverified,
                }
            )
    else:
        data = (
            render.render_json(ctx)
            if translation is None
            else json.dumps(translation, ensure_ascii=False, indent=2).encode()
        )
        filename = f"{base}.json"

    digest = sha256_hex(data)
    key = f"exports/{rec.id}/{digest[:16]}-{_safe(filename)}"
    storage.put_bytes(key, data, CONTENT_TYPES[body.format], lock=True)
    export = ExportRecord(
        recording_id=rec.id,
        revision_id=rev.id,
        summary_id=summary_row.id if summary_row else None,
        format=body.format,
        document_type=details.get("document_type", body.document_type),
        storage_key=key,
        filename=filename,
        byte_size=len(data),
        sha256=digest,
        created_by=p.user.id,
    )
    db.add(export)
    db.flush()
    audit.record(
        db,
        "export",
        actor=p.user,
        recording_id=rec.id,
        details={
            "export_id": str(export.id),
            "format": body.format,
            "document_type": export.document_type,
            "revision_id": str(rev.id),
            "revision_sha256": rev.sha256,
            "transcript_binding_sha256": transcript_binding_sha(rec, rev),
            "summary_id": str(summary_row.id) if summary_row else None,
            "translation_id": translation["id"] if translation else None,
            "sha256": digest,
            "bytes": len(data),
            **details,
        },
    )
    db.commit()
    return {
        "export": {
            "id": str(export.id),
            "format": export.format,
            "document_type": export.document_type,
            "filename": filename,
            "sha256": digest,
            "bytes": len(data),
            "download_url": f"/api/exports/{export.id}/download",
        }
    }


@router.get("/recordings/{recording_id}/exports")
def list_exports(
    recording_id: str,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    rec = load_recording(db, p, parse_uuid(recording_id))
    rows = db.execute(
        select(ExportRecord)
        .where(ExportRecord.recording_id == rec.id)
        .order_by(ExportRecord.created_at.desc())
    ).scalars()
    return {
        "exports": [
            {
                "id": str(export.id),
                "format": export.format,
                "document_type": export.document_type,
                "filename": export.filename,
                "sha256": export.sha256,
                "bytes": export.byte_size,
                "created_at": iso(export.created_at),
                "download_url": f"/api/exports/{export.id}/download",
            }
            for export in rows
        ]
    }


@router.get("/exports/{export_id}/download")
def download_export(
    export_id: str,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    export = db.get(ExportRecord, parse_uuid(export_id))
    if export is None:
        raise HTTPException(404, "Not found.")
    load_recording(db, p, export.recording_id, "export")
    obj = storage.get_stream(export.storage_key)
    from urllib.parse import quote

    return StreamingResponse(
        obj["Body"].iter_chunks(256 * 1024),
        media_type=CONTENT_TYPES[export.format],
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(export.filename)}",
            "Cache-Control": "private, no-store",
            "X-Content-SHA256": export.sha256,
        },
    )
