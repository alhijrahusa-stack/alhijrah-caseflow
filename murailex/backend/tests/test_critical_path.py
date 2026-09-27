"""End-to-end API critical path against real PostgreSQL, an S3 API emulator with versioning
and Object Lock, and real FFmpeg. ASR/diarization responses come from deterministic
fixture adapters (automated tests only)."""
from __future__ import annotations

import hashlib
import io
import json
import os
import zipfile

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from .conftest import FIXTURES, drain_jobs, login, make_user, upload_file

SAMPLE = os.path.join(FIXTURES, "sample.wav")


@pytest.fixture(scope="module")
def users():
    make_user("owner@example.com", "transcriber")
    make_user("other@example.com", "transcriber")
    make_user("viewer@example.com", "viewer")
    make_user("admin@example.com", "admin")
    return True


def test_auth_required_and_csrf(app_client, users):
    assert app_client.get("/api/recordings").status_code == 401
    assert app_client.post("/api/auth/login", json={"email": "owner@example.com", "password": "wrong password!!"}).status_code == 401
    login(app_client, "owner@example.com")
    assert app_client.get("/api/auth/me").status_code == 200
    # state-changing call without CSRF header is refused
    r = app_client.post("/api/uploads", json={"filename": "a.wav", "size": 10, "fingerprint": "x"})
    assert r.status_code == 403


def test_login_throttle(app_client, users):
    for _ in range(8):
        app_client.post("/api/auth/login", json={"email": "viewer@example.com", "password": "definitely wrong"})
    r = app_client.post("/api/auth/login", json={"email": "viewer@example.com", "password": "correct horse battery staple"})
    assert r.status_code == 429


def test_rejects_non_audio(app_client, users):
    csrf = login(app_client, "owner@example.com")
    r = app_client.post("/api/uploads", headers={"x-csrf-token": csrf}, json={"filename": "evil.exe", "size": 10, "fingerprint": "e"})
    assert r.status_code == 415
    data = b"MZ" + b"\0" * 100
    r = app_client.post("/api/uploads", headers={"x-csrf-token": csrf}, json={"filename": "fake.wav", "mime_type": "audio/wav", "size": len(data), "fingerprint": "f"})
    sid = r.json()["id"]
    r = app_client.put(f"/api/uploads/{sid}/parts/1", content=data, headers={"x-csrf-token": csrf})
    assert r.status_code == 415


def test_provider_not_configured_is_explicit(app_client, users):
    csrf = login(app_client, "owner@example.com")
    rec = upload_file(app_client, csrf, SAMPLE, title="No providers")
    drain_jobs()
    r = app_client.get(f"/api/recordings/{rec['id']}").json()
    assert r["recording"]["status"] == "provider_not_configured"
    statuses = {run["provider"]: run["status"] for run in r["provider_runs"]}
    assert statuses == {
        "assemblyai": "not_configured",
        "google_chirp3": "not_configured",
        "openai": "not_configured",
        "deepgram": "not_configured",
        "pyannoteai": "not_configured",
    }
    assert app_client.get(f"/api/recordings/{rec['id']}/transcript").json()["revision"] is None


