"""Full local stack for browser end-to-end tests using the real local ASR engine.

Starts an S3 API emulator (versioning + Object Lock), migrates a dedicated PostgreSQL
database, and runs the real API and durable worker. No fixture ASR, diarization, or
verification providers are installed here.
"""
from __future__ import annotations

import os
import tempfile
import threading

os.environ.update({
    "ENVIRONMENT": "test",
    "TEST_FIXTURE_PROVIDERS": "true",
    "MURAILEX_LOCAL_ASR_MODEL": "large-v3-turbo",
    "MURAILEX_LOCAL_ASR_DEVICE": "cpu",
    "MURAILEX_LOCAL_ASR_COMPUTE_TYPE": "int8",
    "MURAILEX_LOCAL_ASR_CACHE": os.path.join(os.path.expanduser("~"), ".cache", "murailex", "whisper"),
    "DATABASE_URL": os.environ.get("E2E_DATABASE_URL", "postgresql+psycopg://murailex:murailex@localhost:5432/murailex_e2e"),
    "SECRET_KEY": "e2e-secret-key-that-is-long-enough-0123456789",
    "COOKIE_SECURE": "false",
    "S3_ENDPOINT_URL": "http://127.0.0.1:5056",
    "S3_ACCESS_KEY_ID": "testing",
    "S3_SECRET_ACCESS_KEY": "testing",
    "S3_BUCKET": "murailex-e2e",
    "PROVIDER_POLL_SECONDS": "0.5",
    "PROVIDER_RETRY_BASE_SECONDS": "0.5",
    "BOOTSTRAP_ADMIN_EMAIL": "admin@example.com",
    "BOOTSTRAP_ADMIN_PASSWORD": "e2e admin password 123",
    "MURAILEX_WORK_DIR": tempfile.mkdtemp(prefix="murailex-e2e-"),
    "S3_UPLOAD_PART_MIN_SIZE": "1",
    "NO_PROXY": "127.0.0.1,localhost",
})
os.environ.pop("AWS_CA_BUNDLE", None)

import boto3  # noqa: E402
import uvicorn  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402


HERE = os.path.dirname(os.path.abspath(__file__))


def main() -> None:
    server = ThreadedMotoServer(ip_address="127.0.0.1", port=5056, verbose=False)
    server.start()
    s3 = boto3.client("s3", endpoint_url="http://127.0.0.1:5056", region_name="us-east-1",
                      aws_access_key_id="testing", aws_secret_access_key="testing")
    s3.create_bucket(Bucket="murailex-e2e", ObjectLockEnabledForBucket=True)
    s3.put_bucket_versioning(Bucket="murailex-e2e", VersioningConfiguration={"Status": "Enabled"})

    eng = create_engine(os.environ["DATABASE_URL"])
    with eng.begin() as c:
        c.execute(text("drop schema public cascade; create schema public;"))
    eng.dispose()
    cfg = Config(os.path.join(HERE, "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(HERE, "..", "alembic"))
    cfg.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])
    command.upgrade(cfg, "head")

    from app.jobs import worker_loop

    threading.Thread(target=worker_loop, kwargs={"poll_seconds": 0.5}, daemon=True).start()
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, log_level="warning")


if __name__ == "__main__":
    main()
