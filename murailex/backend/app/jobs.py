"""Durable PostgreSQL job queue (FOR UPDATE SKIP LOCKED + renewable leases).

A job whose worker dies is reclaimed when its lease expires, so processing survives
browser, worker, server, API and provider interruptions.
"""
from __future__ import annotations

import logging
import os
import socket
import threading
import time
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from . import audit
from .config import get_settings
from .db import session_factory
from .models import Job, Recording, Translation
from .providers.base import ProviderError

log = logging.getLogger("murailex.jobs")


def now() -> datetime:
    return datetime.now(timezone.utc)


def enqueue(db: Session, kind: str, recording_id: uuid.UUID | None, payload: dict[str, Any] | None = None) -> Job:
    job = Job(kind=kind, recording_id=recording_id, payload=payload or {}, status="queued", run_after=now())
    db.add(job)
    db.flush()
    return job


def claim(db: Session, worker_id: str) -> Job | None:
    lease = get_settings().worker_lease_seconds
    job = db.execute(
        select(Job)
        .where(
            Job.run_after <= now(),
            or_(Job.status == "queued", (Job.status == "running") & (Job.locked_until < now())),
        )
        .order_by(Job.run_after)
        .limit(1)
        .with_for_update(skip_locked=True)
    ).scalar_one_or_none()
    if job is None:
        db.rollback()
        return None
    job.status = "running"
    job.locked_by = worker_id
    job.locked_until = now() + timedelta(seconds=lease)
    job.attempts += 1
    db.commit()
    return job


def _heartbeat(job_id: uuid.UUID, worker_id: str, stop: threading.Event) -> None:
    lease = get_settings().worker_lease_seconds
    while not stop.wait(lease / 3):
        with session_factory()() as db:
            db.execute(
                update(Job)
                .where(Job.id == job_id, Job.locked_by == worker_id, Job.status == "running")
                .values(locked_until=now() + timedelta(seconds=lease))
            )
            db.commit()


def _handle(db: Session, job: Job) -> None:
    from .forensic_persistence import persist_forensic_state
    from .pipeline.process import process_recording
    from .processing_preflight import enforce_processing_preflight
    from .translation import run_translation

    if job.kind == "process_recording":
        rec = db.get(Recording, job.recording_id)
        if rec is None:
            raise ProviderError("recording missing", retryable=False)
        enforce_processing_preflight(db, rec, current_job_id=job.id)
        process_recording(db, rec)
        db.refresh(rec)
        persist_forensic_state(db, rec)
    elif job.kind == "translate":
        tr = db.get(Translation, uuid.UUID(job.payload["translation_id"]))
        if tr is None:
            raise ProviderError("translation missing", retryable=False)
        run_translation(db, tr)
    else:
        raise ProviderError(f"unknown job kind {job.kind}", retryable=False)


def run_one(worker_id: str) -> bool:
    from .pipeline.process import Wait

    factory = session_factory()
    with factory() as db:
        job = claim(db, worker_id)
        if job is None:
            return False
        job_id = job.id
    stop = threading.Event()
    hb = threading.Thread(target=_heartbeat, args=(job_id, worker_id, stop), daemon=True)
    hb.start()
    try:
        with factory() as db:
            job = db.get(Job, job_id)
            assert job is not None
            try:
                _handle(db, job)
                db.refresh(job)
                job.status = "succeeded"
                job.locked_by = None
                job.locked_until = None
                job.last_error = None
                db.commit()
            except Wait as w:
                db.rollback()
                job = db.get(Job, job_id)
                assert job is not None
                job.status = "queued"
                job.attempts = max(0, job.attempts - 1)  # waiting on a provider is not a failed attempt
                job.run_after = now() + timedelta(seconds=w.seconds)
                job.locked_by = None
                job.last_error = None
                db.commit()
            except Exception as exc:  # noqa: BLE001
                db.rollback()
                job = db.get(Job, job_id)
                assert job is not None
                retryable = not isinstance(exc, ProviderError) or exc.retryable
                msg = f"{type(exc).__name__}: {exc}"
                log.error("job %s failed: %s", job_id, msg)
                log.debug(traceback.format_exc())
                job.last_error = msg[:2000]
                job.locked_by = None
                if retryable and job.attempts < job.max_attempts:
                    job.status = "queued"
                    job.run_after = now() + timedelta(seconds=min(600, 10 * 2 ** job.attempts))
                else:
                    job.status = "failed"
                    if job.recording_id and job.kind == "process_recording":
                        rec = db.get(Recording, job.recording_id)
                        if rec is not None:
                            rec.status = "failed"
                            rec.status_detail = msg[:500]
                    if job.kind == "translate":
                        tr = db.get(Translation, uuid.UUID(job.payload["translation_id"]))
                        if tr is not None and tr.status != "succeeded":
                            tr.status = "failed"
                            tr.error = msg[:500]
                    audit.record(db, "job_failed", actor_label="system", recording_id=job.recording_id,
                                 details={"job_id": str(job.id), "kind": job.kind, "error": msg[:500]})
                db.commit()
    finally:
        stop.set()
    return True


def worker_loop(poll_seconds: float = 2.0) -> None:
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    log.info("worker %s started", worker_id)
    while True:
        try:
            if not run_one(worker_id):
                time.sleep(poll_seconds)
        except Exception:
            log.exception("worker loop error")
            time.sleep(poll_seconds)
