from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .canonical import canonical_json, sha256_hex
from .models import AuditEvent, User

GENESIS = "0" * 64
_AUDIT_LOCK_KEY = 0x4D55524149  # "MURAI"


def _event_body(event: AuditEvent) -> dict[str, Any]:
    return {
        "recording_id": str(event.recording_id) if event.recording_id else None,
        "actor_id": str(event.actor_id) if event.actor_id else None,
        "actor_label": event.actor_label,
        "action": event.action,
        "details": event.details,
        "created_at": event.created_at.astimezone(timezone.utc).isoformat(),
        "prev_hash": event.prev_hash,
    }


def compute_hash(event: AuditEvent) -> str:
    return sha256_hex(canonical_json(_event_body(event)))


def record(
    db: Session,
    action: str,
    *,
    actor: User | None = None,
    actor_label: str | None = None,
    recording_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> AuditEvent:
    """Append a hash-chained audit event inside the caller's transaction.

    A transaction-scoped advisory lock serialises writers so the chain never forks.
    """
    db.execute(text("select pg_advisory_xact_lock(:k)"), {"k": _AUDIT_LOCK_KEY})
    last = db.execute(select(AuditEvent.hash).order_by(AuditEvent.id.desc()).limit(1)).scalar()
    event = AuditEvent(
        recording_id=recording_id,
        actor_id=actor.id if actor else None,
        actor_label=actor.email if actor else (actor_label or "system"),
        action=action,
        details=details or {},
        created_at=datetime.now(timezone.utc),
        prev_hash=last or GENESIS,
    )
    event.hash = compute_hash(event)
    db.add(event)
    db.flush()
    return event


def verify_chain(db: Session) -> dict[str, Any]:
    prev = GENESIS
    count = 0
    for event in db.execute(select(AuditEvent).order_by(AuditEvent.id)).scalars():
        count += 1
        if event.prev_hash != prev:
            return {"valid": False, "checked": count, "broken_at": event.id, "reason": "prev_hash mismatch"}
        if compute_hash(event) != event.hash:
            return {"valid": False, "checked": count, "broken_at": event.id, "reason": "hash mismatch"}
        prev = event.hash
    return {"valid": True, "checked": count, "head": prev}


def serialize(event: AuditEvent) -> dict[str, Any]:
    body = _event_body(event)
    body["id"] = event.id
    body["hash"] = event.hash
    return body