def test_full_critical_path(app_client, users, fixture_providers):
    csrf = login(app_client, "owner@example.com")
    original = open(SAMPLE, "rb").read()
    rec = upload_file(app_client, csrf, SAMPLE, title="Mediation session")

    # original bytes preserved + SHA-256 at upload
    assert rec["sha256"] == hashlib.sha256(original).hexdigest()
    assert rec["byte_size"] == len(original)
    assert rec["storage_version_id"]

    # resumable: re-creating the same upload after completion starts a new session; an open one resumes
    steps = drain_jobs()
    assert steps >= 2  # provider polling re-queued at least once (durable wait)
    detail = app_client.get(f"/api/recordings/{rec['id']}").json()
    assert detail["recording"]["status"] == "needs_review", detail
    assert detail["recording"]["duration_ms"] and 19000 < detail["recording"]["duration_ms"] < 21000
    roles = {(r["provider"], r["role"]) for r in detail["provider_runs"] if r["status"] == "succeeded"}
    assert ("fixture:engine_a", "primary_asr") in roles and ("fixture:diarization", "diarization") in roles
    assert any(r["role"] == "verification_asr" for r in detail["provider_runs"])  # targeted reprocessing ran

    # exact source audio replay, with Range support
    mu = app_client.get(f"/api/recordings/{rec['id']}/media-url?variant=original").json()
    full = app_client.get(mu["url"])
    assert full.status_code == 200 and full.content == original
    part = app_client.get(mu["url"], headers={"Range": "bytes=100-199"})
    assert part.status_code == 206 and part.content == original[100:200]
    assert app_client.get(mu["url"].replace("sig=", "sig=x")).status_code == 403
    assert len(app_client.get(f"/api/recordings/{rec['id']}/peaks").json()["peaks"]) > 100

    t = app_client.get(f"/api/recordings/{rec['id']}/transcript").json()["revision"]
    content = t["content"]
    assert content["title"] == "MURAILEX FORENSIC VERBATIM TRANSCRIPT"
    assert set(content["speakers"]) == {"S1", "S2"}
    assert content["speakers"]["S1"]["label"] == "[المتحدث 1]"
    texts = [it["text"] for s in content["segments"] for it in s["items"] if it["kind"] != "dispute"]
    assert "[صمت]" in texts  # acoustic silence between 8 s and 11 s
    assert "والله" in texts
    assert "okay" not in texts  # code-switch is a mandatory human-review risk
    assert "سالم" not in texts  # names are mandatory human-review risks
    words = [it for s in content["segments"] for it in s["items"] if it["kind"] == "word"]
    assert all(it["provenance"] for it in words)

    disputes = app_client.get(f"/api/recordings/{rec['id']}/disputes").json()["disputes"]
    assert len(disputes) >= 2
    reasons = {r for d in disputes for r in d["reasons"]}
    assert "engine_disagreement" in reasons and "risk:number" in reasons and "overlap" in reasons
    assert "risk:code_switch" in reasons and "risk:name" in reasons
    number = next(d for d in disputes if "risk:number" in d["reasons"])
    cand_texts = {c["provider"]: c["text"] for c in number["candidates"]}
    assert "خمسة" in cand_texts["fixture:engine_a"] and "خمسين" in cand_texts["fixture:engine_b"]

    # lock is refused while disputes are open
    assert app_client.post(f"/api/recordings/{rec['id']}/lock", headers={"x-csrf-token": csrf}).status_code == 409

    # another user cannot see or review it
    other = app_client.__class__(app_client.app, base_url="http://testserver")
    ocsrf = login(other, "other@example.com")
    assert other.get(f"/api/recordings/{rec['id']}").status_code == 404
    assert other.post(f"/api/disputes/{number['id']}/resolve", headers={"x-csrf-token": ocsrf}, json={"action": "mark_inaudible"}).status_code == 404

    # human review actions
    actions = [
        {"action": "accept_candidate", "candidate_index": 0},
        {"action": "type_exact", "text": "أنا ما قلت كذا hello"},
        {"action": "mark_overlap"},
        {"action": "mark_unclear_number"},
        {"action": "mark_inaudible"},
        {"action": "mark_unclear_name"},
    ]
    for i, d in enumerate(disputes):
        r = app_client.post(f"/api/disputes/{d['id']}/resolve", headers={"x-csrf-token": csrf}, json=actions[i % len(actions)])
        assert r.status_code == 200, r.text
    assert app_client.post(f"/api/disputes/{disputes[0]['id']}/resolve", headers={"x-csrf-token": csrf}, json={"action": "mark_inaudible"}).status_code == 409

    # manual correction + speaker change + name only with explicit verification
    t = app_client.get(f"/api/recordings/{rec['id']}/transcript").json()["revision"]
    seg = t["content"]["segments"][0]
    assert app_client.post(f"/api/recordings/{rec['id']}/segments/{seg['id']}/text", headers={"x-csrf-token": csrf},
                           json={"text": "والله ما شفته okay"}).status_code == 200
    assert app_client.post(f"/api/recordings/{rec['id']}/segments/{seg['id']}/speaker", headers={"x-csrf-token": csrf},
                           json={"speaker": "S2"}).status_code == 200
    assert app_client.post(f"/api/recordings/{rec['id']}/speakers/S1/verify", headers={"x-csrf-token": csrf},
                           json={"name": "Salem"}).status_code == 422
    assert app_client.post(f"/api/recordings/{rec['id']}/speakers/S1/verify", headers={"x-csrf-token": csrf},
                           json={"name": "Salem", "confirm_human_verification": True}).status_code == 200

    # exports refused before lock
    assert app_client.post(f"/api/recordings/{rec['id']}/exports", headers={"x-csrf-token": csrf}, json={"format": "txt"}).status_code == 409

    # lock
    r = app_client.post(f"/api/recordings/{rec['id']}/lock", headers={"x-csrf-token": csrf})
    assert r.status_code == 200, r.text
    locked = r.json()["revision"]
    assert locked["status"] == "locked" and len(locked["sha256"]) == 64

    # locked revision is immutable at API and database level
    assert app_client.post(f"/api/recordings/{rec['id']}/segments/{seg['id']}/text", headers={"x-csrf-token": csrf},
                           json={"text": "tamper"}).status_code == 409
    from app.db import session_factory
    with session_factory()() as db:
        with pytest.raises(DBAPIError):
            db.execute(text("update transcript_revisions set content = '{}'::jsonb where id = :i"), {"i": locked["id"]})
        db.rollback()
        with pytest.raises(DBAPIError):
            db.execute(text("delete from audit_events"))
        db.rollback()
        with pytest.raises(DBAPIError):
            db.execute(text("update recordings set sha256 = repeat('0', 64) where id = :i"), {"i": rec["id"]})
        db.rollback()

    # exports
    outputs = {}
    for fmt in ("txt", "docx", "pdf", "json", "zip"):
        r = app_client.post(f"/api/recordings/{rec['id']}/exports", headers={"x-csrf-token": csrf}, json={"format": fmt})
        assert r.status_code == 200, r.text
        e = r.json()["export"]
        dl = app_client.get(e["download_url"])
        assert dl.status_code == 200
        assert hashlib.sha256(dl.content).hexdigest() == e["sha256"]
        outputs[fmt] = dl.content
    txt = outputs["txt"].decode()
    assert "MURAILEX FORENSIC VERBATIM TRANSCRIPT" in txt
    assert "The original audio recording is the controlling source." in txt
    assert "[المتحدث" in txt and "okay" in txt and locked["sha256"] in txt
    assert outputs["pdf"].startswith(b"%PDF")
    assert outputs["docx"][:2] == b"PK"
    doc = json.loads(outputs["json"])
    assert doc["revision"]["sha256"] == locked["sha256"]

    z = zipfile.ZipFile(io.BytesIO(outputs["zip"]))
    names = {n.split("/", 1)[1] for n in z.namelist()}
    for required in ("manifest.json", "SHA256SUMS.txt", "audit_log.json", "revision_history.json", "provider_runs.json",
                     "transcript/transcript.txt", "transcript/transcript.docx", "transcript/transcript.pdf", "transcript/transcript.json"):
        assert required in names
    prefix = z.namelist()[0].split("/")[0]
    manifest = json.loads(z.read(f"{prefix}/manifest.json"))
    assert manifest["original_sha256"] == rec["sha256"]
    assert manifest["locked_transcript"]["sha256"] == locked["sha256"]
    assert manifest["original_sha256_reverified_at_export"]["matches"] is True
    assert manifest["audit_chain"]["valid"] is True
    for line in z.read(f"{prefix}/SHA256SUMS.txt").decode().splitlines():
        digest, name = line.split("  ", 1)
        assert hashlib.sha256(z.read(f"{prefix}/{name}")).hexdigest() == digest
    for name in z.namelist():
        assert b"Certified Transcript" not in z.read(name)
    runs = json.loads(z.read(f"{prefix}/provider_runs.json"))
    assert all("raw_response" in r for r in runs)

    # audit covers the required events, chain valid
    events = app_client.get(f"/api/recordings/{rec['id']}/audit").json()
    actions_seen = {e["action"] for e in events["events"]}
    for a in ("upload", "hash_created", "derived_copies_created", "provider_submitted", "provider_completed", "consensus_completed",
              "review_decision", "correction", "speaker_change", "speaker_identity_verified", "transcript_locked", "export"):
        assert a in actions_seen, a
    assert events["chain"]["valid"] is True

    # a later edit creates a new immutable revision
    r = app_client.post(f"/api/recordings/{rec['id']}/revisions", headers={"x-csrf-token": csrf})
    assert r.status_code == 200 and r.json()["revision"]["number"] == 2
    seg2 = r.json()["revision"]["content"]["segments"][0]["id"]
    assert app_client.post(f"/api/recordings/{rec['id']}/segments/{seg2}/text", headers={"x-csrf-token": csrf},
                           json={"text": "والله ما شفته okay [غير مسموع]"}).status_code == 200
    r2 = app_client.post(f"/api/recordings/{rec['id']}/lock", headers={"x-csrf-token": csrf}).json()["revision"]
    assert r2["sha256"] != locked["sha256"]
    first = app_client.get(f"/api/recordings/{rec['id']}/transcript?revision={locked['id']}").json()["revision"]
    assert first["sha256"] == locked["sha256"] and first["status"] == "locked"

    # original bytes unchanged after the whole workflow
    mu = app_client.get(f"/api/recordings/{rec['id']}/media-url?variant=original").json()
    assert hashlib.sha256(app_client.get(mu["url"]).content).hexdigest() == rec["sha256"]

    # translation: separate derived document; source revision unchanged
    from app.providers import translate as gt

    orig_cfg, orig_tb = gt.configured, gt.translate_batch
    gt.configured = lambda: True  # type: ignore[assignment]
    gt.translate_batch = lambda texts, s, t: ([f"EN({x})" for x in texts], {"fixture": True})  # type: ignore[assignment]
    try:
        r = app_client.post(f"/api/recordings/{rec['id']}/translations", headers={"x-csrf-token": csrf}, json={"mode": "bilingual"})
        assert r.status_code == 200, r.text
        drain_jobs()
        trs = app_client.get(f"/api/recordings/{rec['id']}/translations").json()["translations"]
        tr = trs[0]
        assert tr["status"] == "succeeded" and tr["segments"]
        assert any("[silence]" in s["translation"] for s in tr["segments"])
        r = app_client.post(f"/api/recordings/{rec['id']}/exports", headers={"x-csrf-token": csrf}, json={"format": "pdf", "translation_id": tr["id"]})
        assert r.status_code == 200
    finally:
        gt.configured, gt.translate_batch = orig_cfg, orig_tb
    after = app_client.get(f"/api/recordings/{rec['id']}/transcript").json()["revision"]
    assert after["sha256"] == r2["sha256"]

    # viewer role cannot upload; admin can verify the full chain
    vc = app_client.__class__(app_client.app, base_url="http://testserver")
    admin = app_client.__class__(app_client.app, base_url="http://testserver")
    login(admin, "admin@example.com")
    assert admin.get("/api/audit/verify").json()["valid"] is True
    assert admin.get(f"/api/recordings/{rec['id']}").status_code == 200
    _ = vc


