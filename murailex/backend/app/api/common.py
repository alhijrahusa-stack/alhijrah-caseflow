from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    Dispute,
    ProviderRun,
    Recording,
    TranscriptRevision,
    Translation,
    User,
)


def iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def user_out(u: User) -> dict[str, Any]:
    return {"id": str(u.id), "email": u.email, "display_name": u.display_name, "role": u.role, "is_active": u.is_active}


def recording_out(r: Recording) -> dict[str, Any]:
    return {
        "id": str(r.id), "title": r.title, "source": r.source, "original_filename": r.original_filename,
        "mime_type": r.mime_type, "byte_size": r.byte_size, "sha256": r.sha256, "uploaded_at": iso(r.uploaded_at),
        "duration_ms": r.duration_ms, "status": r.status, "status_detail": r.status_detail,
        "language_hint": r.language_hint, "language_locale": r.language_hint, "expected_speakers": r.expected_speakers, "media_info": r.media_info,
        "storage_version_id": r.storage_version_id, "owner_id": str(r.owner_id),
    }


def revision_out(rev: TranscriptRevision, users: dict[uuid.UUID, str] | None = None) -> dict[str, Any]:
    users = users or {}
    return {
        "id": str(rev.id), "number": rev.number, "status": rev.status, "sha256": rev.sha256,
        "parent_id": str(rev.parent_id) if rev.parent_id else None, "created_at": iso(rev.created_at),
        "locked_at": iso(rev.locked_at), "locked_by": users.get(rev.locked_by) if rev.locked_by else None,
        "content": rev.content,
    }


def dispute_out(d: Dispute) -> dict[str, Any]:
    return {
        "id": str(d.id), "ordinal": d.ordinal, "start_ms": d.start_ms, "end_ms": d.end_ms, "speaker": d.speaker,
        "reasons": d.reasons, "candidates": [{k: v for k, v in c.items() if k != "key"} for c in d.candidates],
        "status": d.status, "resolution": d.resolution, "resolved_at": iso(d.resolved_at),
    }


def run_out(r: ProviderRun, include_raw: bool = False) -> dict[str, Any]:
    out = {
        "id": str(r.id), "provider": r.provider, "model": r.model, "role": r.role, "scope": r.scope_key,
        "window_start_ms": r.window_start_ms, "window_end_ms": r.window_end_ms, "parameters": r.parameters,
        "status": r.status, "attempt": r.attempt, "error": r.error, "input_sha256": r.input_sha256,
        "started_at": iso(r.started_at), "finished_at": iso(r.finished_at),
        "token_count": len((r.normalized or {}).get("tokens", [])) if r.normalized else None,
    }
    if include_raw:
        out["raw_response"] = r.raw_response
        out["normalized"] = r.normalized
    return out


def translation_out(t: Translation) -> dict[str, Any]:
    return {
        "id": str(t.id), "mode": t.mode, "source_language": t.source_language, "target_language": t.target_language,
        "provider": t.provider, "model": t.model, "status": t.status, "error": t.error, "sha256": t.sha256,
        "source_revision_id": str(t.source_revision_id), "created_at": iso(t.created_at), "completed_at": iso(t.completed_at),
        "segments": t.segments,
    }


def current_revision(db: Session, rec: Recording) -> TranscriptRevision | None:
    return db.execute(
        select(TranscriptRevision).where(TranscriptRevision.recording_id == rec.id).order_by(TranscriptRevision.number.desc()).limit(1)
    ).scalar_one_or_none()


def draft_for_update(db: Session, rec: Recording) -> TranscriptRevision:
    rev = db.execute(
        select(TranscriptRevision)
        .where(TranscriptRevision.recording_id == rec.id, TranscriptRevision.status == "draft")
        .with_for_update()
    ).scalar_one_or_none()
    if rev is None:
        raise HTTPException(409, "No editable draft. Locked revisions are immutable — create a new revision to edit.")
    return rev


def parse_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise HTTPException(404, "Not found.") from exc
