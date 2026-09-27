from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import DBAPIError

from app import jobs
from app.db import session_factory
from app.models import Recording, User


def _recording(db) -> Recording:
    user = User(
        email=f"job-{uuid.uuid4()}@example.com",
        display_name="job test",
        password_hash="not-used-in-this-test",
        role="admin",
    )
    db.add(user)
    db.flush()
    rec = Recording(
        owner_id=user.id,
        title="Processing guard",
        source="upload",
        original_filename="guard.wav",
        mime_type="audio/wav",
        byte_size=1,
        sha256="a" * 64,
        storage_key=f"tests/{uuid.uuid4()}/guard.wav",
        uploaded_at=datetime.now(timezone.utc),
        language_locale="ar-YE",
        recording_type="meeting",
        status="failed",
    )
    db.add(rec)
    db.flush()
    return rec


def test_process_enqueue_reuses_one_active_attempt_then_allows_retry():
    with session_factory()() as db:
        rec = _recording(db)
        original_sha = rec.sha256
        first = jobs.enqueue(db, "process_recording", rec.id)
        duplicate = jobs.enqueue(db, "process_recording", rec.id)
        assert duplicate.id == first.id
        db.commit()

        first = db.get(type(first), first.id)
        assert first is not None
        first.status = "failed"
        db.commit()

        retry = jobs.enqueue(db, "process_recording", rec.id)
        assert retry.id != first.id
        assert retry.recording_id == rec.id
        assert rec.sha256 == original_sha
        db.rollback()


def test_original_sha256_is_database_immutable_after_ingestion():
    with session_factory()() as db:
        rec = _recording(db)
        recording_id = rec.id
        db.commit()

        rec = db.get(Recording, recording_id)
        assert rec is not None
        with pytest.raises(DBAPIError):
            rec.sha256 = "b" * 64
            db.commit()
        db.rollback()

        rec = db.get(Recording, recording_id)
        assert rec is not None
        assert rec.sha256 == "a" * 64