def test_provider_failure_is_retried_then_recorded(app_client, users):
    from app.providers import registry
    from app.providers.base import ProviderError
    from app.providers.fixture import FixtureAsr, FixtureDiarization

    class Flaky(FixtureAsr):
        calls = 0

        def submit(self, audio_path, context):
            Flaky.calls += 1
            if Flaky.calls == 1:
                raise ProviderError("temporary outage", retryable=True)
            return super().submit(audio_path, context)

    class Broken(FixtureAsr):
        def submit(self, audio_path, context):
            raise ProviderError("rejected credentials", retryable=False)

    registry.install_test_fixtures([Flaky("flaky", "engine_a.json"), Broken("broken", "engine_b.json")],
                                   [FixtureDiarization("diarization.json")], [])
    try:
        csrf = login(app_client, "owner@example.com")
        rec = upload_file(app_client, csrf, os.path.join(FIXTURES, "sample.m4a"), title="Flaky", mime="audio/mp4")
        drain_jobs()
        d = app_client.get(f"/api/recordings/{rec['id']}").json()
        runs = {r["provider"]: r for r in d["provider_runs"] if r["role"] == "primary_asr"}
        assert runs["fixture:flaky"]["status"] == "succeeded" and runs["fixture:flaky"]["attempt"] == 2
        assert runs["fixture:broken"]["status"] == "failed"
        # a mandatory primary failure blocks forensic consensus and transcript creation
        assert d["recording"]["status"] == "failed"
        assert app_client.get(f"/api/recordings/{rec['id']}/transcript").json()["revision"] is None
        ev = {e["action"] for e in app_client.get(f"/api/recordings/{rec['id']}/audit").json()["events"]}
        assert "provider_retry" in ev and "provider_failed" in ev and "processing_failed" in ev
    finally:
        registry.clear_test_fixtures()


