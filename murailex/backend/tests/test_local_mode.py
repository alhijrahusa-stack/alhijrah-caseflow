"""Local single-machine mode: on-device routing, honest labelling, filesystem evidence store."""
from __future__ import annotations

import hashlib
import io
import os

import pytest

from app import storage
from app.config import get_settings
from app.providers import privacy, registry


@pytest.fixture
def local(monkeypatch, tmp_path):
    s = get_settings()
    monkeypatch.setattr(s, "environment", "local")
    monkeypatch.setattr(s, "storage_backend", "filesystem")
    monkeypatch.setattr(s, "local_storage_dir", str(tmp_path / "objects"))
    return s


def test_local_routing_is_on_device_only(local):
    for locale in registry.SUPPORTED_LOCALES:
        routed = registry.routed_adapters(locale)
        assert [(a.name, role) for a, role in routed] == [
            ("local_whisper", "primary_asr"),
            ("local_whisper_verify", "verification_asr"),
        ]
    assert registry.required_roles() == {"primary_asr", "verification_asr"}
    assert privacy.approved("local_whisper") and privacy.approved("local_whisper_verify")
    # Cloud providers keep their fail-closed gates in local mode.
    assert not privacy.approved("assemblyai")


def test_local_engine_state_requires_real_self_test_and_is_labelled_unbenchmarked(local):
    state = registry.engine_state(None, registry.local_primary(), "primary_asr", "ar")
    assert state["status"] == "BLOCKED"
    assert "self-test" in state["blocker"]
    assert state["benchmark"].startswith("NOT BENCHMARKED")
    assert state["model"] == "large-v3"


def test_local_engines_are_never_used_outside_local_mode(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "environment", "production")
    assert not registry.local_primary().info({}).configured
    assert not privacy.approved("local_whisper")
    assert registry.required_roles() == {"primary_asr", "diarization", "verification_asr"}
    assert all(a.name not in privacy.LOCAL_PROVIDERS for a, _ in registry.routed_adapters("ar"))


def test_local_whisper_normalize_keeps_every_word_and_coverage(local):
    adapter = registry.local_primary()
    raw = {
        "model": "large-v3",
        "language": "ar",
        "audio_duration_s": 3.0,
        "segments": [
            {"start": 0.0, "end": 2.5, "text": " قال إنه سيدفع", "words": [
                {"start": 0.0, "end": 0.4, "word": " قال", "probability": 0.9},
                {"start": 0.4, "end": 0.9, "word": " إنه", "probability": 0.8},
                {"start": 0.9, "end": 2.5, "word": " سيدفع", "probability": 0.7},
            ]},
        ],
    }
    out = adapter.normalize(raw)
    assert [t["text"] for t in out["tokens"]] == ["قال", "إنه", "سيدفع"]
    assert out["tokens"][2] == {"text": "سيدفع", "start_ms": 900, "end_ms": 2500, "confidence": 0.7, "speaker": None}
    assert out["coverage"] == {"audio_duration_ms": 3000, "decoded_until_ms": 2500, "segments": 1}


def test_local_whisper_rejects_model_substitution(local):
    from app.providers.base import ProviderError

    with pytest.raises(ProviderError):
        registry.local_primary().normalize({"model": "small", "segments": []})


def test_filesystem_storage_roundtrip_is_write_once(local):
    data = os.urandom(300_000)
    storage.put_bytes("a/b/obj.bin", data, "application/octet-stream")
    assert storage.get_bytes("a/b/obj.bin") == data
    assert storage.sha256_of_object("a/b/obj.bin") == (hashlib.sha256(data).hexdigest(), len(data))
    assert storage.head("a/b/obj.bin")["ContentLength"] == len(data)
    rng = storage.get_stream("a/b/obj.bin", None, "bytes=10-19")["Body"].read()
    assert rng == data[10:20]
    # identical retry is idempotent; different bytes can never replace the object
    storage.put_file("a/b/obj.bin", io.BytesIO(data), "application/octet-stream")
    with pytest.raises(FileExistsError):
        storage.put_bytes("a/b/obj.bin", b"tampered", "application/octet-stream")
    assert storage.get_bytes("a/b/obj.bin") == data
    with pytest.raises(ValueError):
        storage.put_bytes("../escape.bin", b"x", "application/octet-stream")


def test_filesystem_multipart_concatenates_in_order_and_verifies_parts(local):
    upload = storage.start_multipart("orig/x.mp3", "audio/mpeg")
    e2 = storage.upload_part("orig/x.mp3", upload, 2, b"world")
    e1 = storage.upload_part("orig/x.mp3", upload, 1, b"hello ")
    result = storage.complete_multipart("orig/x.mp3", upload, [(2, e2), (1, e1)])
    assert result["VersionId"] is None
    assert storage.get_bytes("orig/x.mp3") == b"hello world"
    bad = storage.start_multipart("orig/y.mp3", "audio/mpeg")
    storage.upload_part("orig/y.mp3", bad, 1, b"abc")
    with pytest.raises(ValueError):
        storage.complete_multipart("orig/y.mp3", bad, [(1, "0" * 32)])
