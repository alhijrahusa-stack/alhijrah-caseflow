"""Revision-bound Result Workspace summaries. Summary generation never mutates transcript data."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..canonical import canonical_json, sha256_hex
from ..db import get_db
from ..models import Recording, Summary, TranscriptRevision
from ..pipeline.text import CRITICAL_RISKS
from ..security import Principal, current_principal, load_recording
from .common import iso, parse_uuid
from .strict import StrictIn

router = APIRouter(prefix="/api")

SUMMARY_TYPES = {"neutral", "defense"}


def transcript_binding_sha(rec: Recording, rev: TranscriptRevision) -> str:
    if rev.status == "locked" and rev.sha256:
        return rev.sha256
    return sha256_hex(
        canonical_json(
            {
                "recording_sha256": rec.sha256,
                "revision_id": str(rev.id),
                "revision_number": rev.number,
                "content": rev.content,
            }
        )
    )


def summary_out(s: Summary) -> dict[str, Any]:
    return {
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


def _speaker(content: dict[str, Any], sid: str | None) -> str:
    if not sid:
        return "[متحدث غير محدد]"
    info = (content.get("speakers") or {}).get(sid) or {}
    return str(info.get("verified_name") or info.get("label") or sid)


def _exact_text(seg: dict[str, Any]) -> str:
    if any(i.get("kind") == "dispute" for i in seg.get("items") or []):
        return ""
    return " ".join(
        str(i.get("text") or "").strip()
        for i in seg.get("items") or []
        if str(i.get("text") or "").strip()
    ).strip()


def _anchor(rev: TranscriptRevision, content: dict[str, Any], seg: dict[str, Any]) -> dict[str, Any]:
    return {
        "quote_anchor_id": f"{rev.id}:{seg['id']}",
        "segment_id": seg["id"],
        "transcript_revision_id": str(rev.id),
        "start_ms": int(seg.get("start_ms") or 0),
        "end_ms": int(seg.get("end_ms") or 0),
        "speaker_id": seg.get("speaker"),
        "speaker": _speaker(content, seg.get("speaker")),
        "review_state": seg.get("review_state")
        or (
            "UNRESOLVED"
            if any(i.get("kind") == "dispute" for i in seg.get("items") or [])
            else "CONSENSUS"
        ),
        "verbatim": _exact_text(seg),
    }


def _critical_pending(content: dict[str, Any]) -> int:
    reviewed = {"human", "reviewer_accepted_candidate"}
    n = 0
    for seg in content.get("segments") or []:
        for item in seg.get("items") or []:
            if set(item.get("risks") or []) & CRITICAL_RISKS and item.get("source") not in reviewed:
                n += 1
    return n


def _neutral(rec: Recording, rev: TranscriptRevision, binding: str) -> dict[str, Any]:
    content = rev.content or {}
    segments = content.get("segments") or []
    anchored = [_anchor(rev, content, s) for s in segments]
    verified = [a for a in anchored if a["verbatim"]]
    material = []
    for seg, a in zip(segments, anchored, strict=True):
        risks = sorted({r for i in seg.get("items") or [] for r in (i.get("risks") or [])})
        if a["verbatim"] and (risks or a["review_state"] == "HUMAN VERIFIED"):
            material.append({**a, "risk_markers": risks})
    if not material:
        material = [{**a, "risk_markers": []} for a in verified[:5]]
    unresolved = [
        {**a, "notice": "UNRESOLVED — NOT RELIED UPON AS VERIFIED FACT"}
        for a in anchored
        if a["review_state"] in {"UNRESOLVED", "DISPUTED"}
    ]
    participants = [
        {
            "speaker_id": sid,
            "display_name": info.get("verified_name") or info.get("label") or sid,
            "human_verified_name": bool(info.get("verified_name")),
        }
        for sid, info in (content.get("speakers") or {}).items()
    ]
    return {
        "summary_type": "neutral",
        "recording_identification": {
            "recording_id": str(rec.id),
            "title": rec.title,
            "filename": rec.original_filename,
            "duration_ms": rec.duration_ms,
            "language_locale": rec.language_locale,
            "recording_type": rec.recording_type,
            "original_sha256": rec.sha256,
        },
        "participants_speakers": participants,
        "chronological_timeline": verified,
        "material_statements": material,
        "confirmed_inconsistencies_contradictions": [],
        "unresolved_disputed_matters": unresolved,
        "integrity_review_status": {
            "transcript_revision": rev.number,
            "transcript_revision_id": str(rev.id),
            "transcript_sha256": binding,
            "status": rev.status,
            "unresolved_count": len(unresolved),
            "critical_items_pending": _critical_pending(content),
        },
        "limitations": "Record-grounded extractive summary only. No legal conclusion or fabricated citation is generated.",
    }


def _classification(seg: dict[str, Any]) -> str:
    risks = {r for i in seg.get("items") or [] for r in (i.get("risks") or [])}
    if "admission" in risks:
        return "Admission Cue"
    if "denial" in risks or "negation" in risks:
        return "Denial Cue"
    if "name" in risks:
        return "Identification"
    if "money" in risks or "number" in risks:
        return "Amount / Number"
    if "date" in risks:
        return "Date / Time"
    if "threat" in risks:
        return "Other Material Evidence"
    return "Material Statement"


def _defense_relevance(classification: str) -> str:
    return {
        "Admission Cue": (
            "Review the exact wording, speaker attribution, surrounding context, and whether the statement is complete."
        ),
        "Denial Cue": (
            "Preserve the exact denial or negation and compare it with other verified statements in the same revision."
        ),
        "Identification": (
            "Verify identity attribution against the audio and any independently established identity evidence."
        ),
        "Amount / Number": (
            "Verify the exact number or amount against the audio; numeric differences are treated as material."
        ),
        "Date / Time": (
            "Review the exact date/time statement for timeline analysis without inferring facts not stated."
        ),
        "Other Material Evidence": (
            "Review the exact statement and surrounding audio before assigning evidentiary significance."
        ),
        "Material Statement": (
            "Review the exact statement in context; no legal conclusion is assigned by MURAILEX."
        ),
    }[classification]


def _defense(rec: Recording, rev: TranscriptRevision, binding: str) -> dict[str, Any]:
    content = rev.content or {}
    rows: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    for seg in content.get("segments") or []:
        a = _anchor(rev, content, seg)
        if not a["verbatim"]:
            unresolved.append({**a, "notice": "UNRESOLVED — NOT RELIED UPON AS VERIFIED FACT"})
            continue
        classification = _classification(seg)
        rows.append(
            {
                **a,
                "evidentiary_classification": classification,
                "defense_relevance": _defense_relevance(classification),
            }
        )
    return {
        "summary_type": "defense",
        "recording_id": str(rec.id),
        "transcript_revision_id": str(rev.id),
        "transcript_sha256": binding,
        "verbatim_evidence": rows,
        "analytical_impact": [
            {
                "quote_anchor_id": r["quote_anchor_id"],
                "segment_id": r["segment_id"],
                "classification": r["evidentiary_classification"],
                "analysis": r["defense_relevance"],
            }
            for r in rows
        ],
        "unresolved_disputed_matters": unresolved,
        "legal_authority": None,
        "legal_issue_label": "Potential Legal Issue",
        "limitations": "No jurisdiction-specific legal conclusion or citation is generated without verified legal authority.",
    }


class SummaryIn(StrictIn):
    summary_type: str = Field(pattern="^(neutral|defense)$")
    revision_id: str | None = None


@router.post("/recordings/{recording_id}/summaries")
def generate_summary(
    recording_id: str,
    body: SummaryIn,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    rec = load_recording(db, p, parse_uuid(recording_id), "export")
    if rec.status == "integrity_failure":
        raise HTTPException(409, "INTEGRITY FAILURE: blocked until integrity is re-verified.")
    q = select(TranscriptRevision).where(TranscriptRevision.recording_id == rec.id)
    if body.revision_id:
        q = q.where(TranscriptRevision.id == parse_uuid(body.revision_id))
    rev = db.execute(q.order_by(TranscriptRevision.number.desc()).limit(1)).scalar_one_or_none()
    if rev is None:
        raise HTTPException(409, "Transcript revision not found.")
    binding = transcript_binding_sha(rec, rev)
    latest_no = (
        db.execute(
            select(func.max(Summary.summary_revision)).where(
                Summary.recording_id == rec.id,
                Summary.transcript_revision_id == rev.id,
                Summary.summary_type == body.summary_type,
            )
        ).scalar_one_or_none()
        or 0
    )
    content = _neutral(rec, rev, binding) if body.summary_type == "neutral" else _defense(rec, rev, binding)
    row = Summary(
        recording_id=rec.id,
        transcript_revision_id=rev.id,
        transcript_sha256=binding,
        summary_type=body.summary_type,
        summary_revision=latest_no + 1,
        status="locked" if rev.status == "locked" else "draft",
        content=content,
        generated_at=datetime.now(timezone.utc),
        generation_model="deterministic-extractive-v1",
        created_by=p.user.id,
    )
    db.add(row)
    db.flush()
    audit.record(
        db,
        "summary_generated",
        actor=p.user,
        recording_id=rec.id,
        details={
            "summary_id": str(row.id),
            "summary_type": row.summary_type,
            "summary_revision": row.summary_revision,
            "transcript_revision_id": str(rev.id),
            "transcript_sha256": binding,
            "generation_model": row.generation_model,
        },
    )
    db.commit()
    return {"summary": summary_out(row)}


@router.get("/recordings/{recording_id}/summaries")
def list_summaries(
    recording_id: str,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    rec = load_recording(db, p, parse_uuid(recording_id))
    rows = db.execute(
        select(Summary).where(Summary.recording_id == rec.id).order_by(Summary.generated_at.desc())
    ).scalars()
    return {"summaries": [summary_out(s) for s in rows]}


@router.get("/recordings/{recording_id}/summaries/{summary_type}")
def get_summary(
    recording_id: str,
    summary_type: str,
    revision_id: str | None = None,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    if summary_type not in SUMMARY_TYPES:
        raise HTTPException(404, "Summary type not found.")
    rec = load_recording(db, p, parse_uuid(recording_id))
    q = select(Summary).where(Summary.recording_id == rec.id, Summary.summary_type == summary_type)
    if revision_id:
        q = q.where(Summary.transcript_revision_id == parse_uuid(revision_id))
    row = db.execute(q.order_by(Summary.summary_revision.desc()).limit(1)).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Summary not generated for this revision.")
    return {"summary": summary_out(row)}
