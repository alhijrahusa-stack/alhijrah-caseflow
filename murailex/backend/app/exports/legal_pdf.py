"""Professional revision-bound MURAILEX legal PDF documents.

This renderer is deliberately record-grounded. It never creates transcript text, legal
citations, legal conclusions, signatures, or certification claims. Every transcript row
comes from the selected TranscriptRevision and every summary quote is already anchored to
that same revision by the Summary service.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any

from ..pipeline import transcript as tx
from . import render

DOCUMENT_TITLES = {
    "summary": "SUMMARY REPORT",
    "transcript": "VERBATIM TRANSCRIPT",
    "complete_case": "COMPLETE CASE REPORT",
}


def _unresolved_count(content: dict[str, Any]) -> int:
    return sum(
        1
        for segment in content.get("segments") or []
        for item in segment.get("items") or []
        if item.get("kind") == "dispute"
    )


def _speaker_count(content: dict[str, Any]) -> int:
    return len(content.get("speakers") or {})


def _segment_text(segment: dict[str, Any]) -> str:
    parts: list[str] = []
    for item in segment.get("items") or []:
        if item.get("kind") == "dispute":
            parts.append("⟦UNRESOLVED — NOT RELIED UPON AS VERIFIED FACT⟧")
        else:
            value = str(item.get("text") or "").strip()
            if value:
                parts.append(value)
    return " ".join(parts)


def _state(segment: dict[str, Any]) -> str:
    if any(item.get("kind") == "dispute" for item in segment.get("items") or []):
        return "UNRESOLVED"
    return str(segment.get("review_state") or "CONSENSUS")


def _summary_lines(summary: dict[str, Any]) -> list[tuple[str, list[dict[str, Any]]]]:
    content = summary.get("content") or {}
    if summary.get("summary_type") == "defense":
        return [
            ("VERBATIM EVIDENCE", content.get("verbatim_evidence") or []),
            ("UNRESOLVED / DISPUTED MATTERS", content.get("unresolved_disputed_matters") or []),
        ]
    return [
        ("CHRONOLOGICAL TIMELINE", content.get("chronological_timeline") or []),
        ("MATERIAL STATEMENTS", content.get("material_statements") or []),
        (
            "CONFIRMED INCONSISTENCIES / CONTRADICTIONS",
            content.get("confirmed_inconsistencies_contradictions") or [],
        ),
        ("UNRESOLVED / DISPUTED MATTERS", content.get("unresolved_disputed_matters") or []),
    ]


def render_legal_pdf(
    ctx: dict[str, Any],
    document_type: str,
    summary: dict[str, Any] | None = None,
) -> bytes:
    if document_type not in DOCUMENT_TITLES:
        raise ValueError("Unsupported legal PDF document type")
    if document_type in {"summary", "complete_case"} and summary is None:
        raise ValueError("Summary document is required")

    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        KeepTogether,
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    ar_font, latin_font = render._register_fonts()
    recording = ctx["recording"]
    revision = ctx["revision"]
    content = ctx["content"]
    unresolved = _unresolved_count(content)
    generated_at = datetime.now(timezone.utc).isoformat()
    locked = revision["status"] == "locked"
    transcript_sha = revision.get("sha256") or ctx.get("transcript_binding_sha") or "NOT GENERATED"

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=22 * mm,
        rightMargin=22 * mm,
        topMargin=22 * mm,
        bottomMargin=20 * mm,
        title=f"MURAILEX {DOCUMENT_TITLES[document_type]}",
        author="MURAILEX · ALHIJRAH VISA & IMMIGRATION SERVICES LLC",
    )
    body = ParagraphStyle(
        "body",
        fontName=latin_font,
        fontSize=9.5,
        leading=15,
        textColor=colors.HexColor("#111827"),
        alignment=TA_LEFT,
    )
    rtl = ParagraphStyle(
        "rtl",
        parent=body,
        fontName=ar_font,
        fontSize=11,
        leading=18,
        alignment=TA_RIGHT,
    )
    title = ParagraphStyle(
        "title",
        fontName=latin_font,
        fontSize=24,
        leading=29,
        textColor=colors.HexColor("#4338CA"),
        alignment=TA_CENTER,
        spaceAfter=4 * mm,
    )
    subtitle = ParagraphStyle(
        "subtitle",
        parent=body,
        fontSize=12,
        leading=16,
        textColor=colors.HexColor("#475569"),
        alignment=TA_CENTER,
    )
    heading = ParagraphStyle(
        "heading",
        parent=body,
        fontSize=11,
        leading=15,
        textColor=colors.HexColor("#4338CA"),
        spaceBefore=5 * mm,
        spaceAfter=2.5 * mm,
    )
    mono = ParagraphStyle(
        "mono",
        parent=body,
        fontName=latin_font,
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#475569"),
    )
    warning = ParagraphStyle(
        "warning",
        parent=body,
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#9F1239"),
    )

    def paragraph(value: Any, *, small: bool = False):
        text = str(value if value is not None else "—")
        style = rtl if render._is_rtl(text) else (mono if small else body)
        visual = render._visual(text) if render._is_rtl(text) else text
        size = 9 if small else (11 if style is rtl else 9.5)
        return Paragraph(render._font_runs(visual, ar_font, latin_font, size), style)

    story: list[Any] = [
        Spacer(1, 16 * mm),
        Paragraph("MURAILEX", title),
        Paragraph("FORENSIC AUDIO INTELLIGENCE", subtitle),
        Spacer(1, 7 * mm),
        Paragraph(DOCUMENT_TITLES[document_type], title),
        Paragraph(
            "LOCKED" if locked else "DRAFT — NOT LOCKED",
            subtitle,
        ),
    ]
    if unresolved:
        story += [
            Spacer(1, 3 * mm),
            Paragraph(f"UNRESOLVED ITEMS: {unresolved}", warning),
        ]

    metadata = [
        ("Recording / Session ID", recording["id"]),
        ("Recording Date", recording.get("uploaded_at") or "—"),
        ("Duration", tx.fmt_ts(recording.get("duration_ms") or 0)),
        ("Speaker Count", _speaker_count(content)),
        ("Language / Locale", recording.get("language_locale") or "—"),
        ("Recording Type", recording.get("recording_type") or "—"),
        ("Transcript Revision", revision["number"]),
        ("Document Type", DOCUMENT_TITLES[document_type]),
        ("Generated At", generated_at),
    ]
    rows = [[Paragraph(f"<b>{key}</b>", body), paragraph(value, small=True)] for key, value in metadata]
    table = Table(rows, colWidths=[52 * mm, 110 * mm], hAlign="CENTER")
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#D1D5DB")),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E5E7EB")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F8FAFC")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story += [Spacer(1, 10 * mm), table, PageBreak()]

    if summary is not None and document_type in {"summary", "complete_case"}:
        label = "DEFENSE EVIDENTIARY REVIEW" if summary.get("summary_type") == "defense" else "NEUTRAL FORENSIC SUMMARY"
        story += [Paragraph(label, heading)]
        summary_content = summary.get("content") or {}
        if summary.get("summary_type") == "defense":
            rows = [[paragraph("Timestamp"), paragraph("Speaker"), paragraph("Verbatim"), paragraph("Classification"), paragraph("Defense Relevance")]]
            for item in summary_content.get("verbatim_evidence") or []:
                rows.append(
                    [
                        paragraph(tx.fmt_ts(int(item.get("start_ms") or 0)), small=True),
                        paragraph(item.get("speaker") or item.get("speaker_id") or "—"),
                        paragraph(item.get("verbatim") or "—"),
                        paragraph(item.get("evidentiary_classification") or "Material Statement"),
                        paragraph(item.get("defense_relevance") or "—"),
                    ]
                )
            evidence = Table(rows, colWidths=[21 * mm, 25 * mm, 49 * mm, 31 * mm, 43 * mm], repeatRows=1)
            evidence.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEF2FF")),
                        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 4),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                        ("TOPPADDING", (0, 0), (-1, -1), 5),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ]
                )
            )
            story += [evidence, Spacer(1, 4 * mm)]
        else:
            identification = summary_content.get("recording_identification") or {}
            if identification:
                story += [Paragraph("RECORDING IDENTIFICATION", heading)]
                for key, value in identification.items():
                    story.append(KeepTogether([paragraph(f"{key}: {value}"), Spacer(1, 1 * mm)]))
            participants = summary_content.get("participants_speakers") or []
            if participants:
                story += [Paragraph("PARTICIPANTS / SPEAKERS", heading)]
                for item in participants:
                    story.append(paragraph(f"{item.get('speaker_id')}: {item.get('display_name')}"))

        for section, items in _summary_lines(summary):
            story += [Paragraph(section, heading)]
            if not items:
                story.append(paragraph("None recorded in this summary revision."))
                continue
            for item in items:
                notice = item.get("notice")
                if notice:
                    story.append(Paragraph(str(notice), warning))
                timestamp = tx.fmt_ts(int(item.get("start_ms") or 0))
                speaker = item.get("speaker") or item.get("speaker_id") or "—"
                quote = item.get("verbatim") or ""
                anchor = item.get("quote_anchor_id") or item.get("segment_id") or "—"
                story.append(paragraph(f"[{timestamp}] {speaker} · {anchor}", small=True))
                if quote:
                    story.append(paragraph(quote))
                story.append(Spacer(1, 2 * mm))
        story += [
            Paragraph("ANALYTICAL LIMITATION", heading),
            paragraph(
                summary_content.get("limitations")
                or "This summary is bound to the selected transcript revision and does not replace the verbatim transcript."
            ),
        ]
        if document_type == "complete_case":
            story.append(PageBreak())

    if document_type in {"transcript", "complete_case"}:
        story += [Paragraph("FULL VERBATIM TRANSCRIPT", heading)]
        for segment in content.get("segments") or []:
            start = tx.fmt_ts(int(segment.get("start_ms") or 0))
            end = tx.fmt_ts(int(segment.get("end_ms") or 0))
            speaker_id = segment.get("speaker")
            speaker_info = (content.get("speakers") or {}).get(speaker_id or "", {})
            speaker = speaker_info.get("verified_name") or speaker_info.get("label") or speaker_id or "[متحدث غير محدد]"
            state = _state(segment)
            story.append(paragraph(f"[{start} - {end}] {speaker} · {state}", small=True))
            text = _segment_text(segment)
            story.append(Paragraph(render._font_runs(render._visual(text) if render._is_rtl(text) else text, ar_font, latin_font, 11 if render._is_rtl(text) else 9.5), rtl if render._is_rtl(text) else body))
            story.append(Spacer(1, 3 * mm))

    story += [
        Paragraph("INTEGRITY &amp; REVIEW ATTESTATION", heading),
    ]
    attestation = [
        ("Original Audio SHA-256", recording["sha256"]),
        ("Transcript Revision", revision["number"]),
        ("Transcript SHA-256", transcript_sha),
        ("Status", "LOCKED" if locked else "DRAFT — NOT LOCKED"),
        ("Integrity Verification Result", ctx.get("integrity_verification") or "ORIGINAL HASH RECORDED"),
        ("Unresolved Count", unresolved),
        ("Human Reviewer", revision.get("locked_by") or "—"),
        ("Reviewed At", revision.get("locked_at") or "—"),
        ("Generated At", generated_at),
    ]
    attest_rows = [[Paragraph(f"<b>{key}</b>", body), paragraph(value, small=True)] for key, value in attestation]
    attest = Table(attest_rows, colWidths=[55 * mm, 107 * mm])
    attest.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F8FAFC")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story += [attest, Spacer(1, 8 * mm), Paragraph("SIGNATURE / ATTESTATION", heading)]
    story += [
        paragraph("Reviewer identity: ______________________________________________"),
        Spacer(1, 4 * mm),
        paragraph("Signature: _______________________________________________________"),
        Spacer(1, 4 * mm),
        paragraph("Date: ____________________________________________________________"),
        Spacer(1, 5 * mm),
        paragraph(
            "No identity or signature is inserted automatically. The original audio recording remains the controlling source."
        ),
    ]

    def footer(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#E5E7EB"))
        canvas.line(22 * mm, 14 * mm, A4[0] - 22 * mm, 14 * mm)
        canvas.setFont(latin_font, 7)
        canvas.setFillColor(colors.HexColor("#64748B"))
        canvas.drawString(
            22 * mm,
            9 * mm,
            f"MURAILEX · Revision {revision['number']} · {'LOCKED' if locked else 'DRAFT — NOT LOCKED'}",
        )
        canvas.drawRightString(A4[0] - 22 * mm, 9 * mm, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
