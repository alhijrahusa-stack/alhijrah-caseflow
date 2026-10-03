from __future__ import annotations

import os
import shutil
import tempfile

TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://murailex:murailex@localhost:5432/murailex_test")
os.environ.update(
    {
        "ENVIRONMENT": "test",
        "TEST_FIXTURE_PROVIDERS": "true",
        "DATABASE_URL": TEST_DB,
        "SECRET_KEY": "test-secret-key-that-is-long-enough-0123456789",
        "COOKIE_SECURE": "false",
        "S3_ENDPOINT_URL": "http://127.0.0.1:5055",
        "S3_ACCESS_KEY_ID": "testing",
        "S3_SECRET_ACCESS_KEY": "testing",
        "S3_BUCKET": "murailex-test",
        "S3_OBJECT_LOCK_MODE": "GOVERNANCE",
        "S3_OBJECT_LOCK_DAYS": "1",
        "UPLOAD_CHUNK_BYTES": str(512 * 1024),
        "PROVIDER_POLL_SECONDS": "0",
        "PROVIDER_RETRY_BASE_SECONDS": "0",
        "RATE_LIMIT_PER_MINUTE": "100000",
        "MURAILEX_WORK_DIR": tempfile.mkdtemp(prefix="murailex-test-"),
        "S3_UPLOAD_PART_MIN_SIZE": "1",
    }
)
for k in ("AWS_CA_BUNDLE", "ASSEMBLYAI_API_KEY", "GOOGLE_CREDENTIALS_JSON", "PYANNOTE_API_KEY", "OPENAI_API_KEY", "DEEPGRAM_API_KEY", "HTTPS_PROXY", "https_proxy"):
    os.environ.pop(k, None)
os.environ["NO_PROXY"] = "127.0.0.1,localhost"

import boto3  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from moto.server import ThreadedMotoServer  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

HERE = os.path.dirname(__file__)
FIXTURES = os.path.join(HERE, "fixtures")


@pytest.fixture(scope="session", autouse=True)
def infrastructure():
    server = ThreadedMotoServer(ip_address="127.0.0.1", port=5055, verbose=False)
    server.start()
    s3 = boto3.client("s3", endpoint_url="http://127.0.0.1:5055", region_name="us-east-1",
                      aws_access_key_id="testing", aws_secret_access_key="testing")
    s3.create_bucket(Bucket="murailex-test", ObjectLockEnabledForBucket=True)
    s3.put_bucket_versioning(Bucket="murailex-test", VersioningConfiguration={"Status": "Enabled"})

    eng = create_engine(TEST_DB)
    with eng.begin() as c:
        c.execute(text("drop schema public cascade; create schema public;"))
    eng.dispose()
    cfg = Config(os.path.join(HERE, "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(HERE, "..", "alembic"))
    cfg.set_main_option("sqlalchemy.url", TEST_DB)
    command.upgrade(cfg, "head")
    yield
    server.stop()
    shutil.rmtree(os.environ["MURAILEX_WORK_DIR"], ignore_errors=True)


@pytest.fixture()
def app_client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(), base_url="http://testserver") as c:
        yield c


@pytest.fixture()
def fixture_providers():
    from app.providers import registry
    from app.providers.fixture import FixtureAsr, FixtureDiarization

    registry.install_test_fixtures(
        [FixtureAsr("engine_a", "engine_a.json"), FixtureAsr("engine_b", "engine_b.json")],
        [FixtureDiarization("diarization.json")],
        [FixtureAsr("verifier", "verifier.json", role="verification_asr")],
    )
    yield
    registry.clear_test_fixtures()


def make_user(email: str, role: str = "transcriber", password: str = "correct horse battery staple") -> None:
    from app import audit
    from app.db import session_factory
    from app.models import User
    from app.security import hash_password

    with session_factory()() as db:
        u = User(email=email, display_name=email.split("@")[0], password_hash=hash_password(password), role=role)
        db.add(u)
        db.flush()
        audit.record(db, "user_created", actor_label="test", details={"email": email})
        db.commit()


def login(client, email: str, password: str = "correct horse battery staple") -> str:
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["csrf_token"]


def upload_file(client, csrf: str, path: str, title: str = "Test recording", mime: str = "audio/wav") -> dict:
    data = open(path, "rb").read()
    r = client.post("/api/uploads", headers={"x-csrf-token": csrf},
                    json={"filename": os.path.basename(path), "mime_type": mime, "size": len(data), "fingerprint": f"{os.path.basename(path)}:{len(data)}:{title}", "title": title})
    assert r.status_code == 200, r.text
    sess = r.json()
    cs = sess["chunk_size"]
    for n in range(1, sess["total_parts"] + 1):
        chunk = data[(n - 1) * cs : n * cs]
        rr = client.put(f"/api/uploads/{sess['id']}/parts/{n}", content=chunk, headers={"x-csrf-token": csrf, "content-type": "application/octet-stream"})
        assert rr.status_code == 200, rr.text
    r = client.post(f"/api/uploads/{sess['id']}/complete", headers={"x-csrf-token": csrf})
    assert r.status_code == 200, r.text
    return r.json()["recording"]


def drain_jobs(max_steps: int = 200) -> int:
    from app.jobs import run_one

    steps = 0
    while steps < max_steps and run_one("test-worker"):
        steps += 1
    return steps
