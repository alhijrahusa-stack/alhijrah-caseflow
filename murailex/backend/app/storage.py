from __future__ import annotations

import hashlib
import os
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from typing import Any, BinaryIO

import boto3
from botocore.config import Config

from .config import get_settings

_client = None


# ------------------------------------------------------------ filesystem backend
# Single-machine local use only (STORAGE_BACKEND=filesystem). Objects live in a private
# directory, are written once (an existing object is never overwritten) and are made
# read-only on disk. Multipart parts are staged and concatenated on completion.


def _fs() -> bool:
    return get_settings().storage_backend == "filesystem"


def _root() -> str:
    root = os.path.abspath(get_settings().local_storage_dir)
    os.makedirs(root, mode=0o700, exist_ok=True)
    return root


def _path(key: str) -> str:
    root = _root()
    full = os.path.abspath(os.path.join(root, key))
    if not full.startswith(root + os.sep):
        raise ValueError("Object key escapes the storage root.")
    return full


def _staging(upload_id: str) -> str:
    if not upload_id.isalnum():
        raise ValueError("Invalid upload id.")
    d = os.path.join(_root(), ".multipart", upload_id)
    os.makedirs(d, mode=0o700, exist_ok=True)
    return d


def _write_once(key: str, chunks: Iterator[bytes]) -> dict[str, Any]:
    target = _path(key)
    os.makedirs(os.path.dirname(target), mode=0o700, exist_ok=True)
    tmp = f"{target}.{uuid.uuid4().hex}.partial"
    h = hashlib.sha256()
    with open(tmp, "wb") as fh:
        for data in chunks:
            h.update(data)
            fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    os.chmod(tmp, 0o400)
    if os.path.exists(target):
        # Idempotent retry of an identical write is allowed; different bytes never replace an object.
        same = _fs_sha(target) == h.hexdigest()
        os.remove(tmp)
        if not same:
            raise FileExistsError(f"Object already exists and is immutable: {key}")
        return {"VersionId": None, "ChecksumSHA256": h.hexdigest()}
    os.rename(tmp, target)
    return {"VersionId": None, "ChecksumSHA256": h.hexdigest()}


def _fs_sha(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for data in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(data)
    return h.hexdigest()


class _FsBody:
    def __init__(self, path: str, start: int = 0, end: int | None = None):
        self._fh = open(path, "rb")
        self._fh.seek(start)
        self._left = (end - start + 1) if end is not None else None

    def read(self, n: int = -1) -> bytes:
        if self._left is not None:
            n = self._left if n < 0 else min(n, self._left)
        data = self._fh.read(n)
        if self._left is not None:
            self._left -= len(data)
        return data

    def iter_chunks(self, chunk_size: int = 1024 * 1024) -> Iterator[bytes]:
        try:
            while True:
                data = self.read(chunk_size)
                if not data:
                    break
                yield data
        finally:
            self.close()

    def close(self) -> None:
        self._fh.close()


def _fs_iter_bytes(data: bytes) -> Iterator[bytes]:
    yield data


def _fs_iter_file(fileobj: BinaryIO) -> Iterator[bytes]:
    while True:
        data = fileobj.read(1024 * 1024)
        if not data:
            break
        yield data


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


def _sse() -> dict[str, Any]:
    mode = get_settings().s3_server_side_encryption
    return {"ServerSideEncryption": mode} if mode else {}


def start_multipart(key: str, content_type: str) -> str:
    if _fs():
        upload_id = uuid.uuid4().hex
        _staging(upload_id)
        return upload_id
    resp = client().create_multipart_upload(
        Bucket=bucket(), Key=key, ContentType=content_type, **_sse(), **_lock_args()
    )
    return resp["UploadId"]


def upload_part(key: str, upload_id: str, part_number: int, data: bytes) -> str:
    if _fs():
        part = os.path.join(_staging(upload_id), f"{part_number:06d}")
        with open(part, "wb") as fh:
            fh.write(data)
        return hashlib.md5(data).hexdigest()
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
    if _fs():
        staging = _staging(upload_id)

        def chunks() -> Iterator[bytes]:
            for number, etag in sorted(parts):
                with open(os.path.join(staging, f"{number:06d}"), "rb") as fh:
                    data = fh.read()
                if hashlib.md5(data).hexdigest() != etag:
                    raise ValueError(f"Multipart part {number} does not match its recorded checksum.")
                yield data

        result = _write_once(key, chunks())
        abort_multipart(key, upload_id)
        return result
    return client().complete_multipart_upload(
        Bucket=bucket(),
        Key=key,
        UploadId=upload_id,
        MultipartUpload={"Parts": [{"PartNumber": n, "ETag": e} for n, e in sorted(parts)]},
    )


def abort_multipart(key: str, upload_id: str) -> None:
    if _fs():
        import shutil

        shutil.rmtree(_staging(upload_id), ignore_errors=True)
        return
    client().abort_multipart_upload(Bucket=bucket(), Key=key, UploadId=upload_id)


def put_bytes(key: str, data: bytes, content_type: str, lock: bool = False) -> dict[str, Any]:
    if _fs():
        return _write_once(key, _fs_iter_bytes(data))
    return client().put_object(
        Bucket=bucket(),
        Key=key,
        Body=data,
        ContentType=content_type,
        ChecksumAlgorithm="SHA256",
        **_sse(),
        **(_lock_args() if lock else {}),
    )


def put_file(key: str, fileobj: BinaryIO, content_type: str) -> dict[str, Any]:
    if _fs():
        return _write_once(key, _fs_iter_file(fileobj))
    return client().put_object(
        Bucket=bucket(), Key=key, Body=fileobj, ContentType=content_type, **_sse()
    )


def head(key: str, version_id: str | None = None) -> dict[str, Any]:
    if _fs():
        return {"ContentLength": os.path.getsize(_path(key)), "VersionId": None}
    args: dict[str, Any] = {"Bucket": bucket(), "Key": key}
    if version_id:
        args["VersionId"] = version_id
    return client().head_object(**args)


def get_stream(key: str, version_id: str | None = None, byte_range: str | None = None) -> dict[str, Any]:
    if _fs():
        path = _path(key)
        if byte_range:
            first, _, last = byte_range.removeprefix("bytes=").partition("-")
            return {"Body": _FsBody(path, int(first), int(last))}
        return {"Body": _FsBody(path), "ContentLength": os.path.getsize(path)}
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
    if _fs():
        root = _root()
        return {"backend": "filesystem", "reachable": os.access(root, os.R_OK | os.W_OK), "versioning": "write-once", "object_lock": "write-once"}
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
