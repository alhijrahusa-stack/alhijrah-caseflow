"""Professional court-ready MURAILEX PDF layout.

This renderer deliberately avoids certification language or invented confidence scores.
The locked transcript remains a derived document and the original audio remains controlling.
"""
from __future__ import annotations

import io
import math
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from . import render
from ..pipeline import transcript as tx

STOP = {
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are", "was", "were", "be",
    "this", "that", "it", "i", "you", "he", "she", "we", "they", "my", "your", "his", "her", "our", "their", "do", "did",
    "في", "من", "على", "إلى", "الى", "عن", "مع", "هذا", "هذه", "ذلك", "تلك", "هو", "هي", "انا", "أنا", "انت", "أنت",
    "نحن", "هم", "كان", "كانت", "ما", "ماذا", "لم", "لن", "لا", "نعم", "ثم", "قد", "كل", "أي", "اي", "بعد", "قبل", "عند",
}
SIGNALS = (
    "أقر", "اقر", "اعترف", "أكد", "اكد", "أنكر", "انكر", "مبلغ", "دولار", "دفع", "تحويل", "كاش", "نقد", "تاريخ", "موعد", "وقت", "وافق", "رفض",
    "admit", "admitted", "acknowledge", "confirmed", "confirm", "deny", "denied", "money", "dollar", "payment", "transfer", "cash", "date", "time", "agreed", "refused",
)
TOKEN = re.compile(r"[\w\u0600-\u06ff$]+", re.UNICODE)


def _segment_text(seg: dict[str, Any]) -> str:
    parts = []
    for item in seg.get("items", []):
        if item.get("kind") == "dispute":
            continue
        text = str(item.get("text") or "").strip()
        if text:
            parts.append(text)
    return " ".join(parts).strip()


def _speaker_label(content: dict[str, Any], seg: dict[str, Any]) -> str:
    sid = seg.get("speaker")
    if not sid:
        return ""
    info = (content.get("speakers") or {}).get(sid) or {}
    return str(info.get("verified_name") or info.get("label") or sid)


def _tokens(text: str) -> list[str]:
    return [w.lower() for w in TOKEN.findall(text) if len(w) > 1 and w.lower() not in STOP]


def _clip(text: str, max_chars: int = 220) -> str:
    text = " ".join(text.split())
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rsplit(" ", 1)[0] + "…"


