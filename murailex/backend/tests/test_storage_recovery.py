import hashlib
import io

import pytest

from app import storage


@pytest.mark.parametrize("chunks", [[b"abc", b"defg"], [b"x" * 1100000, b"last"]])
def test_verified_recovery_checks_each_part_and_full_hash(monkeypatch, chunks):
    body = io.BytesIO(b"".join(chunks))
    monkeypatch.setattr(storage, "get_stream", lambda *args: {"Body": body})
    parts = [(len(chunk), hashlib.sha256(chunk).hexdigest()) for chunk in chunks]
    digest, size = storage.verify_object_parts("original", parts, "version")
    assert (digest, size) == (hashlib.sha256(b"".join(chunks)).hexdigest(), sum(map(len, chunks)))
    assert body.closed


@pytest.mark.parametrize("stored", [b"ab", b"abcd", b"xyz"])
def test_verified_recovery_rejects_missing_extra_or_changed_bytes(monkeypatch, stored):
    body = io.BytesIO(stored)
    monkeypatch.setattr(storage, "get_stream", lambda *args: {"Body": body})
    with pytest.raises(ValueError):
        storage.verify_object_parts("original", [(3, hashlib.sha256(b"abc").hexdigest())])
    assert body.closed
