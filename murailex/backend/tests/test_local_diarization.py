"""On-device diarization route. Real-model checks run when MURAILEX_TEST_DIAR_DIR points at
the installed models (local/run-local.sh installs them)."""
from __future__ import annotations

import os
import subprocess

import pytest

from app.config import get_settings
from app.providers import local_diarization, privacy, registry
from app.providers.local_diarization import LocalDiarization

DIAR_DIR = os.environ.get("MURAILEX_TEST_DIAR_DIR", "")
CANARY = os.path.join(os.path.dirname(__file__), "..", "..", "local", "canary", "engine-canary-ar.mp3")
needs_models = pytest.mark.skipif(not (DIAR_DIR and os.path.isdir(DIAR_DIR)), reason="MURAILEX_TEST_DIAR_DIR not set")


def test_route_absent_without_models(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "environment", "local")
    monkeypatch.setattr(s, "local_diar_dir", "")
    assert registry.diarization() == []
    assert "diarization" not in registry.required_roles()


def test_normalize_drops_empty_turns():
    norm = LocalDiarization().normalize({"turns": [{"speaker": "SPEAKER_01", "start": 0, "end": 900}, {"speaker": "SPEAKER_02", "start": 5, "end": 5}]})
    assert norm == {"turns": [{"speaker": "SPEAKER_01", "start_ms": 0, "end_ms": 900, "confidence": None}]}


@needs_models
def test_installed_route_is_required_fingerprinted_and_on_device(monkeypatch, tmp_path):
    s = get_settings()
    monkeypatch.setattr(s, "environment", "local")
    monkeypatch.setattr(s, "local_diar_dir", DIAR_DIR)
    assert [d.name for d in registry.diarization()] == ["local_diarization"]
    assert "diarization" in registry.required_roles()
    assert privacy.approved("local_diarization")
    info = LocalDiarization().info()
    assert info.configured and len(info.parameters["engine_fingerprint"]) == 64
    before = info.parameters["engine_fingerprint"]
    monkeypatch.setattr(s, "local_diar_threshold", 0.6)
    assert LocalDiarization().engine_fingerprint() != before  # config change => new route identity

    wav = tmp_path / "canary.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", CANARY, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], check=True)
    monkeypatch.setattr(s, "local_diar_threshold", 0.5)
    raw = LocalDiarization().transcribe(str(wav), {"expected_speakers": None})
    turns = LocalDiarization().normalize(raw)["turns"]
    assert turns and all(t["speaker"].startswith("SPEAKER_") for t in turns)
    assert raw["audio_seconds"] > 40 and raw["inference_seconds"] > 0
    assert local_diarization.installed()
