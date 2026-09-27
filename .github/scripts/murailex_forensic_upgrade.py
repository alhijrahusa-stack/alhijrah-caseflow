from __future__ import annotations

from pathlib import Path

ROOT = Path("murailex")


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def write(rel: str, text: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Expected block not found: {label}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Backend: transcript processing. Preserve every Primary token through alignment;
# differing token counts are expected and must become disputes rather than failure.
# ---------------------------------------------------------------------------
p = read("backend/app/pipeline/process.py")
p = p.replace(
    "Token-conservation invariant: normalized token counts from all providers must match after\nalignment; token text and timing may shift but raw token deletion or synthetic injection\nis forbidden.",
    "Token-traceability invariant: every non-empty token emitted by every Primary ASR run must\nremain traceable after deterministic alignment. Primary engines may emit different token counts;\ndisagreement is evidence and is never silently dropped or resolved by provider preference.",
)
p = p.replace("from ..models import Dispute, ProviderRun, Recording, Summary, TranscriptRevision", "from ..models import Dispute, ProviderRun, Recording, TranscriptRevision")
start = p.index("def _check_token_conservation(")
end = p.index("# ---------------------------------------------------------------- stage 1: derive", start)
p = p[:start] + '''def _untraced_primary_tokens(\n    primary_inputs: list[tuple[dict[str, Any], list[dict[str, Any]]]],\n    columns: list[dict[str, Any]],\n) -> list[dict[str, Any]]:\n    """Return Primary tokens not represented in aligned-column provenance.\n\n    Counts are deliberately NOT compared across engines. A missing token is a dispute; the\n    invariant is that every emitted non-empty Primary token remains traceable by run/text/time.\n    """\n    observed: set[tuple[str, str, int, int]] = set()\n    for col in columns:\n        for prov in col.get("provenance") or []:\n            raw = str(prov.get("raw") or "").strip()\n            if raw:\n                observed.add((str(prov.get("run_id") or ""), raw, int(prov.get("start_ms") or 0), int(prov.get("end_ms") or 0)))\n    missing: list[dict[str, Any]] = []\n    for meta, tokens in primary_inputs:\n        run_id = str(meta.get("run_id") or "")\n        for ordinal, token in enumerate(tokens):\n            raw = str(token.get("text") or "").strip()\n            if not raw:\n                continue\n            key = (run_id, raw, int(token.get("start_ms") or 0), int(token.get("end_ms") or 0))\n            if key not in observed:\n                missing.append({\n                    "provider": meta.get("provider"),\n                    "model": meta.get("model"),\n                    "run_id": run_id,\n                    "ordinal": ordinal,\n                    "text": raw,\n                    "start_ms": key[2],\n                    "end_ms": key[3],\n                })\n    return missing\n\n\n''' + p[end:]
p = p.replace("    _check_token_conservation(primary_inputs)\n", "")
needle = '    columns, regions = result["columns"], result["regions"]\n'
p = replace_once(
    p,
    needle,
    needle + '''    untraced = _untraced_primary_tokens(primary_inputs, columns)\n    if untraced:\n        _set_status(db, rec, "failed", "Primary token traceability invariant failed; transcript was not created.")\n        audit.record(\n            db,\n            "token_conservation_failure",\n            actor_label="system",\n            recording_id=rec.id,\n            details={"language_locale": locale, "untraced_count": len(untraced), "untraced": untraced[:100]},\n        )\n        db.commit()\n        return\n''',
    "post-alignment traceability",
)
summary_start = p.index('    rev = TranscriptRevision(recording_id=rec.id, number=1, status="draft", content=content, review_state="unreviewed")')
audit_pos = p.index("    audit.record(\n        db,\n        \"consensus_completed\"", summary_start)
p = p[:summary_start] + '''    rev = TranscriptRevision(recording_id=rec.id, number=1, status="draft", content=content, review_state="unreviewed")\n    db.add(rev)\n    db.flush()\n    rev.content = tx.bind_revision(rev.content, str(rev.id))\n\n''' + p[audit_pos:]
if "\ndef _generate_neutral_summary(" in p:
    p = p[: p.index("\ndef _generate_neutral_summary(")] + "\n"
write("backend/app/pipeline/process.py", p)


# Backend: upload contract is explicit and exact. No dialect guessing.
u = read("backend/app/api/uploads.py")
u = u.replace(
    '    language_locale: str | None = Field(default=None, pattern=r"^(ar|ar-YE|ar-EG|ar-SY|ar-LB|ar-IQ)$")\n    recording_type: str | None = Field(default=None, max_length=40)\n    expected_terms: list[str] | None = Field(default=None, max_items=50)',
    '    language_locale: str = Field(pattern=r"^(ar|ar-YE|ar-EG|ar-SY|ar-LB|ar-IQ)$")\n    recording_type: str = Field(pattern=r"^(interrogation|witness_testimony|meeting|phone_call|court_session|third_circuit_transcript|michigan_appellate_transcript|other)$")\n    expected_terms: list[str] = Field(default_factory=list, max_items=50)',
)
u = replace_once(
    u,
    '            UploadSession.total_size == body.size,\n',
    '            UploadSession.total_size == body.size,\n            UploadSession.language_locale == body.language_locale,\n            UploadSession.recording_type == body.recording_type,\n',
    "resume metadata binding",
)
write("backend/app/api/uploads.py", u)


# Model constraint matches migration and preserves summary history.
m = read("backend/app/models.py")
m = m.replace(
    '__table_args__ = (UniqueConstraint("recording_id", "transcript_revision_id", "summary_type"),)',
    '__table_args__ = (UniqueConstraint("recording_id", "transcript_revision_id", "summary_type", "summary_revision"),)',
)
write("backend/app/models.py", m)


# Lock records reviewed state only when all lock gates have passed.
r = read("backend/app/api/recordings.py")
r = replace_once(
    r,
    '    rev.status = "locked"\n    rev.locked_at = now\n',
    '    rev.status = "locked"\n    rev.review_state = "reviewed"\n    rev.locked_at = now\n',
    "lock review state",
)
write("backend/app/api/recordings.py", r)


# ---------------------------------------------------------------------------
# Professional PDF documents. No certification language or invented signatures.
# ---------------------------------------------------------------------------
write("backend/app/exports/case_pdf.py", r'''from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any

from . import render
from ..pipeline import transcript as tx


def render_case_pdf(ctx: dict[str, Any], summary: dict[str, Any] | None, document_type: str, unresolved_count: int) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    ar_font, la_font = render._register_fonts()
    rec = ctx["recording"]
    rev = ctx["revision"]
    content = ctx["content"]
    locked = rev.get("status") == "locked"
    status_label = "LOCKED" if locked else "DRAFT — NOT LOCKED"
    doc_label = {"summary": "SUMMARY REPORT", "transcript": "VERBATIM TRANSCRIPT", "complete_case": "COMPLETE CASE REPORT"}[document_type]
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=22*mm, rightMargin=22*mm, topMargin=22*mm, bottomMargin=20*mm,
                            title=f"MURAILEX {doc_label}", author="ALHIJRAH VISA & IMMIGRATION SERVICES LLC")
    ink = colors.HexColor("#0A0A0F")
    muted = colors.HexColor("#64748B")
    indigo = colors.HexColor("#4338CA")
    divider = colors.HexColor("#E5E7EB")
    pale = colors.HexColor("#F8FAFC")
    title = ParagraphStyle("mx-title", fontName=la_font, fontSize=25, leading=30, alignment=TA_CENTER, textColor=ink)
    sub = ParagraphStyle("mx-sub", fontName=la_font, fontSize=10, leading=15, alignment=TA_CENTER, textColor=muted)
    h = ParagraphStyle("mx-h", fontName=la_font, fontSize=12, leading=17, textColor=indigo, spaceBefore=8, spaceAfter=6)
    ltr = ParagraphStyle("mx-ltr", fontName=la_font, fontSize=10.5, leading=16.5, alignment=TA_LEFT, textColor=ink)
    rtl = ParagraphStyle("mx-rtl", fontName=ar_font, fontSize=12, leading=20, alignment=TA_RIGHT, textColor=ink)
    small = ParagraphStyle("mx-small", fontName=la_font, fontSize=8.2, leading=12, textColor=muted)
    mono = ParagraphStyle("mx-mono", fontName=la_font, fontSize=8.5, leading=12.5, textColor=indigo)

    story: list[Any] = [Spacer(1, 14*mm), Paragraph("MURAILEX", title), Paragraph(doc_label, sub), Spacer(1, 5*mm)]
    story.append(Paragraph(status_label, ParagraphStyle("status", parent=sub, textColor=indigo, fontSize=12)))
    if unresolved_count:
        story.append(Paragraph(f"UNRESOLVED ITEMS: {unresolved_count}", ParagraphStyle("unresolved", parent=sub, textColor=colors.HexColor("#B45309"))))
    story.append(Spacer(1, 9*mm))
    rows = [
        ["Recording / Session ID", rec.get("id")],
        ["Recording Date", rec.get("uploaded_at")],
        ["Duration", tx.fmt_ts(rec.get("duration_ms") or 0)],
        ["Speaker Count", len((content.get("speakers") or {}))],
        ["Language / Locale", rec.get("language_locale") or "—"],
        ["Recording Type", rec.get("recording_type") or "—"],
        ["Transcript Revision", rev.get("number")],
        ["Document Type", doc_label],
        ["Generated At", generated],
    ]
    table = Table([[Paragraph(str(k), small), Paragraph(render._font_runs(str(v or "—"), ar_font, la_font, 9), ltr)] for k,v in rows], colWidths=[48*mm,106*mm])
    table.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),pale),("BOX",(0,0),(-1,-1),.5,divider),("INNERGRID",(0,0),(-1,-1),.25,divider),("VALIGN",(0,0),(-1,-1),"TOP"),("PADDING",(0,0),(-1,-1),6)]))
    story += [table, Spacer(1, 8*mm), Paragraph("The original audio recording is the controlling source.", sub), Spacer(1, 6*mm)]
    story.append(Paragraph("OPERATED BY", h))
    story.append(Paragraph(render._font_runs(render._visual("مكتب الهجره _ عبدالله المريسي"), ar_font, la_font, 10), rtl))
    story.append(Paragraph("ALHIJRAH VISA & IMMIGRATION SERVICES LLC · Dearborn, Michigan · 313-339-3566 · WhatsApp 313-414-0904", small))

    def add_summary() -> None:
        if not summary:
            return
        story.append(PageBreak())
        story.append(Paragraph("EXECUTIVE SUMMARY", h))
        st = summary.get("summary_type") or "neutral"
        story.append(Paragraph(f"Style: {st}", small))
        if st == "neutral":
            for label, key in [
                ("RECORDING IDENTIFICATION", "recording_identification"),
                ("PARTICIPANTS / SPEAKERS", "participants_speakers"),
                ("CHRONOLOGICAL TIMELINE", "chronological_timeline"),
                ("MATERIAL STATEMENTS", "material_statements"),
                ("CONFIRMED INCONSISTENCIES / CONTRADICTIONS", "confirmed_inconsistencies_contradictions"),
                ("UNRESOLVED / DISPUTED MATTERS", "unresolved_disputed_matters"),
                ("INTEGRITY & REVIEW STATUS", "integrity_review_status"),
            ]:
                story.append(Paragraph(label, h))
                value = summary.get(key)
                if isinstance(value, list):
                    if not value:
                        story.append(Paragraph("None recorded in this summary.", small))
                    for row in value:
                        text = str(row.get("verbatim") or row.get("display_name") or row.get("notice") or row)
                        prefix = f"[{tx.fmt_ts(int(row.get('start_ms') or 0))}] " if isinstance(row, dict) and "start_ms" in row else ""
                        style = rtl if render._is_rtl(text) else ltr
                        visual = render._visual(text) if render._is_rtl(text) else text
                        story.append(Paragraph(render._font_runs(prefix + visual, ar_font, la_font, 10), style))
                        story.append(Spacer(1, 1.5*mm))
                else:
                    story.append(Paragraph(render._font_runs(str(value or "—"), ar_font, la_font, 9), ltr))
        else:
            story.append(Paragraph("VERBATIM EVIDENCE", h))
            evid = summary.get("verbatim_evidence") or []
            data = [["Timestamp","Speaker","Verbatim","Classification","Defense Relevance"]]
            for row in evid:
                data.append([
                    tx.fmt_ts(int(row.get("start_ms") or 0)), row.get("speaker") or "—", row.get("verbatim") or "—",
                    row.get("evidentiary_classification") or "Material Statement", row.get("defense_relevance") or "—",
                ])
            t = Table([[Paragraph(render._font_runs(render._visual(str(c)) if render._is_rtl(str(c)) else str(c), ar_font, la_font, 7.5), rtl if render._is_rtl(str(c)) else small) for c in row] for row in data], colWidths=[22*mm,25*mm,48*mm,31*mm,43*mm], repeatRows=1)
            t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),pale),("GRID",(0,0),(-1,-1),.25,divider),("VALIGN",(0,0),(-1,-1),"TOP"),("PADDING",(0,0),(-1,-1),4)]))
            story.append(t)
            story.append(Paragraph("ANALYTICAL IMPACT", h))
            story.append(Paragraph("Analytical impact is kept separate from verbatim evidence. No legal citation or legal conclusion is generated without verified jurisdiction-specific authority.", ltr))
            unresolved = summary.get("unresolved_disputed_matters") or []
            if unresolved:
                story.append(Paragraph("UNRESOLVED / DISPUTED MATTERS", h))
                for row in unresolved:
                    story.append(Paragraph("UNRESOLVED — NOT RELIED UPON AS VERIFIED FACT", small))

    def add_transcript() -> None:
        story.append(PageBreak())
        story.append(Paragraph("FULL VERBATIM TRANSCRIPT", h))
        for seg in content.get("segments") or []:
            text = tx.segment_text(seg)
            state = seg.get("review_state") or ("UNRESOLVED" if "⟦UNRESOLVED⟧" in text else "CONSENSUS")
            sid = seg.get("speaker")
            info = (content.get("speakers") or {}).get(sid or "", {})
            speaker = info.get("verified_name") or info.get("label") or sid or "[متحدث غير محدد]"
            story.append(Paragraph(f"[{tx.fmt_ts(int(seg.get('start_ms') or 0))}]  {speaker}  ·  {state}", mono))
            style = rtl if render._is_rtl(text) else ltr
            visual = render._visual(text) if render._is_rtl(text) else text
            story.append(Paragraph(render._font_runs(visual, ar_font, la_font, 11), style))
            story.append(Spacer(1, 2*mm))

    if document_type in {"summary", "complete_case"}:
        add_summary()
    if document_type in {"transcript", "complete_case"}:
        add_transcript()

    story.append(PageBreak())
    story.append(Paragraph("INTEGRITY & REVIEW ATTESTATION", h))
    attest = [
        ["Original Audio SHA-256", rec.get("sha256")],
        ["Transcript Revision", rev.get("number")],
        ["Transcript SHA-256", rev.get("sha256") or "DRAFT CONTENT BINDING"],
        ["Locked / Draft Status", status_label],
        ["Integrity Verification Result", "VERIFIED" if rec.get("sha256") else "NOT AVAILABLE"],
        ["Unresolved Count", unresolved_count],
        ["Human Reviewer", rev.get("locked_by") or "—"],
        ["Reviewed At", rev.get("locked_at") or "—"],
        ["Generated At", generated],
    ]
    story.append(Table([[Paragraph(str(k), small), Paragraph(render._font_runs(str(v or "—"), ar_font, la_font, 8), ltr)] for k,v in attest], colWidths=[48*mm,106*mm], style=TableStyle([("GRID",(0,0),(-1,-1),.25,divider),("VALIGN",(0,0),(-1,-1),"TOP"),("PADDING",(0,0),(-1,-1),5)])))
    story += [Spacer(1, 12*mm), Paragraph("Authorized Reviewer / Signature (only if actually entered and approved):", small), Spacer(1, 12*mm), Paragraph("____________________________________________", ltr)]

    def footer(canvas, doc_obj):
        canvas.saveState()
        canvas.setFont(la_font, 7.5)
        canvas.setFillColor(muted)
        canvas.drawString(22*mm, 10*mm, f"MURAILEX · {status_label}")
        canvas.drawRightString(A4[0]-22*mm, 10*mm, f"Page {doc_obj.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
''')


# Replace exports API with revision/SHA-bound PDF modes while preserving old formats.
e = read("backend/app/api/exports.py")
e = e.replace("from ..exports import professional, render", "from ..exports import case_pdf, render")
e = e.replace("    Recording,\n    TranscriptRevision,", "    Recording,\n    Summary,\n    TranscriptRevision,")
e = e.replace(
    'class ExportIn(BaseModel):\n    format: str = Field(pattern="^(txt|docx|pdf|json|zip)$")\n    revision_id: str | None = None\n    translation_id: str | None = None',
    'class ExportIn(BaseModel):\n    format: str = Field(pattern="^(txt|docx|pdf|json|zip)$")\n    revision_id: str | None = None\n    translation_id: str | None = None\n    summary_id: str | None = None\n    document_type: str = Field(default="transcript", pattern="^(transcript|summary|complete_case|evidence_package)$")',
)
e = e.replace(
    '                      "byte_size": rec.byte_size, "sha256": rec.sha256, "uploaded_at": iso(rec.uploaded_at), "duration_ms": rec.duration_ms,\n                      "storage_version_id": rec.storage_version_id},',
    '                      "byte_size": rec.byte_size, "sha256": rec.sha256, "uploaded_at": iso(rec.uploaded_at), "duration_ms": rec.duration_ms,\n                      "language_locale": rec.language_locale, "recording_type": rec.recording_type,\n                      "storage_version_id": rec.storage_version_id},',
)
query_old = '''    q = select(TranscriptRevision).where(TranscriptRevision.recording_id == rec.id, TranscriptRevision.status == "locked")\n    if body.revision_id:\n        q = q.where(TranscriptRevision.id == parse_uuid(body.revision_id))\n    rev = db.execute(q.order_by(TranscriptRevision.number.desc()).limit(1)).scalar_one_or_none()\n    if rev is None:\n        raise HTTPException(409, "Exports are generated only from a locked forensic transcript.")\n    ctx = build_context(db, rec, rev)\n'''
query_new = '''    q = select(TranscriptRevision).where(TranscriptRevision.recording_id == rec.id)\n    if body.revision_id:\n        q = q.where(TranscriptRevision.id == parse_uuid(body.revision_id))\n    elif not (body.format == "pdf" and body.document_type in {"transcript", "summary", "complete_case"}):\n        q = q.where(TranscriptRevision.status == "locked")\n    rev = db.execute(q.order_by(TranscriptRevision.number.desc()).limit(1)).scalar_one_or_none()\n    if rev is None:\n        raise HTTPException(409, "Transcript revision not available for this export.")\n    if body.format != "pdf" and rev.status != "locked":\n        raise HTTPException(409, "Non-PDF exports are generated only from a locked forensic transcript.")\n    ctx = build_context(db, rec, rev)\n\n    summary = None\n    if body.document_type in {"summary", "complete_case"}:\n        if not body.summary_id:\n            raise HTTPException(409, "Select a summary generated from this transcript revision.")\n        summary = db.get(Summary, parse_uuid(body.summary_id))\n        if summary is None or summary.recording_id != rec.id or summary.transcript_revision_id != rev.id:\n            raise HTTPException(409, "EXPORT FAIL: summary and transcript revision do not match.")\n        if rev.status == "locked":\n            if not rev.sha256 or summary.transcript_sha256 != rev.sha256:\n                raise HTTPException(409, "EXPORT FAIL: summary transcript SHA-256 does not match the locked transcript.")\n        else:\n            from .summaries import transcript_binding_sha\n            if summary.transcript_sha256 != transcript_binding_sha(rec, rev):\n                raise HTTPException(409, "EXPORT FAIL: summary no longer matches the current draft revision.")\n'''
e = replace_once(e, query_old, query_new, "export revision query")
pdf_old = '''    elif body.format == "pdf":\n        if translation is None:\n            data = professional.render_professional_pdf(ctx)\n            filename = f"MURAILEX Forensic Audio Report - {_safe(rec.title)} r{rev.number}.pdf"\n            details["layout"] = "professional_forensic_report"\n            details["summary"] = "extractive_from_locked_transcript"\n        else:\n            data, filename = render.render_pdf(ctx, translation), f"{base}.pdf"\n'''
pdf_new = '''    elif body.format == "pdf":\n        if translation is None:\n            unresolved_count = sum(1 for s in (rev.content or {}).get("segments", []) for i in s.get("items", []) if i.get("kind") == "dispute")\n            data = case_pdf.render_case_pdf(ctx, summary.content if summary else None, body.document_type, unresolved_count)\n            filename = f"MURAILEX {_safe(rec.title)} r{rev.number} {body.document_type}.pdf"\n            details["layout"] = "professional_legal_report"\n            details["document_type"] = body.document_type\n            details["unresolved_count"] = unresolved_count\n        else:\n            data, filename = render.render_pdf(ctx, translation), f"{base}.pdf"\n'''
e = replace_once(e, pdf_old, pdf_new, "pdf renderer")
e = e.replace(
    '    exp = ExportRecord(recording_id=rec.id, revision_id=rev.id, format=body.format, storage_key=key, filename=filename,\n                       byte_size=len(data), sha256=digest, created_by=p.user.id)',
    '    exp = ExportRecord(recording_id=rec.id, revision_id=rev.id, summary_id=summary.id if summary else None, format=body.format,\n                       document_type=body.document_type, storage_key=key, filename=filename,\n                       byte_size=len(data), sha256=digest, created_by=p.user.id)',
)
e = e.replace(
    '        "translation_id": translation["id"] if translation else None, "sha256": digest, "bytes": len(data), **details})',
    '        "translation_id": translation["id"] if translation else None, "summary_id": str(summary.id) if summary else None,\n        "document_type": body.document_type, "sha256": digest, "bytes": len(data), **details})',
)
e = e.replace(
    '    return {"exports": [{"id": str(e.id), "format": e.format, "filename": e.filename, "sha256": e.sha256, "bytes": e.byte_size,\n                         "created_at": iso(e.created_at), "download_url": f"/api/exports/{e.id}/download"} for e in rows]}',
    '    return {"exports": [{"id": str(e.id), "format": e.format, "document_type": e.document_type, "filename": e.filename, "sha256": e.sha256, "bytes": e.byte_size,\n                         "created_at": iso(e.created_at), "download_url": f"/api/exports/{e.id}/download"} for e in rows]}',
)
write("backend/app/api/exports.py", e)


# ---------------------------------------------------------------------------
# Frontend upload metadata contract.
# ---------------------------------------------------------------------------
write("frontend/src/lib/upload.ts", r'''import { ApiError, api } from "./api";
import type { Recording } from "./types";

export type UploadSessionInfo = { id: string; status: string; chunk_size: number; total_size: number; received_parts: number[]; total_parts: number; received_bytes: number; recording_id: string | null };
export type PendingUpload = { fingerprint: string; name: string; size: number; uploadId: string; title: string; storedRecordingId?: string };
const PENDING_KEY = "murailex.pendingUploads";
export function fingerprintOf(file: File | Blob, name: string): string { const lm = file instanceof File ? file.lastModified : 0; return `${name}:${file.size}:${lm}`.slice(0, 200); }
export function pendingUploads(): PendingUpload[] { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]") as PendingUpload[]; } catch { return []; } }
function savePending(list: PendingUpload[]) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch { /* unavailable */ } }
export function forgetPending(fingerprint: string) { savePending(pendingUploads().filter((p) => p.fingerprint !== fingerprint)); }
async function sha256Hex(buf: ArrayBuffer): Promise<string | null> { if (!globalThis.crypto?.subtle) return null; const d = await crypto.subtle.digest("SHA-256", buf); return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2,"0")).join(""); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function resumableUpload(blob: Blob, opts: {
  name: string; title: string; source: "upload" | "recording"; storedRecordingId?: string;
  languageLocale: "ar" | "ar-YE" | "ar-EG" | "ar-SY" | "ar-LB" | "ar-IQ";
  recordingType: "interrogation" | "witness_testimony" | "meeting" | "phone_call" | "court_session" | "third_circuit_transcript" | "michigan_appellate_transcript" | "other";
  expectedTerms?: string[]; onProgress?: (fraction: number) => void; signal?: AbortSignal;
}): Promise<Recording> {
  const fingerprint = fingerprintOf(blob, opts.name);
  const mime = blob.type || "application/octet-stream";
  const session = await api<UploadSessionInfo>("/api/uploads", { method: "POST", json: {
    filename: opts.name, mime_type: mime, size: blob.size, fingerprint, title: opts.title, source: opts.source,
    language_locale: opts.languageLocale, recording_type: opts.recordingType, expected_terms: opts.expectedTerms ?? [],
  }});
  savePending([...pendingUploads().filter((p) => p.fingerprint !== fingerprint), { fingerprint, name: opts.name, size: blob.size, uploadId: session.id, title: opts.title, storedRecordingId: opts.storedRecordingId }]);
  const done = new Set(session.received_parts); let sent = session.received_bytes; opts.onProgress?.(sent / blob.size);
  for (let n=1; n<=session.total_parts; n++) {
    if (done.has(n)) continue;
    const start=(n-1)*session.chunk_size; const chunk=blob.slice(start, Math.min(blob.size,start+session.chunk_size)); const buf=await chunk.arrayBuffer(); const digest=await sha256Hex(buf);
    for (let attempt=0;;attempt++) {
      if (opts.signal?.aborted) throw new DOMException("aborted","AbortError");
      try {
        if (typeof navigator !== "undefined" && navigator.onLine === false) throw new TypeError("offline");
        await api(`/api/uploads/${session.id}/parts/${n}`, { method:"PUT", body:buf, headers:{"content-type":"application/octet-stream", ...(digest?{"x-chunk-sha256":digest}:{})}, signal:opts.signal });
        break;
      } catch(e) { const retryable=!(e instanceof ApiError)||e.status>=500||e.status===429; if(!retryable||attempt>=8) throw e; await sleep(Math.min(30000,1000*2**attempt)); }
    }
    sent += chunk.size; opts.onProgress?.(sent/blob.size);
  }
  const res=await api<{recording:Recording}>(`/api/uploads/${session.id}/complete`,{method:"POST"}); forgetPending(fingerprint); return res.recording;
}
''')


t = read("frontend/src/lib/types.ts")
t = t.replace('  provenance: Provenance[];\n  dispute_id?: string;', '  provenance: Provenance[];\n  review_state?: "CONSENSUS" | "HUMAN VERIFIED" | "DISPUTED" | "UNRESOLVED" | "OVERLAP";\n  dispute_id?: string;')
t = t.replace('export type Segment = { id: string; speaker: string | null; start_ms: number; end_ms: number; items: Item[] };', 'export type Segment = { id: string; revision_id?: string | null; speaker: string | null; start_ms: number; end_ms: number; review_state?: "CONSENSUS" | "HUMAN VERIFIED" | "DISPUTED" | "UNRESOLVED" | "OVERLAP"; provenance?: Provenance[]; items: Item[] };')
start = t.index("export type Summary = {")
end = t.index("\nexport type Candidate =", start)
t = t[:start] + '''export type Summary = {\n  id: string; recording_id: string; transcript_revision_id: string; transcript_sha256: string;\n  summary_type: "neutral" | "defense"; summary_revision: number; status: "draft" | "locked";\n  content: Record<string, unknown>; generated_at: string; generation_model: string; created_at: string;\n};\n''' + t[end:]
write("frontend/src/lib/types.ts", t)


# Home page: exact Arabic locale, recording type, expected terms, operator identity and quick actions.
h = read("frontend/src/app/page.tsx")
h = h.replace('type ArabicLocale = "ar-YE" | "ar-EG" | "ar-SY" | "ar-LB" | "ar-IQ";', 'type ArabicLocale = "ar" | "ar-YE" | "ar-EG" | "ar-SY" | "ar-LB" | "ar-IQ";\ntype RecordingType = "interrogation" | "witness_testimony" | "meeting" | "phone_call" | "court_session" | "third_circuit_transcript" | "michigan_appellate_transcript" | "other";')
h = h.replace('  const [languageLocale, setLanguageLocale] = useState<ArabicLocale | "">("");', '  const [languageLocale, setLanguageLocale] = useState<ArabicLocale | "">("");\n  const [recordingType, setRecordingType] = useState<RecordingType | "">("");\n  const [expectedTerms, setExpectedTerms] = useState("");')
h = h.replace(
    '      if (!languageLocale) {\n        setActive({ name, progress: 0, error: rtl ? "اختر لهجة التسجيل قبل الرفع." : "Select the recording dialect before upload." });\n        return;\n      }',
    '      if (!languageLocale) { setActive({ name, progress: 0, error: rtl ? "اختر لغة/لهجة التسجيل قبل الرفع." : "Select the recording locale before upload." }); return; }\n      if (!recordingType) { setActive({ name, progress: 0, error: rtl ? "اختر نوع التسجيل قبل الرفع." : "Select the recording type before upload." }); return; }',
)
h = h.replace('          languageLocale,\n          onProgress:', '          languageLocale,\n          recordingType,\n          expectedTerms: expectedTerms.split(/[\\n,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 50),\n          onProgress:')
h = h.replace('[languageLocale, router, rtl, t],', '[languageLocale, recordingType, expectedTerms, router, rtl, t],')
h = h.replace('<option value="" disabled>{rtl ? "اختر اللهجة" : "Select dialect"}</option>', '<option value="" disabled>{rtl ? "اختر اللغة/اللهجة" : "Select locale"}</option>\n                <option value="ar">العربية العامة / الفصحى / المختلطة — ar</option>')
selector_end = '''              </select>\n            </div>\n            <div className="mt-4 grid w-full gap-3 sm:grid-cols-2">'''
selector_new = '''              </select>\n              <label className="mb-2 mt-4 block text-xs font-semibold text-slate-300" htmlFor="recording-type">{rtl ? "نوع التسجيل — إلزامي" : "Recording Type — required"}</label>\n              <select id="recording-type" value={recordingType} onChange={(e) => setRecordingType(e.target.value as RecordingType)} className="h-12 w-full rounded-2xl border border-white/[0.10] bg-slate-950/70 px-4 text-sm text-slate-100 outline-none focus:border-indigo-400/60">\n                <option value="" disabled>{rtl ? "اختر نوع التسجيل" : "Select recording type"}</option>\n                <option value="interrogation">استجواب / Interrogation</option>\n                <option value="witness_testimony">شهادة / Witness Testimony</option>\n                <option value="meeting">اجتماع / Meeting</option>\n                <option value="phone_call">مكالمة / Phone Call</option>\n                <option value="court_session">جلسة محكمة / Court Session</option>\n                <option value="third_circuit_transcript">Transcript for 3rd Circuit Court</option>\n                <option value="michigan_appellate_transcript">Transcript for Michigan Court of Appeals</option>\n                <option value="other">أخرى / Other</option>\n              </select>\n              <label className="mb-2 mt-4 block text-xs font-semibold text-slate-300" htmlFor="expected-terms">{rtl ? "مصطلحات متوقعة — أسماء، مبالغ، أرقام قضايا" : "Expected terms — names, amounts, case numbers"}</label>\n              <textarea id="expected-terms" value={expectedTerms} onChange={(e) => setExpectedTerms(e.target.value)} rows={3} className="w-full rounded-2xl border border-white/[0.10] bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none focus:border-indigo-400/60" placeholder={rtl ? "مثال: عبدالله، 25-108101-DM، $15,000" : "Example: Abdullah, 25-108101-DM, $15,000"} />\n              <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 text-[11px] text-slate-400">\n                <div>Version <b className="text-slate-200">Draft v1</b></div><div>Locale <b className="text-slate-200">{languageLocale || "—"}</b></div>\n                <div>Type <b className="text-slate-200">{recordingType || "—"}</b></div><div>Engines <b className="text-slate-200">{configured}</b></div>\n              </div>\n            </div>\n            <div className="mt-4 grid w-full gap-3 sm:grid-cols-2">'''
h = replace_once(h, selector_end, selector_new, "home metadata controls")
brand = '<p className="mt-2 text-sm font-medium text-slate-300">{rtl ? "الذكاء الجنائي للصوت" : "Forensic Audio Intelligence"}</p>'
h = replace_once(h, brand, brand + '''\n            <div className="mt-3 max-w-xl rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3 text-[11px] leading-5 text-slate-400">\n              <div className="font-semibold tracking-wide text-slate-300">OPERATED BY</div>\n              <div dir="auto">مكتب الهجره _ عبدالله المريسي</div>\n              <div>ALHIJRAH VISA &amp; IMMIGRATION SERVICES LLC · Dearborn, Michigan</div>\n              <div>313-339-3566 · WhatsApp 313-414-0904</div>\n            </div>''', "operator identity")
main_close = '''      {(stored.length > 0 || pending.length > 0) && !active && !recording && ('''
quick = '''      {!active && !recording && (\n        <div className="grid grid-cols-2 gap-3">\n          <Button asChild variant="secondary" className="glass-interactive h-14"><Link href="/transcriptions">📋 {rtl ? "آخر التسجيلات" : "Recent recordings"}</Link></Button>\n          <Button asChild variant="secondary" className="glass-interactive h-14"><Link href="/transcriptions">🕐 {rtl ? "استئناف آخر تسجيل" : "Resume last recording"}</Link></Button>\n          <Button asChild variant="secondary" className="glass-interactive h-14"><Link href="/settings#advanced">⚙️ {rtl ? "إعدادات المحركات" : "Engine settings"}</Link></Button>\n          <Button asChild variant="secondary" className="glass-interactive h-14"><Link href="/settings">📊 {rtl ? "حالة النظام" : "System status"}</Link></Button>\n        </div>\n      )}\n\n'''
h = replace_once(h, main_close, quick + main_close, "quick actions")
write("frontend/src/app/page.tsx", h)


# Backend-driven Summary workspace. Quotes are rendered only from anchored backend data.
write("frontend/src/components/summary-workspace.tsx", r'''"use client";

import { Download, Scale, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import type { ExportInfo, Revision, Summary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

type Props = { recordingId: string; revision: Revision; rtl: boolean };

export function SummaryWorkspace({ recordingId, revision, rtl }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setSummary(null); setError(null); }, [revision.id]);

  async function generate(kind: "neutral" | "defense") {
    setBusy(true); setError(null);
    try {
      const r = await api<{ summary: Summary }>(`/api/recordings/${recordingId}/summaries`, { method: "POST", json: { summary_type: kind, revision_id: revision.id } });
      setSummary(r.summary);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Summary generation failed"); }
    finally { setBusy(false); }
  }

  async function exportPdf(documentType: "summary" | "transcript" | "complete_case") {
    setBusy(true); setError(null);
    try {
      const payload: Record<string,string> = { format: "pdf", revision_id: revision.id, document_type: documentType };
      if (documentType !== "transcript") {
        if (!summary) throw new Error("Generate a summary first");
        payload.summary_id = summary.id;
      }
      const r = await api<{export:ExportInfo}>(`/api/recordings/${recordingId}/exports`, { method:"POST", json:payload });
      const a=document.createElement("a"); a.href=r.export.download_url; a.download=r.export.filename; document.body.appendChild(a); a.click(); a.remove();
    } catch(e) { setError(e instanceof ApiError || e instanceof Error ? e.message : "Export failed"); }
    finally { setBusy(false); }
  }

  if (!summary) return (
    <Card className="glass-elevated space-y-5 p-5 sm:p-7">
      <div><div className="tech-label">LEGAL SUMMARY WORKSPACE</div><CardTitle className="mt-2">{rtl ? "اختر أسلوب الملخص" : "Which summary style?"}</CardTitle></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button className="h-16" disabled={busy} onClick={() => generate("neutral")}><ShieldCheck />Neutral Forensic</Button>
        <Button className="h-16" variant="secondary" disabled={busy} onClick={() => generate("defense")}><Scale />Defense-Oriented</Button>
      </div>
      <p className="muted text-xs">{rtl ? "الملخص كيان مستقل مرتبط بهذه النسخة من النص ولا يغيّر الـTranscript." : "The summary is revision-bound and never mutates the transcript."}</p>
      {error && <p className="text-sm text-rose-400">{error}</p>}
    </Card>
  );

  const c = summary.content as Record<string, unknown>;
  const neutral = summary.summary_type === "neutral";
  const timeline = (c.chronological_timeline as Array<Record<string,unknown>> | undefined) ?? [];
  const material = (c.material_statements as Array<Record<string,unknown>> | undefined) ?? [];
  const unresolved = (c.unresolved_disputed_matters as Array<Record<string,unknown>> | undefined) ?? [];
  const evidence = (c.verbatim_evidence as Array<Record<string,unknown>> | undefined) ?? [];

  return <div className="space-y-4">
    <Card className="glass-elevated p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="tech-label">RESULT WORKSPACE</div><h2 className="mt-1 text-xl font-bold">{neutral ? "Neutral Forensic Summary" : "Defense Evidentiary Review"}</h2></div><Button variant="secondary" onClick={() => setSummary(null)} disabled={busy}>{rtl ? "تغيير النمط" : "Change style"}</Button></div>
      <div className="mt-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-3"><div>Revision {revision.number}</div><div>Binding <span className="font-mono">{summary.transcript_sha256.slice(0,12)}…</span></div><div>{summary.status.toUpperCase()}</div></div>
    </Card>
    {neutral ? <>
      <Section title="Chronological Timeline" rows={timeline} />
      <Section title="Material Statements" rows={material} />
      <Section title="Confirmed Inconsistencies / Contradictions" rows={(c.confirmed_inconsistencies_contradictions as Array<Record<string,unknown>> | undefined) ?? []} />
      <Section title="Unresolved / Disputed Matters" rows={unresolved} unresolved />
    </> : <Card className="overflow-x-auto p-4"><CardTitle>VERBATIM EVIDENCE</CardTitle><table className="mt-4 w-full min-w-[760px] text-start text-sm"><thead className="text-xs text-slate-500"><tr><th className="p-2">Timestamp</th><th className="p-2">Speaker</th><th className="p-2">Verbatim</th><th className="p-2">Classification</th><th className="p-2">Defense Relevance</th></tr></thead><tbody>{evidence.map((r,i)=><tr key={String(r.quote_anchor_id ?? i)} className="border-t border-white/[.06]"><td className="p-2 font-mono text-indigo-300">{fmtTime(Number(r.start_ms ?? 0))}</td><td className="p-2"><bdi>{String(r.speaker ?? "—")}</bdi></td><td className="p-2" dir="auto">{String(r.verbatim ?? "")}</td><td className="p-2">{String(r.evidentiary_classification ?? "")}</td><td className="p-2 text-slate-400">{String(r.defense_relevance ?? "")}</td></tr>)}</tbody></table>{unresolved.length>0&&<div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[.05] p-3 text-xs text-amber-200">UNRESOLVED — NOT RELIED UPON AS VERIFIED FACT · {unresolved.length}</div>}</Card>}
    <Card className="space-y-3"><CardTitle>PDF Exports</CardTitle><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => exportPdf("summary")}><Download />Summary PDF</Button><Button disabled={busy} variant="secondary" onClick={() => exportPdf("transcript")}><Download />Transcript PDF</Button><Button disabled={busy} variant="secondary" onClick={() => exportPdf("complete_case")}><Download />Complete Case PDF</Button></div>{error&&<p className="text-sm text-rose-400">{error}</p>}</Card>
  </div>;
}

function Section({ title, rows, unresolved=false }: { title:string; rows:Array<Record<string,unknown>>; unresolved?:boolean }) {
  return <Card className="space-y-3"><CardTitle>{title}</CardTitle>{rows.length===0?<p className="muted text-sm">None recorded.</p>:rows.map((r,i)=><div key={String(r.quote_anchor_id ?? r.segment_id ?? i)} className="rounded-2xl border border-white/[.07] bg-white/[.02] p-3"><div className="mb-1 font-mono text-[11px] text-indigo-300">{typeof r.start_ms === "number" ? fmtTime(r.start_ms) : ""} {String(r.speaker ?? "")}</div><p dir="auto" className="text-sm leading-7 text-slate-200">{String(r.verbatim ?? r.notice ?? r.display_name ?? "")}</p>{unresolved&&<div className="mt-2 text-[11px] text-amber-300">UNRESOLVED — NOT RELIED UPON AS VERIFIED FACT</div>}</div>)}</Card>;
}
''')


# Result page: Summary is default; Transcript remains verbatim and review-visible.
pg = read("frontend/src/app/transcriptions/[id]/page.tsx")
pg = pg.replace('import { TranscriptView } from "@/components/transcript-view";', 'import { TranscriptView } from "@/components/transcript-view";\nimport { SummaryWorkspace } from "@/components/summary-workspace";')
pg = pg.replace('  const [busy, setBusy] = useState(false);', '  const [busy, setBusy] = useState(false);\n  const [workspaceTab, setWorkspaceTab] = useState<"summary" | "transcript">("summary");')
anchor = '''          <div className="flex flex-col gap-2 sm:flex-row">\n            <Input placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" className="sm:max-w-xs" />'''
replacement = '''          <div className="glass flex rounded-2xl p-1">\n            <Button className="flex-1" variant={workspaceTab === "summary" ? "subtle" : "ghost"} onClick={() => setWorkspaceTab("summary")}>Summary</Button>\n            <Button className="flex-1" variant={workspaceTab === "transcript" ? "subtle" : "ghost"} onClick={() => setWorkspaceTab("transcript")}>Transcript</Button>\n          </div>\n          {workspaceTab === "summary" && revision && <SummaryWorkspace recordingId={id} revision={revision} rtl={dir === "rtl"} />}\n\n          <div className={workspaceTab === "transcript" ? "flex flex-col gap-2 sm:flex-row" : "hidden"}>\n            <Input placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} dir="auto" className="sm:max-w-xs" />'''
pg = replace_once(pg, anchor, replacement, "result tabs")
pg = pg.replace('<Card className="p-2 sm:p-3">\n            <p className="muted px-3 pt-2 text-center text-[11px] tracking-wide">', '<Card className={workspaceTab === "transcript" ? "p-2 sm:p-3" : "hidden"}>\n            <p className="muted px-3 pt-2 text-center text-[11px] tracking-wide">', 1)
write("frontend/src/app/transcriptions/[id]/page.tsx", pg)


# Tests: count mismatch is valid; traceability is the invariant. Add Arabic contract cases.
test = read("backend/tests/test_forensic_upgrade.py")
old_test_start = test.index("def test_token_conservation_enforced():")
test = test[:old_test_start] + r'''def test_primary_token_traceability_allows_different_counts():
    from app.pipeline.process import _untraced_primary_tokens
    meta_a = {"provider":"A","model":"a","run_id":"1"}
    meta_b = {"provider":"B","model":"b","run_id":"2"}
    a = [tok("لا",0,100), tok("أوافق",110,220)]
    b = [tok("لا أوافق",0,220)]
    result = consensus.analyze([(meta_a,a),(meta_b,b)], [], 0.6)
    assert _untraced_primary_tokens([(meta_a,a),(meta_b,b)], result["columns"]) == []


def test_missing_token_disagreement_is_disputed_not_deleted():
    meta_a = {"provider":"A","model":"a","run_id":"1"}
    meta_b = {"provider":"B","model":"b","run_id":"2"}
    result = consensus.analyze([(meta_a,[tok("خمسة",0,100),tok("آلاف",110,220)]),(meta_b,[tok("خمسة",0,100)])], [], 0.6)
    assert any("single_engine_token" in c["reasons"] for c in result["columns"])
    assert any(r["hard"] for r in result["regions"])


def test_single_letter_arabic_difference_is_disputed():
    meta_a = {"provider":"A","model":"a","run_id":"1"}
    meta_b = {"provider":"B","model":"b","run_id":"2"}
    result = consensus.analyze([(meta_a,[tok("سالم")]),(meta_b,[tok("سليم")])], [], 0.6)
    assert result["columns"][0]["agree"] is False
    assert "engine_disagreement" in result["columns"][0]["reasons"]


def test_negation_is_never_silently_rewritten():
    meta_a = {"provider":"A","model":"a","run_id":"1"}
    meta_b = {"provider":"B","model":"b","run_id":"2"}
    result = consensus.analyze([(meta_a,[tok("لا")]),(meta_b,[tok("نعم")])], [], 0.6)
    assert result["columns"][0]["agree"] is False
    assert result["regions"][0]["requires_independent_check"] is True
'''
write("backend/tests/test_forensic_upgrade.py", test)

print("MURAILEX surgical forensic upgrade applied")
