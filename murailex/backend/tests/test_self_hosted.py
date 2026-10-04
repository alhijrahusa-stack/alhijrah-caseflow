"""Self-hosted production route: on-device engines outside ENVIRONMENT=local keep every
production gate, including a persisted held-out benchmark bound to the engine fingerprint."""
from __future__ import annotations

import json

from app.config import get_settings
from app.providers import privacy, registry


def _prod_self_hosted(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "environment", "production")
    monkeypatch.setattr(s, "asr_route", "self_hosted")
    monkeypatch.setattr(s, "local_diar_dir", "")
    return s


def test_self_hosted_routes_only_on_device_engines(monkeypatch):
    _prod_self_hosted(monkeypatch)
    assert registry.local_mode() and not registry.personal_local()
    names = [a.name for a, _ in registry.routed_adapters("ar")]
    assert names == ["local_whisper", "local_whisper_verify"]  # no cloud route, no fallback
    assert privacy.approved("local_whisper") and not privacy.approved("assemblyai")


def test_benchmark_gate_requires_persisted_fingerprint_bound_run(monkeypatch, tmp_path):
    from app import benchmark_import
    from app.db import session_factory

    s = _prod_self_hosted(monkeypatch)
    primary = registry.local_primary()
    with session_factory()() as db:
        state = registry.engine_state(db, primary, "primary_asr", "ar")
        assert state["status"] == "BLOCKED" and "benchmark" in state["blocker"].lower()

        fp = primary.info({"language_locale": "ar"}).parameters["engine_fingerprint"]
        payload = {
            "dataset_version": "unit-ds", "split": "held_out", "commit_sha": "x", "provider": "local_whisper",
            "model": primary.info().model, "locale": "ar", "parameters": {"engine_fingerprint": fp},
            "environment": {}, "audio_hours": 0.001,
            "items": [{"item_id": "a", "ground_truth": "قال ذلك", "hypothesis": "قال ذلك", "human_ground_truth": True,
                       "critical_reference": [], "critical_hypothesis": []}],
        }
        data = json.dumps(payload).encode()
        (tmp_path / "unit.json").write_bytes(data)
        monkeypatch.setattr(benchmark_import, "BENCH_DIR", str(tmp_path))
        assert len(benchmark_import.import_benchmarks(db)) == 1
        assert benchmark_import.import_benchmarks(db) == []  # idempotent
        rid = str(benchmark_import.run_id_for(data))
        monkeypatch.setattr(s, "benchmark_routing_approved", True)
        monkeypatch.setattr(s, "benchmark_dataset_version", "unit-ds")
        monkeypatch.setattr(s, "benchmark_held_out_run_id", rid)
        assert registry._held_out_evidence(db, registry.engine_spec(primary, "primary_asr", "ar"))
        # a different engine fingerprint (e.g. changed decode config) is not covered by that run
        monkeypatch.setattr(s, "local_asr_beam_size", 3)
        assert not registry._held_out_evidence(db, registry.engine_spec(registry.local_primary(), "primary_asr", "ar"))


def test_signing_key_from_secret_is_stable(monkeypatch):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from pydantic import SecretStr

    from app import signing

    pem = Ed25519PrivateKey.generate().private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    monkeypatch.setattr(get_settings(), "evidence_signing_key_pem", SecretStr(pem))
    monkeypatch.setattr(signing, "_KEY", None)
    sig = signing.sign(b"manifest")
    assert signing.verify(signing.public_key_pem(), b"manifest", sig)
    expected = serialization.load_pem_private_key(pem.encode(), password=None).public_key()
    assert signing.public_key_pem() == expected.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    monkeypatch.setattr(signing, "_KEY", None)


def test_self_hosted_route_can_decode(monkeypatch, tmp_path):
    """Regression: the transcriber itself must accept the self-hosted route (it used to refuse
    anything but ENVIRONMENT=local, failing every production self-test)."""
    import subprocess

    import pytest

    from app.providers.base import ProviderError

    _prod_self_hosted(monkeypatch)
    wav = tmp_path / "tone.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", str(wav)], check=True)
    adapter = registry.local_primary()
    monkeypatch.setattr("app.providers.local_whisper._model", lambda name: (_ for _ in ()).throw(RuntimeError("model-load-reached")))
    with pytest.raises(Exception) as exc:
        adapter.transcribe(str(wav), {"language_locale": "ar"})
    assert not (isinstance(exc.value, ProviderError) and "ENVIRONMENT=local" in str(exc.value))
