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


def upload_metadata() -> dict[str, str]:
    return {"language_locale": "ar-YE", "recording_type": "interrogation"}


@pytest.fixture(scope="module")
def users():
    make_user("owner@example.com", "transcriber")
    make_user("other@example.com", "transcriber")
    make_user("viewer@example.com", "viewer")
    make_user("admin@example.com", "admin")
    return True


def test_auth_required_and_csrf(app_client, users):
    assert app_client.get("/api/recordings").status_code == 401
    assert app_client.post(
        "/api/auth/login",
        json={"email": "owner@example.com", "password": "wrong password!!"},
    ).status_code == 401
    login(app_client, "owner@example.com")
    assert app_client.get("/api/auth/me").status_code == 200
    r = app_client.post(
        "/api/uploads",
        json={"filename": "a.wav", "size": 10, "fingerprint": "x", **upload_metadata()},
    )
    assert r.status_code == 403


def test_login_throttle(app_client, users):
    for _ in range(8):
        app_client.post(
            "/api/auth/login",
            json={"email": "viewer@example.com", "password": "definitely wrong"},
        )
    r = app_client.post(
        "/api/auth/login",
        json={"email": "viewer@example.com", "password": "correct horse battery staple"},
    )
    assert r.status_code == 429


def test_rejects_non_audio(app_client, users):
    csrf = login(app_client, "owner@example.com")
    r = app_client.post(
        "/api/uploads",
        headers={"x-csrf-token": csrf},
        json={"filename": "evil.exe", "size": 10, "fingerprint": "e", **upload_metadata()},
    )
    assert r.status_code == 415
    data = b"MZ" + b"\0" * 100
    r = app_client.post(
        "/api/uploads",
        headers={"x-csrf-token": csrf},
        json={
            "filename": "fake.wav",
            "mime_type": "audio/wav",
            "size": len(data),
            "fingerprint": "f",
            **upload_metadata(),
        },
    )
    sid = r.json()["id"]
    r = app_client.put(
        f"/api/uploads/{sid}/parts/1",
        content=data,
        headers={"x-csrf-token": csrf},
    )
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

    assert rec["sha256"] == hashlib.sha256(original).hexdigest()
    assert rec["byte_size"] == len(original)
    assert rec["storage_version_id"]
    assert rec["language_locale"] == "ar-YE"
    assert rec["recording_type"] == "interrogation"

    steps = drain_jobs()
    assert steps >= 2
    detail = app_client.get(f"/api/recordings/{rec['id']}").json()
    assert detail["recording"]["status"] == "needs_review", detail
    assert detail["recording"]["duration_ms"] and 19000 < detail["recording"]["duration_ms"] < 21000
    roles = {
        (run["provider"], run["role"])
        for run in detail["provider_runs"]
        if run["status"] == "succeeded"
    }
    assert ("fixture:engine_a", "primary_asr") in roles
    assert ("fixture:diarization", "diarization") in roles
    assert any(run["role"] == "verification_asr" for run in detail["provider_runs"])

    media = app_client.get(f"/api/recordings/{rec['id']}/media-url?variant=original").json()
    full = app_client.get(media["url"])
    assert full.status_code == 200 and full.content == original
    part = app_client.get(media["url"], headers={"Range": "bytes=100-199"})
    assert part.status_code == 206 and part.content == original[100:200]
    assert app_client.get(media["url"].replace("sig=", "sig=x")).status_code == 403
    assert len(app_client.get(f"/api/recordings/{rec['id']}/peaks").json()["peaks"]) > 100

    transcript = app_client.get(f"/api/recordings/{rec['id']}/transcript").json()["revision"]
    content = transcript["content"]
    assert content["title"] == "MURAILEX FORENSIC VERBATIM TRANSCRIPT"
    assert set(content["speakers"]) == {"S1", "S2"}
    assert content["speakers"]["S1"]["label"] == "[المتحدث 1]"
    assert all(segment["revision_id"] == transcript["id"] for segment in content["segments"])
    texts = [
        item["text"]
        for segment in content["segments"]
        for item in segment["items"]
        if item["kind"] != "dispute"
    ]
    assert "[صمت]" in texts
    assert "والله" in texts
    # Critical spans the independent verifier read identically are closed by that check and
    # carry it on the record; the number the engines actually disagree on stays disputed.
    by_text = {item["text"]: item for segment in content["segments"] for item in segment["items"]}
    assert by_text["سالم"]["review_state"] == "INDEPENDENTLY VERIFIED"
    assert "name" in by_text["سالم"]["risks"]
    assert {p.get("provider") for p in by_text["سالم"]["provenance"]} >= {"fixture:engine_a", "fixture:verifier"}
    # "okay" (code-switch) sits in the overlapped-speech region, which is never auto-closed.
    assert "okay" not in texts
    assert "خمسة" not in texts and "خمسين" not in texts  # engine disagreement on a number
    words = [
        item
        for segment in content["segments"]
        for item in segment["items"]
        if item["kind"] == "word"
    ]
    assert all(item["provenance"] for item in words)

    disputes = app_client.get(f"/api/recordings/{rec['id']}/disputes").json()["disputes"]
    assert len(disputes) >= 2
    reasons = {reason for dispute in disputes for reason in dispute["reasons"]}
    assert "engine_disagreement" in reasons
    assert "risk:number" in reasons
    assert "overlap" in reasons
    assert "risk:code_switch" in reasons
    # the name region passed its independent check above, so it is no longer disputed
    assert "risk:name" not in reasons
    number = next(dispute for dispute in disputes if "risk:number" in dispute["reasons"])
    candidate_texts = {candidate["provider"]: candidate["text"] for candidate in number["candidates"]}
    assert "خمسة" in candidate_texts["fixture:engine_a"]
    assert "خمسين" in candidate_texts["fixture:engine_b"]

    assert app_client.post(
        f"/api/recordings/{rec['id']}/lock",
        headers={"x-csrf-token": csrf},
    ).status_code == 409

    other = app_client.__class__(app_client.app, base_url="http://testserver")
    other_csrf = login(other, "other@example.com")
    assert other.get(f"/api/recordings/{rec['id']}").status_code == 404
    assert other.post(
        f"/api/disputes/{number['id']}/resolve",
        headers={"x-csrf-token": other_csrf},
        json={"action": "mark_inaudible"},
    ).status_code == 404

    actions = [
        {"action": "accept_candidate", "candidate_index": 0},
        {"action": "type_exact", "text": "أنا ما قلت كذا hello"},
        {"action": "mark_overlap"},
        {"action": "mark_unclear_number"},
        {"action": "mark_inaudible"},
        {"action": "mark_unclear_name"},
    ]
    for index, dispute in enumerate(disputes):
        response = app_client.post(
            f"/api/disputes/{dispute['id']}/resolve",
            headers={"x-csrf-token": csrf},
            json=actions[index % len(actions)],
        )
        assert response.status_code == 200, response.text
    assert app_client.post(
        f"/api/disputes/{disputes[0]['id']}/resolve",
        headers={"x-csrf-token": csrf},
        json={"action": "mark_inaudible"},
    ).status_code == 409

    transcript = app_client.get(f"/api/recordings/{rec['id']}/transcript").json()["revision"]
    segment = transcript["content"]["segments"][0]
    assert app_client.post(
        f"/api/recordings/{rec['id']}/segments/{segment['id']}/text",
        headers={"x-csrf-token": csrf},
        json={"text": "والله ما شفته okay"},
    ).status_code == 200
    assert app_client.post(
        f"/api/recordings/{rec['id']}/segments/{segment['id']}/speaker",
        headers={"x-csrf-token": csrf},
        json={"speaker": "S2"},
    ).status_code == 200
    assert app_client.post(
        f"/api/recordings/{rec['id']}/speakers/S1/verify",
        headers={"x-csrf-token": csrf},
        json={"name": "Salem"},
    ).status_code == 422
    assert app_client.post(
        f"/api/recordings/{rec['id']}/speakers/S1/verify",
        headers={"x-csrf-token": csrf},
        json={"name": "Salem", "confirm_human_verification": True},
    ).status_code == 200

    assert app_client.post(
        f"/api/recordings/{rec['id']}/exports",
        headers={"x-csrf-token": csrf},
        json={"format": "txt"},
    ).status_code == 409

    response = app_client.post(
        f"/api/recordings/{rec['id']}/lock",
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 200, response.text
    locked = response.json()["revision"]
    assert locked["status"] == "locked" and len(locked["sha256"]) == 64
    # summary modes: on demand, locked revision only, deterministic, verbatim-anchored
    seg_ids = {s["id"] for s in locked["content"]["segments"]} if locked.get("content") else None
    for mode in ("executive", "detailed", "key_points", "timeline", "entities"):
        made = app_client.post(f"/api/recordings/{rec['id']}/summaries", headers={"x-csrf-token": csrf}, json={"summary_type": mode})
        assert made.status_code == 200, made.text
        sm = made.json()["summary"]
        assert sm["transcript_sha256"] == locked["sha256"] and sm["content"]["mode"] == mode
        anchors = sm["content"]["entities"] if mode == "entities" else sm["content"]["mode_items"]
        if seg_ids:
            assert all(a["segment_id"] in seg_ids for a in anchors)
        again = app_client.post(f"/api/recordings/{rec['id']}/summaries", headers={"x-csrf-token": csrf}, json={"summary_type": mode}).json()["summary"]
        assert again["id"] == sm["id"]

    assert app_client.post(
        f"/api/recordings/{rec['id']}/segments/{segment['id']}/text",
        headers={"x-csrf-token": csrf},
        json={"text": "tamper"},
    ).status_code == 409
    from app.db import session_factory

    with session_factory()() as db:
        with pytest.raises(DBAPIError):
            db.execute(
                text("update transcript_revisions set content = '{}'::jsonb where id = :i"),
                {"i": locked["id"]},
            )
        db.rollback()
        with pytest.raises(DBAPIError):
            db.execute(text("delete from audit_events"))
        db.rollback()
        with pytest.raises(DBAPIError):
            db.execute(
                text("update recordings set sha256 = repeat('0', 64) where id = :i"),
                {"i": rec["id"]},
            )
        db.rollback()

    outputs = {}
    for fmt in ("txt", "docx", "pdf", "json", "zip"):
        response = app_client.post(
            f"/api/recordings/{rec['id']}/exports",
            headers={"x-csrf-token": csrf},
            json={"format": fmt},
        )
        assert response.status_code == 200, response.text
        exported = response.json()["export"]
        download = app_client.get(exported["download_url"])
        assert download.status_code == 200
        assert hashlib.sha256(download.content).hexdigest() == exported["sha256"]
        outputs[fmt] = download.content
    txt = outputs["txt"].decode()
    assert "MURAILEX FORENSIC VERBATIM TRANSCRIPT" in txt
    assert "The original audio recording is the controlling source." in txt
    assert "[المتحدث" in txt and "okay" in txt and locked["sha256"] in txt
    assert outputs["pdf"].startswith(b"%PDF")
    assert outputs["docx"][:2] == b"PK"
    doc = json.loads(outputs["json"])
    assert doc["revision"]["sha256"] == locked["sha256"]

    archive = zipfile.ZipFile(io.BytesIO(outputs["zip"]))
    names = {name.split("/", 1)[1] for name in archive.namelist()}
    for required in (
        "manifest.json",
        "SHA256SUMS.txt",
        "audit_log.json",
        "revision_history.json",
        "provider_runs.json",
        "transcript/transcript.txt",
        "transcript/transcript.docx",
        "transcript/transcript.pdf",
        "transcript/transcript.json",
    ):
        assert required in names
    prefix = archive.namelist()[0].split("/")[0]
    manifest = json.loads(archive.read(f"{prefix}/manifest.json"))
    assert manifest["original_sha256"] == rec["sha256"]
    assert manifest["locked_transcript"]["sha256"] == locked["sha256"]
    assert manifest["original_sha256_reverified_at_export"]["matches"] is True
    assert manifest["audit_chain"]["valid"] is True
    for line in archive.read(f"{prefix}/SHA256SUMS.txt").decode().splitlines():
        digest, name = line.split("  ", 1)
        assert hashlib.sha256(archive.read(f"{prefix}/{name}")).hexdigest() == digest
    # Ed25519 signature over manifest.json, verifiable with the bundled public key only
    from app import signing

    manifest_bytes = archive.read(f"{prefix}/manifest.json")
    signature = archive.read(f"{prefix}/manifest.sig")
    public_pem = archive.read(f"{prefix}/public-key.pem")
    assert len(signature) == 64
    assert signing.verify(public_pem, manifest_bytes, signature)
    assert not signing.verify(public_pem, manifest_bytes.replace(b'"', b"'", 1), signature)
    assert manifest["signature"]["algorithm"] == "Ed25519"
    sums = archive.read(f"{prefix}/SHA256SUMS.txt").decode()
    assert "  manifest.sig" in sums and "  public-key.pem" in sums and "  manifest.json" in sums
    for name in archive.namelist():
        assert b"Certified Transcript" not in archive.read(name)
    runs = json.loads(archive.read(f"{prefix}/provider_runs.json"))
    assert all("raw_response" in run for run in runs)

    events = app_client.get(f"/api/recordings/{rec['id']}/audit").json()
    actions_seen = {event["action"] for event in events["events"]}
    for action in (
        "upload",
        "hash_created",
        "derived_copies_created",
        "provider_submitted",
        "provider_completed",
        "consensus_completed",
        "review_decision",
        "correction",
        "speaker_change",
        "speaker_identity_verified",
        "transcript_locked",
        "export",
    ):
        assert action in actions_seen, action
    assert events["chain"]["valid"] is True

    response = app_client.post(
        f"/api/recordings/{rec['id']}/revisions",
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 200 and response.json()["revision"]["number"] == 2
    revision2 = response.json()["revision"]
    assert all(
        item["revision_id"] == revision2["id"]
        for item in revision2["content"]["segments"]
    )
    segment2 = revision2["content"]["segments"][0]["id"]
    assert app_client.post(
        f"/api/recordings/{rec['id']}/segments/{segment2}/text",
        headers={"x-csrf-token": csrf},
        json={"text": "والله ما شفته okay [غير مسموع]"},
    ).status_code == 200
    revision2_locked = app_client.post(
        f"/api/recordings/{rec['id']}/lock",
        headers={"x-csrf-token": csrf},
    ).json()["revision"]
    assert revision2_locked["sha256"] != locked["sha256"]
    first = app_client.get(
        f"/api/recordings/{rec['id']}/transcript?revision={locked['id']}"
    ).json()["revision"]
    assert first["sha256"] == locked["sha256"] and first["status"] == "locked"

    media = app_client.get(f"/api/recordings/{rec['id']}/media-url?variant=original").json()
    assert hashlib.sha256(app_client.get(media["url"]).content).hexdigest() == rec["sha256"]

    from app.providers import translate as gt

    original_configured, original_translate = gt.configured, gt.translate_batch
    gt.configured = lambda: True  # type: ignore[assignment]
    gt.translate_batch = lambda texts, source, target: (  # type: ignore[assignment]
        [f"EN({item})" for item in texts],
        {"fixture": True},
    )
    try:
        response = app_client.post(
            f"/api/recordings/{rec['id']}/translations",
            headers={"x-csrf-token": csrf},
            json={"mode": "bilingual"},
        )
        assert response.status_code == 200, response.text
        drain_jobs()
        translations = app_client.get(
            f"/api/recordings/{rec['id']}/translations"
        ).json()["translations"]
        translation = translations[0]
        assert translation["status"] == "succeeded" and translation["segments"]
        assert any("[silence]" in segment["translation"] for segment in translation["segments"])
        response = app_client.post(
            f"/api/recordings/{rec['id']}/exports",
            headers={"x-csrf-token": csrf},
            json={"format": "pdf", "translation_id": translation["id"]},
        )
        assert response.status_code == 200
    finally:
        gt.configured, gt.translate_batch = original_configured, original_translate
    after = app_client.get(f"/api/recordings/{rec['id']}/transcript").json()["revision"]
    assert after["sha256"] == revision2_locked["sha256"]

    viewer = app_client.__class__(app_client.app, base_url="http://testserver")
    admin = app_client.__class__(app_client.app, base_url="http://testserver")
    login(admin, "admin@example.com")
    assert admin.get("/api/audit/verify").json()["valid"] is True
    assert admin.get(f"/api/recordings/{rec['id']}").status_code == 200
    _ = viewer


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

    registry.install_test_fixtures(
        [Flaky("flaky", "engine_a.json"), Broken("broken", "engine_b.json")],
        [FixtureDiarization("diarization.json")],
        [],
    )
    try:
        csrf = login(app_client, "owner@example.com")
        rec = upload_file(
            app_client,
            csrf,
            os.path.join(FIXTURES, "sample.m4a"),
            title="Flaky",
            mime="audio/mp4",
        )
        drain_jobs()
        detail = app_client.get(f"/api/recordings/{rec['id']}").json()
        runs = {
            run["provider"]: run
            for run in detail["provider_runs"]
            if run["role"] == "primary_asr"
        }
        assert runs["fixture:flaky"]["status"] == "succeeded"
        assert runs["fixture:flaky"]["attempt"] == 2
        assert runs["fixture:broken"]["status"] == "failed"
        assert detail["recording"]["status"] == "failed"
        assert app_client.get(f"/api/recordings/{rec['id']}/transcript").json()["revision"] is None
        events = {
            event["action"]
            for event in app_client.get(f"/api/recordings/{rec['id']}/audit").json()["events"]
        }
        assert "provider_retry" in events
        assert "provider_failed" in events
        assert "processing_failed" in events
    finally:
        registry.clear_test_fixtures()


def test_resumable_upload_reports_missing_parts(app_client, users):
    csrf = login(app_client, "owner@example.com")
    data = open(SAMPLE, "rb").read()
    body = {
        "filename": "resume.wav",
        "mime_type": "audio/wav",
        "size": len(data),
        "fingerprint": "resume-test",
        **upload_metadata(),
    }
    session1 = app_client.post(
        "/api/uploads",
        headers={"x-csrf-token": csrf},
        json=body,
    ).json()
    chunk_size = session1["chunk_size"]
    app_client.put(
        f"/api/uploads/{session1['id']}/parts/1",
        content=data[:chunk_size],
        headers={"x-csrf-token": csrf},
    )
    response = app_client.post(
        f"/api/uploads/{session1['id']}/complete",
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 409
    assert 2 in response.json()["detail"]["missing_parts"]
    session2 = app_client.post(
        "/api/uploads",
        headers={"x-csrf-token": csrf},
        json=body,
    ).json()
    assert session2["id"] == session1["id"]
    assert session2["received_parts"] == [1]
    for number in range(2, session2["total_parts"] + 1):
        app_client.put(
            f"/api/uploads/{session1['id']}/parts/{number}",
            content=data[(number - 1) * chunk_size : number * chunk_size],
            headers={"x-csrf-token": csrf},
        )
    response = app_client.post(
        f"/api/uploads/{session1['id']}/complete",
        headers={"x-csrf-token": csrf},
    )
    assert response.status_code == 200
    assert response.json()["recording"]["sha256"] == hashlib.sha256(data).hexdigest()
    session3 = app_client.post(
        "/api/uploads",
        headers={"x-csrf-token": csrf},
        json={**body, "fingerprint": "resume-2"},
    ).json()
    bad = app_client.put(
        f"/api/uploads/{session3['id']}/parts/1",
        content=data[:chunk_size],
        headers={"x-csrf-token": csrf, "x-chunk-sha256": "0" * 64},
    )
    assert bad.status_code == 422


def test_worker_lease_recovery(users):
    """A job whose worker died (expired lease) is reclaimed by another worker."""
    from datetime import datetime, timedelta, timezone

    from app.db import session_factory
    from app.jobs import claim
    from app.models import Job

    with session_factory()() as db:
        job = Job(
            kind="noop-test",
            payload={},
            status="running",
            locked_by="dead-worker",
            locked_until=datetime.now(timezone.utc) - timedelta(seconds=5),
            run_after=datetime.now(timezone.utc) - timedelta(seconds=10),
        )
        db.add(job)
        db.commit()
        job_id = job.id
    with session_factory()() as db:
        got = claim(db, "live-worker")
        assert got is not None and got.id == job_id and got.locked_by == "live-worker"
        got.status = "failed"
        db.commit()


def test_routing_without_diarization_engine_leaves_speakers_unattributed(app_client, users):
    """Local routing defines no diarization engine: the transcript must still be produced,
    every primary token kept, and no speaker identity inferred."""
    from app.providers import registry
    from app.providers.fixture import FixtureAsr

    registry.install_test_fixtures(
        [FixtureAsr("engine_a", "engine_a.json"), FixtureAsr("engine_b", "engine_b.json")],
        [],
        [FixtureAsr("verifier", "verifier.json", role="verification_asr")],
    )
    try:
        csrf = login(app_client, "owner@example.com")
        rec = upload_file(app_client, csrf, SAMPLE, title="No diarization")
        drain_jobs()
        detail = app_client.get(f"/api/recordings/{rec['id']}").json()
        assert detail["recording"]["status"] in ("ready", "needs_review"), detail["recording"]
        content = app_client.get(f"/api/recordings/{rec['id']}/transcript").json()["revision"]["content"]
        assert content["method"]["diarization"]["status"] == "not_performed"
        assert content["method"]["diarization"]["independent"] is False
        assert content["speakers"] == {} or all(not v.get("verified_name") for v in content["speakers"].values())
        assert all(seg["speaker"] is None for seg in content["segments"])
        assert any(item["text"] for seg in content["segments"] for item in seg["items"])
    finally:
        registry.clear_test_fixtures()


def test_provider_self_test_does_not_change_recording_processing_status(app_client, users, fixture_providers):
    """A self-test creates derived copies but is not processing: the recording's status must
    not be left at 'analyzing' (which blocked reprocessing and kept the UI polling)."""
    import uuid as _uuid

    from app.db import session_factory
    from app.forensic_models import ProviderSelfTest
    from app.models import Recording
    from app.pipeline.process import Wait
    from app.provider_selftest import run_provider_self_test

    csrf = login(app_client, "owner@example.com")
    rec = upload_file(app_client, csrf, SAMPLE, title="Self-test status")
    with session_factory()() as db:
        before = db.get(Recording, _uuid.UUID(rec["id"]))
        assert before is not None and before.derived is None
        status_before = (before.status, before.status_detail)
        test = ProviderSelfTest(
            provider="fixture:engine_a",
            model="fixture",
            locale="ar-YE",
            role="primary_asr",
            recording_id=before.id,
            status="BLOCKED",
            error="queued",
            requested_by=before.owner_id,
        )
        db.add(test)
        db.commit()
        for _ in range(20):
            try:
                run_provider_self_test(db, test)
                break
            except Wait:
                db.rollback()
                test = db.get(ProviderSelfTest, test.id)
        after = db.get(Recording, before.id)
        assert test.status == "READY"
        assert after.derived and after.derived.get("analysis_wav")
        assert (after.status, after.status_detail) == status_before
    drain_jobs()


def test_request_bodies_are_strict(app_client, users):
    csrf = login(app_client, "owner@example.com")
    base = {"filename": "s.wav", "size": 10, "fingerprint": "strict", **upload_metadata()}
    unknown = app_client.post("/api/uploads", headers={"x-csrf-token": csrf}, json={**base, "owner_id": "x"})
    assert unknown.status_code == 422
    coerced = app_client.post("/api/uploads", headers={"x-csrf-token": csrf}, json={**base, "size": "10"})
    assert coerced.status_code == 422


def test_integrity_verification_detects_tampering_and_blocks(app_client, users, fixture_providers):
    import uuid

    from app.db import session_factory
    from app.models import Recording

    csrf = login(app_client, "owner@example.com")
    rec = upload_file(app_client, csrf, SAMPLE, title="integrity check")
    drain_jobs()
    ok = app_client.post(f"/api/recordings/{rec['id']}/integrity", headers={"x-csrf-token": csrf}).json()
    assert ok["integrity"]["ok"] is True
    assert {c["check"] for c in ok["integrity"]["checks"]} >= {"original_sha256", "working_audio_sha256"}
    # tamper with the persisted working-audio hash out of band (revisions are DB-guarded)
    with session_factory()() as db:
        row = db.get(Recording, uuid.UUID(rec["id"]))
        derived = dict(row.derived)
        derived["analysis_wav"] = {**derived["analysis_wav"], "sha256": "0" * 64}
        row.derived = derived
        db.commit()
    bad = app_client.post(f"/api/recordings/{rec['id']}/integrity", headers={"x-csrf-token": csrf}).json()
    assert bad["integrity"]["ok"] is False and bad["recording"]["status"] == "integrity_failure"
    assert app_client.post(f"/api/recordings/{rec['id']}/exports", headers={"x-csrf-token": csrf}, json={"format": "txt"}).status_code == 409
    assert app_client.post(f"/api/recordings/{rec['id']}/lock", headers={"x-csrf-token": csrf}).status_code == 409
    # restoring the record and re-verifying is the only way out of INTEGRITY_FAILURE
    with session_factory()() as db:
        row = db.get(Recording, uuid.UUID(rec["id"]))
        derived = dict(row.derived)
        derived["analysis_wav"] = {**derived["analysis_wav"], "sha256": ok["integrity"]["checks"][1]["expected"]}
        row.derived = derived
        db.commit()
    again = app_client.post(f"/api/recordings/{rec['id']}/integrity", headers={"x-csrf-token": csrf}).json()
    assert again["integrity"]["ok"] is True and again["recording"]["status"] == "needs_review"


def test_out_of_order_timestamp_beside_dispute_is_accounted_once(app_client, users):
    """Regression: a dispute's primary candidate must hold exactly its aligned columns; an
    accepted token whose timestamp falls inside the region span must not be persisted twice."""
    from app.providers import registry
    from app.providers.fixture import FixtureAsr, FixtureDiarization

    registry.install_test_fixtures(
        [FixtureAsr("engine_a", "ooo_engine_a.json"), FixtureAsr("engine_b", "ooo_engine_b.json")],
        [FixtureDiarization("diarization.json")],
        [FixtureAsr("verifier", "verifier.json", role="verification_asr")],
    )
    try:
        csrf = login(app_client, "owner@example.com")
        rec = upload_file(app_client, csrf, SAMPLE, title="out of order")
        drain_jobs()
        out = app_client.get(f"/api/recordings/{rec['id']}").json()["recording"]
        assert out["status"] in ("needs_review", "ready"), out["status_detail"]
    finally:
        registry.clear_test_fixtures()


def test_untouched_machine_draft_is_regenerated_not_duplicated(app_client, users, fixture_providers):
    import uuid

    from app.db import session_factory
    from app.forensic_models import EvidenceSpan
    from app.models import Dispute, TranscriptRevision

    csrf = login(app_client, "owner@example.com")
    rec = upload_file(app_client, csrf, SAMPLE, title="regenerate draft")
    drain_jobs()
    rid = uuid.UUID(rec["id"])
    with session_factory()() as db:
        before = db.query(Dispute).filter_by(recording_id=rid, status="open").count()
        spans_before = db.query(EvidenceSpan).join(TranscriptRevision, EvidenceSpan.revision_id == TranscriptRevision.id).filter(TranscriptRevision.recording_id == rid).count()
    assert before > 0 and spans_before > 0
    assert app_client.post(f"/api/recordings/{rec['id']}/reprocess", headers={"x-csrf-token": csrf}).status_code == 200
    drain_jobs()
    out = app_client.get(f"/api/recordings/{rec['id']}").json()
    assert out["recording"]["status"] in ("needs_review", "ready"), (out["recording"]["status_detail"], out["job"])
    with session_factory()() as db:
        assert db.query(TranscriptRevision).filter_by(recording_id=rid).count() == 1
        assert db.query(Dispute).filter_by(recording_id=rid, status="superseded").count() == before
        assert db.query(Dispute).filter_by(recording_id=rid, status="open").count() == before
        spans_after = db.query(EvidenceSpan).join(TranscriptRevision, EvidenceSpan.revision_id == TranscriptRevision.id).filter(TranscriptRevision.recording_id == rid).count()
        assert spans_after == spans_before  # replaced, not accumulated
    # once a reviewer resolves anything, the draft is no longer machine-only: no rebuild
    dispute = app_client.get(f"/api/recordings/{rec['id']}/disputes").json()["disputes"]
    open_one = next(d for d in dispute if d["status"] == "open")
    assert app_client.post(f"/api/disputes/{open_one['id']}/resolve", headers={"x-csrf-token": csrf}, json={"action": "mark_inaudible"}).status_code == 200
    assert app_client.post(f"/api/recordings/{rec['id']}/reprocess", headers={"x-csrf-token": csrf}).status_code == 409