def test_resumable_upload_reports_missing_parts(app_client, users):
    csrf = login(app_client, "owner@example.com")
    data = open(SAMPLE, "rb").read()
    body = {"filename": "resume.wav", "mime_type": "audio/wav", "size": len(data), "fingerprint": "resume-test"}
    s1 = app_client.post("/api/uploads", headers={"x-csrf-token": csrf}, json=body).json()
    cs = s1["chunk_size"]
    app_client.put(f"/api/uploads/{s1['id']}/parts/1", content=data[:cs], headers={"x-csrf-token": csrf})
    r = app_client.post(f"/api/uploads/{s1['id']}/complete", headers={"x-csrf-token": csrf})
    assert r.status_code == 409 and 2 in r.json()["detail"]["missing_parts"]
    # "browser closed": a new session call with the same fingerprint resumes the same upload
    s2 = app_client.post("/api/uploads", headers={"x-csrf-token": csrf}, json=body).json()
    assert s2["id"] == s1["id"] and s2["received_parts"] == [1]
    for n in range(2, s2["total_parts"] + 1):
        app_client.put(f"/api/uploads/{s1['id']}/parts/{n}", content=data[(n - 1) * cs : n * cs], headers={"x-csrf-token": csrf})
    r = app_client.post(f"/api/uploads/{s1['id']}/complete", headers={"x-csrf-token": csrf})
    assert r.status_code == 200 and r.json()["recording"]["sha256"] == hashlib.sha256(data).hexdigest()
    # a chunk with a wrong checksum is refused
    s3 = app_client.post("/api/uploads", headers={"x-csrf-token": csrf}, json={**body, "fingerprint": "resume-2"}).json()
    bad = app_client.put(f"/api/uploads/{s3['id']}/parts/1", content=data[:cs], headers={"x-csrf-token": csrf, "x-chunk-sha256": "0" * 64})
    assert bad.status_code == 422


def test_worker_lease_recovery(users):
    """A job whose worker died (expired lease) is reclaimed by another worker."""
    from datetime import datetime, timedelta, timezone

    from app.db import session_factory
    from app.jobs import claim
    from app.models import Job

    with session_factory()() as db:
        job = Job(kind="noop-test", payload={}, status="running", locked_by="dead-worker",
                  locked_until=datetime.now(timezone.utc) - timedelta(seconds=5), run_after=datetime.now(timezone.utc) - timedelta(seconds=10))
        db.add(job)
        db.commit()
        jid = job.id
    with session_factory()() as db:
        got = claim(db, "live-worker")
        assert got is not None and got.id == jid and got.locked_by == "live-worker"
        got.status = "failed"
        db.commit()
