"""Automatic engine validation for ENVIRONMENT=local.

At worker start, every routed local engine whose exact fingerprint (engine version, model
revision, decode configuration) has no passing real self-test is queued for one, using a
bundled real-speech canary (murailex/local/canary, CC0). Self-tests use the existing
ProviderSelfTest/Engine Registry path unchanged; nothing is marked READY without a real run.
Once an exact configuration has passed, it is not re-tested until something changes.
"""
from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import select

from . import audio, audit, jobs, storage
from .config import get_settings
from .db import session_factory
from .forensic_models import ProviderSelfTest
from .models import Recording, User
from .providers import registry

log = logging.getLogger("murailex.canary")

CANARY_TYPE = "system_canary"
CANARY_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "local", "canary", "engine-canary-ar.mp3")
)


def _canary_recording(db, locale: str, owner: User) -> Recording:
    rec = db.execute(
        select(Recording).where(Recording.recording_type == CANARY_TYPE, Recording.language_locale == locale)
    ).scalars().first()
    if rec is not None:
        return rec
    with open(CANARY_PATH, "rb") as fh:
        data = fh.read()
    digest = hashlib.sha256(data).hexdigest()
    key = f"system/canary/{digest[:16]}/engine-canary-ar.mp3"
    storage.put_bytes(key, data, "audio/mpeg", lock=True)
    rec = Recording(
        owner_id=owner.id,
        title=f"Engine canary · {locale}",
        source="upload",
        original_filename="engine-canary-ar.mp3",
        mime_type=audio.sniff_mime(data[:64]) or "audio/mpeg",
        byte_size=len(data),
        sha256=digest,
        storage_key=key,
        storage_version_id=None,
        uploaded_at=datetime.now(timezone.utc),
        language_locale=locale,
        recording_type=CANARY_TYPE,
        status="system",
        status_detail="Engine canary (not evidence)",
    )
    db.add(rec)
    db.flush()
    audit.record(db, "engine_canary_created", actor_label="system", recording_id=rec.id,
                 details={"sha256": digest, "locale": locale, "source": "murailex/local/canary/SOURCE.md"})
    return rec


def ensure_engine_self_tests() -> int:
    """Queue real self-tests for local engine routes that are not READY. Returns the count."""
    if not registry.local_mode() or not os.path.exists(CANARY_PATH):
        return 0
    queued = 0
    with session_factory()() as db:
        owner = db.execute(
            select(User).where(User.email == (get_settings().bootstrap_admin_email or "").lower())
        ).scalars().first()
        if owner is None:
            return 0
        for locale in sorted(registry.SUPPORTED_LOCALES):
            for adapter, role in registry.routed_adapters(locale):
                state = registry.engine_state(db, adapter, role, locale)
                if state["status"] == "READY" or state["status"] == "NOT_CONFIGURED":
                    continue
                pending = db.execute(
                    select(ProviderSelfTest.id).where(
                        ProviderSelfTest.provider == state["provider"],
                        ProviderSelfTest.model == state["model"],
                        ProviderSelfTest.locale == locale,
                        ProviderSelfTest.role == role,
                        ProviderSelfTest.completed_at.is_(None),
                    )
                ).first()
                if pending:
                    continue
                rec = _canary_recording(db, locale, owner)
                test = ProviderSelfTest(
                    provider=state["provider"],
                    model=state["model"],
                    locale=locale,
                    role=role,
                    recording_id=rec.id,
                    status="BLOCKED",
                    error="Automatic real self-test queued (engine configuration not yet proven).",
                    requested_by=owner.id,
                )
                db.add(test)
                db.flush()
                jobs.enqueue(db, "provider_self_test", rec.id, {"self_test_id": str(test.id)})
                queued += 1
        db.commit()
    if queued:
        log.info("queued %d automatic engine self-test(s)", queued)
    return queued


def pending_self_test(db, provider: str, model: str, locale: str, role: str) -> bool:
    return db.execute(
        select(ProviderSelfTest.id).where(
            ProviderSelfTest.provider == provider,
            ProviderSelfTest.model == model,
            ProviderSelfTest.locale == locale,
            ProviderSelfTest.role == role,
            ProviderSelfTest.completed_at.is_(None),
        )
    ).first() is not None
