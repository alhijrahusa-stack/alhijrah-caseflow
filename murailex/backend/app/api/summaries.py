"""Summary workspace and export endpoints with revision/SHA binding."""
from __future__ import annotations

import hashlib
import io
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, storage
from ..db import get_db
from ..exports.professional import render_professional_pdf
from ..models import ExportRecord, Recording, Summary, TranscriptRevision, User
from ..security import Principal, current_principal, load_recording
from .common import iso, parse_uuid, recording_out, revision_out

router = APIRouter(prefix="/api")


def _users(db: Session) -> dict[str, str]:
    return {str(u.id): u.email for u in db.execute(select(User)).scalars()}


@router.get("/recordings/{recording_id}/summaries")
def list_summaries(recording_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """List all summaries for a recording."""
    rec = load_recording(db, p, parse_uuid(recording_id))
    summaries = db.execute(
        select(Summary)
        .where(Summary.recording_id == rec.id)
        .order_by(Summary.summary_type, Summary.summary_revision.desc())
    ).scalars()
    return {
        "summaries": [
            {
                "id": str(s.id),
                "recording_id": str(s.recording_id),
                "transcript_revision_id": str(s.transcript_revision_id),
                "transcript_sha256": s.transcript_sha256,
                "summary_type": s.summary_type,
                "summary_revision": s.summary_revision,
                "status": s.status,
                "content": s.content,
                "generated_at": iso(s.generated_at),
                "generation_model": s.generation_model,
                "created_at": iso(s.created_at),
            }
            for s in summaries
        ]
    }


@router.get("/recordings/{recording_id}/summaries/{summary_type}")
def get_summary(recording_id: str, summary_type: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """Get the latest summary of a specific type."""
    rec = load_recording(db, p, parse_uuid(recording_id))
    summary = db.execute(
        select(Summary)
        .where(Summary.recording_id == rec.id, Summary.summary_type == summary_type)
        .order_by(Summary.summary_revision.desc())
        .limit(1)
    ).scalar_one_or_none()
    if not summary:
        raise HTTPException(404, f"No {summary_type} summary found.")
    return {
        "id": str(summary.id),
        "recording_id": str(summary.recording_id),
        "transcript_revision_id": str(summary.transcript_revision_id),
        "transcript_sha256": summary.transcript_sha256,
        "summary_type": summary.summary_type,
        "summary_revision": summary.summary_revision,
        "status": summary.status,
        "content": summary.content,
        "generated_at": iso(summary.generated_at),
        "generation_model": summary.generation_model,
        "created_at": iso(summary.created_at),
    }


class ExportIn(BaseModel):
    format: str = Field(pattern="^(txt|pdf|docx|json|zip)$")
    revision_id: str | None = None
    summary_id: str | None = None
    export_type: str = Field(default="transcript", pattern="^(transcript|summary|complete_case|evidence_package)$")


@router.post("/recordings/{recording_id}/exports")
def create_export(recording_id: str, body: ExportIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """Create and return an export with strict revision/SHA binding."""
    rec = load_recording(db, p, parse_uuid(recording_id))
    revision_id = parse_uuid(body.revision_id) if body.revision_id else None
    summary_id = parse_uuid(body.summary_id) if body.summary_id else None

    # Get or default to latest locked revision
    if revision_id:
        rev = db.get(TranscriptRevision, revision_id)
        if not rev or rev.recording_id != rec.id or rev.status != "locked":
            raise HTTPException(409, "Revision must be locked for export.")
    else:
        rev = db.execute(
            select(TranscriptRevision)
            .where(TranscriptRevision.recording_id == rec.id, TranscriptRevision.status == "locked")
            .order_by(TranscriptRevision.number.desc())
            .limit(1)
        ).scalar_one_or_none()
        if not rev:
            raise HTTPException(409, "No locked revision available for export.")

    # Validate summary if provided and document_type is summary/complete_case
    summary = None
    if summary_id or body.export_type in ("summary", "complete_case"):
        if summary_id:
            summary = db.get(Summary, summary_id)
            if not summary or summary.recording_id != rec.id or summary.transcript_revision_id != rev.id:
                raise HTTPException(409, "Summary must match the transcript revision.")
        else:
            # Default to latest neutral summary for this revision
            summary = db.execute(
                select(Summary)
                .where(
                    Summary.recording_id == rec.id,
                    Summary.transcript_revision_id == rev.id,
                    Summary.summary_type == "neutral",
                )
                .order_by(Summary.summary_revision.desc())
                .limit(1)
            ).scalar_one_or_none()
            if not summary and body.export_type in ("summary", "complete_case"):
                raise HTTPException(409, "No neutral summary found for this revision.")

    # Render PDF
    if body.format == "pdf":
        content = rev.content or {}
        ctx = {
            "recording": recording_out(rec),
            "revision": {
                "id": str(rev.id),
                "number": rev.number,
                "status": rev.status,
                "sha256": rev.sha256,
                "created_at": iso(rev.created_at),
                "locked_at": iso(rev.locked_at),
                "locked_by": rev.locked_by,
            },
            "content": content,
            "engines": content.get("method", {}).get("primary_engines", []),
        }

        if body.export_type == "transcript":
            pdf_bytes = render_professional_pdf(ctx)
        elif body.export_type == "summary":
            # Summary-only PDF: key passages and critical moments
            pdf_bytes = _render_summary_pdf(ctx, summary.content if summary else {})
        elif body.export_type == "complete_case":
            # Complete case: full transcript + summary + integrity record
            pdf_bytes = _render_complete_case_pdf(ctx, summary.content if summary else {})
        else:
            raise HTTPException(422, f"PDF export for {body.export_type} not supported.")

        # Compute PDF SHA
        pdf_sha = hashlib.sha256(pdf_bytes).hexdigest()
        filename = f"{rec.id}-{rev.number}-{body.export_type}.pdf"
    else:
        raise HTTPException(501, f"Format {body.format} not yet implemented.")

    # Store export
    key = f"exports/{rec.id}/{rev.id}/{body.export_type}.{body.format}"
    storage.put_bytes(key, pdf_bytes if body.format == "pdf" else b"")
    exp = ExportRecord(
        recording_id=rec.id,
        revision_id=rev.id,
        summary_id=summary.id if summary else None,
        format=body.format,
        document_type=body.export_type,
        storage_key=key,
        filename=filename,
        byte_size=len(pdf_bytes) if body.format == "pdf" else 0,
        sha256=pdf_sha if body.format == "pdf" else "",
        created_by=p.user.id,
    )
    db.add(exp)
    audit.record(
        db,
        "export_created",
        actor=p.user,
        recording_id=rec.id,
        details={
            "export_id": str(exp.id),
            "format": body.format,
            "document_type": body.export_type,
            "revision_id": str(rev.id),
            "revision_sha256": rev.sha256,
            "summary_id": str(summary.id) if summary else None,
            "pdf_sha256": pdf_sha if body.format == "pdf" else None,
        },
    )
    db.commit()

    return {
        "export": {
            "id": str(exp.id),
            "format": exp.format,
            "filename": exp.filename,
            "sha256": exp.sha256,
            "bytes": exp.byte_size,
            "download_url": f"/api/exports/{exp.id}/download",
            "created_at": iso(exp.created_at),
        }
    }


@router.get("/exports/{export_id}/download")
def download_export(export_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    """Download export with access control."""
    exp = db.get(ExportRecord, parse_uuid(export_id))
    if not exp:
        raise HTTPException(404, "Export not found.")
    rec = load_recording(db, p, exp.recording_id)
    content = storage.get_bytes(exp.storage_key)
    return {
        "data": content.hex() if isinstance(content, bytes) else content,
        "filename": exp.filename,
        "content_type": "application/pdf" if exp.format == "pdf" else "application/octet-stream",
    }


def _render_summary_pdf(ctx: dict[str, Any], summary: dict[str, Any]) -> bytes:
    """Render summary-only PDF: key passages, critical moments, and metadata."""
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    from ..exports import render

    ar_font, la_font = render._register_fonts()
    rec = ctx["recording"]
    rev = ctx["revision"]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=22 * mm, rightMargin=22 * mm, topMargin=24 * mm, bottomMargin=22 * mm,
                            title="MURAILEX SUMMARY", author="ALHIJRAH SERVICES", subject="Forensic audio summary")

    ink = colors.HexColor("#0A0A0F")
    muted = colors.HexColor("#64748B")
    indigo = colors.HexColor("#4338CA")

    title = ParagraphStyle("mx-title", fontName=la_font, fontSize=22, leading=26, alignment=TA_CENTER, textColor=ink, spaceAfter=4)
    subtitle = ParagraphStyle("mx-subtitle", fontName=la_font, fontSize=10, leading=15, alignment=TA_CENTER, textColor=muted)
    ltr = ParagraphStyle("mx-ltr", fontName=la_font, fontSize=10.5, leading=16.5, alignment=TA_LEFT, textColor=ink)

    story = [
        Spacer(1, 10 * mm),
        Paragraph("MURAILEX SUMMARY", title),
        Paragraph(f"Revision {rev['number']} · {rev['status'].upper()}", subtitle),
        Spacer(1, 8 * mm),
    ]

    key_passages = summary.get("key_passages", [])
    if key_passages:
        story.append(Paragraph("KEY PASSAGES", ParagraphStyle("h1", parent=title, fontSize=14, spaceBefore=5, spaceAfter=3)))
        for p in key_passages[:5]:
            story.append(Paragraph(f"[{render._font_runs(str(p.get('speaker', '')), ar_font, la_font, 9)}]", ltr))
            story.append(Paragraph(render._font_runs(str(p.get("text", "")), ar_font, la_font, 10), ltr))
            story.append(Spacer(1, 3 * mm))

    critical = summary.get("critical_moments", [])
    if critical:
        story.append(Paragraph("CRITICAL MOMENTS", ParagraphStyle("h2", parent=title, fontSize=12, spaceBefore=5, spaceAfter=3)))
        for c in critical[:5]:
            story.append(Paragraph(f"[{render._font_runs(str(c.get('speaker', '')), ar_font, la_font, 9)}]", ltr))
            story.append(Paragraph(render._font_runs(str(c.get("text", "")), ar_font, la_font, 10), ltr))
            story.append(Spacer(1, 2.5 * mm))

    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(f"Revision SHA-256: {rev['sha256']}", ParagraphStyle("meta", parent=ltr, fontSize=8)))
    story.append(Paragraph(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}", ParagraphStyle("meta2", parent=ltr, fontSize=8)))

    doc.build(story)
    return buf.getvalue()


def _render_complete_case_pdf(ctx: dict[str, Any], summary: dict[str, Any]) -> bytes:
    """Render complete case: summary + full transcript + integrity record."""
    # For now, delegate to professional PDF and append summary metadata
    base_pdf = render_professional_pdf(ctx)
    # In production, this would use PyPDF2 or reportlab to append summary pages
    return base_pdf