def extractive_summary(content: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for index, seg in enumerate(content.get("segments") or []):
        text = _segment_text(seg)
        if not text or text in {"[غير مسموع]", "[صمت]"}:
            continue
        rows.append({
            "index": index,
            "text": text,
            "label": _speaker_label(content, seg),
            "start_ms": int(seg.get("start_ms") or 0),
            "items": seg.get("items") or [],
        })
    document_frequency: Counter[str] = Counter()
    for row in rows:
        document_frequency.update(set(_tokens(row["text"])))
    total = max(len(rows), 1)
    for row in rows:
        toks = _tokens(row["text"])
        score = 0.0
        for token in set(toks):
            score += math.log(1.0 + total / max(document_frequency[token], 1))
        low = row["text"].lower()
        if any(s in low for s in SIGNALS):
            score += 1.8
        row["score"] = score / max(1.0, math.sqrt(len(toks)))
    take = min(5, max(3, math.ceil(len(rows) / 7))) if rows else 0
    key = sorted(sorted(rows, key=lambda r: r["score"], reverse=True)[:take], key=lambda r: r["index"])
    critical = []
    for row in rows:
        low = row["text"].lower()
        risky = any(i.get("kind") == "dispute" or i.get("risks") for i in row["items"])
        if risky or any(s in low for s in SIGNALS):
            critical.append(row)
        if len(critical) == 5:
            break
    unresolved = sum(1 for s in content.get("segments") or [] for i in s.get("items") or [] if i.get("kind") == "dispute")
    return {
        "key": [{**r, "text": _clip(r["text"])} for r in key],
        "critical": [{**r, "text": _clip(r["text"], 155)} for r in critical],
        "speakers": len(content.get("speakers") or {}),
        "unresolved": unresolved,
        "word_count": sum(len(str(r["text"]).split()) for r in rows),
    }


def render_professional_pdf(ctx: dict[str, Any]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    ar_font, la_font = render._register_fonts()
    rec = ctx["recording"]
    rev = ctx["revision"]
    content = ctx["content"]
    summary = extractive_summary(content)
    uploaded = str(rec.get("uploaded_at") or "")
    year = uploaded[:4] if len(uploaded) >= 4 else str(datetime.now(timezone.utc).year)
    report_ref = f"MRLX-{year}-{str(rec.get('id', ''))[:8].upper()}"

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=22 * mm,
        rightMargin=22 * mm,
        topMargin=24 * mm,
        bottomMargin=22 * mm,
        title="MURAILEX FORENSIC AUDIO REPORT",
        author="MURAILEX / ALHIJRAH SERVICES",
        subject="Forensic audio transcript and integrity report",
    )

    ink = colors.HexColor("#0A0A0F")
    muted = colors.HexColor("#64748B")
    indigo = colors.HexColor("#4338CA")
    divider = colors.HexColor("#E5E7EB")
    pale = colors.HexColor("#F8FAFC")

    title = ParagraphStyle("mx-title", fontName=la_font, fontSize=26, leading=31, alignment=TA_CENTER, textColor=ink, spaceAfter=4)
    subtitle = ParagraphStyle("mx-subtitle", fontName=la_font, fontSize=10, leading=15, alignment=TA_CENTER, textColor=muted, spaceAfter=4)
    h1 = ParagraphStyle("mx-h1", fontName=la_font, fontSize=12, leading=17, textColor=indigo, spaceBefore=10, spaceAfter=8)
    ltr = ParagraphStyle("mx-ltr", fontName=la_font, fontSize=10.5, leading=16.5, alignment=TA_LEFT, textColor=ink, spaceAfter=4)
    rtl = ParagraphStyle("mx-rtl", fontName=ar_font, fontSize=12, leading=20, alignment=TA_RIGHT, textColor=ink, spaceAfter=4)
    small = ParagraphStyle("mx-small", fontName=la_font, fontSize=8.2, leading=12, alignment=TA_LEFT, textColor=muted)
    mono = ParagraphStyle("mx-mono", fontName=la_font, fontSize=8.7, leading=13, alignment=TA_LEFT, textColor=indigo)

    story: list[Any] = []
    story += [Spacer(1, 16 * mm), Paragraph("MURAILEX", title), Paragraph("FORENSIC AUDIO REPORT", subtitle)]
    story.append(Spacer(1, 3 * mm))
    story.append(Table([[""]], colWidths=[80 * mm], rowHeights=[0.35 * mm], style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), indigo)])))
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(report_ref, ParagraphStyle("ref", parent=subtitle, fontSize=12, textColor=indigo)))
    story.append(Spacer(1, 11 * mm))

    details = [
        ["REPORT REFERENCE", report_ref],
        ["GENERATED (UTC)", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")],
        ["SYSTEM", "MURAILEX Forensic Audio Intelligence"],
        ["REVISION", f"{rev.get('number')} · {str(rev.get('status')).upper()}"],
        ["TRANSCRIPT SHA-256", str(rev.get("sha256") or "NOT LOCKED")],
    ]
    table = Table([[Paragraph(k, small), Paragraph(render._font_runs(str(v), ar_font, la_font, 9), ltr)] for k, v in details], colWidths=[48 * mm, 106 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), pale),
        ("BOX", (0, 0), (-1, -1), 0.6, divider),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, divider),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story += [table, Spacer(1, 10 * mm)]
    story.append(Paragraph("The original audio recording is the controlling source.", ParagraphStyle("notice", parent=ltr, alignment=TA_CENTER, textColor=indigo, fontSize=10)))
    story.append(Spacer(1, 13 * mm))
    story.append(Paragraph("Powered by ALHIJRAH SERVICES · عبدالله المريسي", ParagraphStyle("powered", parent=small, alignment=TA_CENTER)))
    story.append(PageBreak())

    story.append(Paragraph("REPORT DETAILS", h1))
    audio_rows = [
        ["File name", rec.get("original_filename")],
        ["Duration", tx.fmt_ts(rec.get("duration_ms") or 0)],
        ["MIME type", rec.get("mime_type")],
        ["File size", f"{int(rec.get('byte_size') or 0):,} bytes"],
        ["Uploaded (UTC)", rec.get("uploaded_at")],
        ["Original SHA-256", rec.get("sha256")],
        ["Speakers", str(summary["speakers"])],
        ["Unresolved regions", str(summary["unresolved"])],
    ]
    aud = Table([[Paragraph(str(k), small), Paragraph(render._font_runs(str(v or "—"), ar_font, la_font, 9), ltr)] for k, v in audio_rows], colWidths=[42 * mm, 112 * mm])
    aud.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -2), 0.35, divider),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story += [aud, Spacer(1, 5 * mm)]

    story.append(Paragraph("EXECUTIVE SUMMARY", h1))
    overview = (
        f"This recording contains {summary['speakers']} speaker(s) over {tx.fmt_ts(rec.get('duration_ms') or 0)}. "
        "The summary below is extractive and built only from the locked transcript. It surfaces information-dense passages and does not add facts, legal conclusions, or identities not present in the transcript."
    )
    story.append(Paragraph(overview, ltr))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph("KEY PASSAGES", ParagraphStyle("mini", parent=h1, fontSize=10, spaceBefore=5, spaceAfter=5)))
    for point in summary["key"]:
        ts_label = f"[{tx.fmt_ts(point['start_ms'])}] {point['label']}".strip()
        story.append(Paragraph(ts_label, mono))
        style = rtl if render._is_rtl(point["text"]) else ltr
        visual = render._visual(point["text"]) if render._is_rtl(point["text"]) else point["text"]
        story.append(Paragraph(render._font_runs(visual, ar_font, la_font, 11 if style is rtl else 10), style))
        story.append(Spacer(1, 1.6 * mm))

    if summary["critical"]:
        story.append(Paragraph("REVIEW-WORTHY MOMENTS", ParagraphStyle("mini2", parent=h1, fontSize=10, spaceBefore=5, spaceAfter=5)))
        story.append(Paragraph("Automatically surfaced because the passage contains a linguistic signal, risk marker, or disputed region. This section is not a legal conclusion.", small))
        story.append(Spacer(1, 2 * mm))
        for point in summary["critical"]:
            ts_label = f"[{tx.fmt_ts(point['start_ms'])}] {point['label']}".strip()
            story.append(Paragraph(ts_label, mono))
            style = rtl if render._is_rtl(point["text"]) else ltr
            visual = render._visual(point["text"]) if render._is_rtl(point["text"]) else point["text"]
            story.append(Paragraph(render._font_runs(visual, ar_font, la_font, 10), style))
            story.append(Spacer(1, 1.4 * mm))

    story.append(PageBreak())
    story.append(Paragraph("FULL TRANSCRIPT", h1))
    story.append(Paragraph("Verbatim transcript derived from the locked MURAILEX revision. Timestamps are clickable references to the source timeline in the application; the audio itself remains controlling.", small))
    story.append(Spacer(1, 4 * mm))
    for ts_value, label, text in tx.plain_lines(content):
        block: list[Any] = [Paragraph(f"[{ts_value}]  " + render._font_runs(render._visual(label) if render._is_rtl(label) else label, ar_font, la_font, 9), mono)]
        style = rtl if render._is_rtl(text) else ltr
        visual = render._visual(text) if render._is_rtl(text) else text
        block.append(Paragraph(render._font_runs(visual, ar_font, la_font, 12 if style is rtl else 10.5), style))
        block.append(Spacer(1, 2.4 * mm))
        story.append(KeepTogether(block))

    story.append(PageBreak())
    story.append(Paragraph("INTEGRITY & PROCESSING RECORD", h1))
    integrity = [
        ["Original audio SHA-256", rec.get("sha256")],
        ["Locked transcript SHA-256", rev.get("sha256")],
        ["Locked at (UTC)", rev.get("locked_at")],
        ["Locked by", rev.get("locked_by")],
        ["Processing engines", ", ".join(f"{e.get('provider')} {e.get('model')}" for e in ctx.get("engines") or []) or "—"],
        ["Document type", "Derived professional report"],
    ]
    integ = Table([[Paragraph(str(k), small), Paragraph(render._font_runs(str(v or "—"), ar_font, la_font, 9), ltr)] for k, v in integrity], colWidths=[48 * mm, 106 * mm])
    integ.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), pale),
        ("BOX", (0, 0), (-1, -1), 0.5, divider),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, divider),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story += [integ, Spacer(1, 6 * mm)]
    story.append(Paragraph(
        "This report does not certify or independently guarantee transcription accuracy. It records the locked transcript, source-file cryptographic hash, processing metadata, and selected exact excerpts. The original audio recording is the controlling source and should be reviewed for any material legal use.",
        ltr,
    ))
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("ALHIJRAH SERVICES", ParagraphStyle("brand", parent=title, fontSize=13, leading=17)))
    story.append(Paragraph("MURAILEX · Forensic Audio Intelligence · عبدالله المريسي", ParagraphStyle("brand2", parent=subtitle, fontSize=9)))

    def header_footer(canvas, d):
        canvas.saveState()
        width, height = A4
        canvas.setStrokeColor(divider)
        canvas.setLineWidth(0.35)
        canvas.line(22 * mm, height - 15 * mm, width - 22 * mm, height - 15 * mm)
        canvas.setFont(la_font, 7.4)
        canvas.setFillColor(muted)
        canvas.drawString(22 * mm, height - 11 * mm, f"MURAILEX · {report_ref}")
        canvas.drawRightString(width - 22 * mm, height - 11 * mm, "FORENSIC AUDIO REPORT")
        canvas.line(22 * mm, 14 * mm, width - 22 * mm, 14 * mm)
        canvas.drawString(22 * mm, 9.5 * mm, "ALHIJRAH SERVICES · CONFIDENTIAL")
        canvas.drawRightString(width - 22 * mm, 9.5 * mm, f"Page {d.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
    return buf.getvalue()
