from __future__ import annotations

import hashlib
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from typing import Any, BinaryIO

import boto3
from botocore.config import Config

from .config import get_settings

_client = None


def client():
    global _client
    if _client is None:
        s = get_settings()
        _client = boto3.client(
            "s3",
            endpoint_url=s.s3_endpoint_url or None,
            region_name=s.s3_region,
            aws_access_key_id=s.s3_access_key_id.get_secret_value() if s.s3_access_key_id else None,
            aws_secret_access_key=s.s3_secret_access_key.get_secret_value() if s.s3_secret_access_key else None,
            config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
        )
    return _client


def reset_client() -> None:
    global _client
    _client = None


def bucket() -> str:
    return get_settings().s3_bucket


def _lock_args() -> dict[str, Any]:
    s = get_settings()
    if s.s3_object_lock_mode and s.s3_object_lock_days > 0:
        return {
            "ObjectLockMode": s.s3_object_lock_mode,
            "ObjectLockRetainUntilDate": datetime.now(timezone.utc) + timedelta(days=s.s3_object_lock_days),
        }
    return {}


def start_multipart(key: str, content_type: str) -> str:
    resp = client().create_multipart_upload(
        Bucket=bucket(), Key=key, ContentType=content_type, ServerSideEncryption="AES256", **_lock_args()
    )
    return resp["UploadId"]


def upload_part(key: str, upload_id: str, part_number: int, data: bytes) -> str:
    resp = client().upload_part(
        Bucket=bucket(),
        Key=key,
        UploadId=upload_id,
        PartNumber=part_number,
        Body=data,
        ContentMD5=__import__("base64").b64encode(hashlib.md5(data).digest()).decode(),
    )
    return resp["ETag"]


def complete_multipart(key: str, upload_id: str, parts: list[tuple[int, str]]) -> dict[str, Any]:
    return client().complete_multipart_upload(
        Bucket=bucket(),
        Key=key,
        UploadId=upload_id,
        MultipartUpload={"Parts": [{"PartNumber": n, "ETag": e} for n, e in sorted(parts)]},
    )


def abort_multipart(key: str, upload_id: str) -> None:
    client().abort_multipart_upload(Bucket=bucket(), Key=key, UploadId=upload_id)


def put_bytes(key: str, data: bytes, content_type: str, lock: bool = False) -> dict[str, Any]:
    return client().put_object(
        Bucket=bucket(),
        Key=key,
        Body=data,
        ContentType=content_type,
        ServerSideEncryption="AES256",
        ChecksumAlgorithm="SHA256",
        **(_lock_args() if lock else {}),
    )


def put_file(key: str, fileobj: BinaryIO, content_type: str) -> dict[str, Any]:
    return client().put_object(
        Bucket=bucket(), Key=key, Body=fileobj, ContentType=content_type, ServerSideEncryption="AES256"
    )


def head(key: str, version_id: str | None = None) -> dict[str, Any]:
    args: dict[str, Any] = {"Bucket": bucket(), "Key": key}
    if version_id:
        args["VersionId"] = version_id
    return client().head_object(**args)


def get_stream(key: str, version_id: str | None = None, byte_range: str | None = None) -> dict[str, Any]:
    args: dict[str, Any] = {"Bucket": bucket(), "Key": key}
    if version_id:
        args["VersionId"] = version_id
    if byte_range:
        args["Range"] = byte_range
    return client().get_object(**args)


def iter_object(key: str, version_id: str | None = None, chunk: int = 1024 * 1024) -> Iterator[bytes]:
    body = get_stream(key, version_id)["Body"]
    try:
        while True:
            data = body.read(chunk)
            if not data:
                break
            yield data
    finally:
        body.close()


def sha256_of_object(key: str, version_id: str | None = None) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    for data in iter_object(key, version_id):
        h.update(data)
        size += len(data)
    return h.hexdigest(), size


def download_to(key: str, path: str, version_id: str | None = None) -> None:
    with open(path, "wb") as fh:
        fh.writelines(iter_object(key, version_id))


def get_bytes(key: str) -> bytes:
    return b"".join(iter_object(key))


def check() -> dict[str, Any]:
    c = client()
    c.head_bucket(Bucket=bucket())
    info: dict[str, Any] = {"bucket": bucket(), "reachable": True}
    try:
        info["versioning"] = c.get_bucket_versioning(Bucket=bucket()).get("Status", "Disabled")
    except Exception:  # noqa: BLE001
        info["versioning"] = "unknown"
    try:
        cfg = c.get_object_lock_configuration(Bucket=bucket())
        info["object_lock"] = cfg.get("ObjectLockConfiguration", {}).get("ObjectLockEnabled", "Disabled")
    except Exception:  # noqa: BLE001
        info["object_lock"] = "Disabled"
    return info
