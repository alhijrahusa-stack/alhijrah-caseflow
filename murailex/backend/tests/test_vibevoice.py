"""Contract tests for the optional VibeVoice gateway (no GPU or network required)."""
from __future__ import annotations

import hashlib
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.api import vibevoice
from app.security import current_principal


@pytest.fixture
def client(monkeypatch):
    settings = SimpleNamespace(
        environment="production",
        vibevoice_external_processing_approved=True,
        vibevoice_asr_base_url="https://gpu.example.invalid",
        vibevoice_asr_api_key=SecretStr("private-asr"),
        vibevoice_asr_model="vibevoice",
        vibevoice_tts_ws_url="wss://voice.example.invalid/stream",
        vibevoice_tts_api_key=SecretStr("private-tts"),
    )
    monkeypatch.setattr(vibevoice, "get_settings", lambda: settings)
    app = FastAPI()
    app.include_router(vibevoice.router)
    app.dependency_overrides[current_principal] = lambda: SimpleNamespace(user=SimpleNamespace(role="transcriber"))
    with TestClient(app) as test_client:
        yield test_client


def test_container_sniffing_and_rejected_plaintext():
    assert vibevoice._audio_mime(b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 16) == "audio/wav"
    assert vibevoice._audio_mime(b"fLaC" + b"\x00" * 16) == "audio/flac"
    assert vibevoice._audio_mime(b"OggS" + b"\x00" * 16) == "audio/ogg"
    assert vibevoice._audio_mime(b"ID3" + b"\x00" * 16) == "audio/mpeg"
    assert vibevoice._audio_mime(b"\x00\x00\x00\x18ftypmp42") == "audio/mp4"
    assert vibevoice._audio_mime(b"not audio") is None


def test_fail_closed_url_validation(client):
    assert vibevoice._check_remote_url("https://gpu.example.invalid", websocket=False)
    assert vibevoice._check_remote_url("wss://gpu.example.invalid/stream", websocket=True)
    assert vibevoice._check_remote_url("http://gpu.example.invalid", websocket=False) is None
    assert vibevoice._check_remote_url("ws://gpu.example.invalid/stream", websocket=True) is None
    assert vibevoice._check_remote_url("https://username:secret@gpu.example.invalid", websocket=False) is None
    assert vibevoice._check_remote_url("https://gpu.example.invalid?token=secret", websocket=False) is None


def test_user_consent_required_before_asr_network(client, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("No upstream network call should be made without consent")

    monkeypatch.setattr(vibevoice.httpx, "AsyncClient", forbidden)
    r = client.post("/api/vibevoice/asr", files={"file": ("sample.wav", b"RIFF\x00\x00\x00\x00WAVE", "audio/wav")})
    assert r.status_code == 400
    assert "authorization" in r.json()["detail"].lower()


def test_rejects_invalid_audio_before_asr_network(client, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Invalid audio should never be sent upstream")

    monkeypatch.setattr(vibevoice.httpx, "AsyncClient", forbidden)
    r = client.post(
        "/api/vibevoice/asr",
        data={"consent": "true"},
        files={"file": ("fake.wav", b"this is not an audio container", "audio/wav")},
    )
    assert r.status_code == 415


def test_non_mutating_asr_preview_and_model_fields(client, monkeypatch):
    original = httpx.AsyncClient
    seen = {}
    output = [{"Start": 0.0, "End": 2.0, "Speaker": 1, "Content": "Hello."}]

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://gpu.example.invalid/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer private-asr"
        payload = json.loads(request.content)
        assert payload["model"] == "vibevoice"
        assert payload["temperature"] == 0.0
        assert payload["messages"][1]["content"][0]["audio_url"]["url"].startswith("data:audio/wav;base64,")
        seen["request"] = True
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(output)}}]})

    def client_factory(*args, **kwargs):
        return original(*args, transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(vibevoice.httpx, "AsyncClient", client_factory)
    raw = b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 16
    r = client.post(
        "/api/vibevoice/asr",
        data={"consent": "true", "context_info": "Hello"},
        files={"file": ("recording.wav", raw, "audio/wav")},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["segments"] == output
    assert data["source_sha256"] == hashlib.sha256(raw).hexdigest()
    assert data["recorded_to_forensic_case"] is False
    assert data["scope"] == "RESEARCH_PREVIEW_ONLY"
    assert seen["request"]


def test_status_unconfigured_discloses_no_secrets(client, monkeypatch):
    s = vibevoice.get_settings()
    s.vibevoice_external_processing_approved = False
    result = client.get("/api/vibevoice/status")
    assert result.status_code == 200
    assert result.json()["asr"]["configured"] is False
    assert result.json()["tts"]["configured"] is False
    assert "private-asr" not in result.text
    assert "private-tts" not in result.text


def test_tts_bad_identifier_rejected(client):
    r = client.post(
        "/api/vibevoice/speech",
        json={"text": "This is a sample sentence.", "voice": "../bad", "consent": True},
    )
    assert r.status_code == 422


def test_tts_consent_gate(client, monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("No WebSocket should be opened without consent")

    monkeypatch.setattr(vibevoice, "connect", forbidden)
    r = client.post("/api/vibevoice/speech", json={"text": "This is a test."})
    assert r.status_code == 400


def test_tts_streams_raw_pcm_without_logs(client, monkeypatch):
    class Socket:
        async def __aiter__(self):
            yield '{"type":"log","event":"backend_request_received"}'
            yield b"\x01\x00\x02\x00"

        async def close(self):
            return None

    seen = {}

    async def fake_connect(uri, **kwargs):
        seen["uri"] = uri
        seen["headers"] = kwargs["additional_headers"]
        return Socket()

    monkeypatch.setattr(vibevoice, "connect", fake_connect)
    r = client.post(
        "/api/vibevoice/speech",
        json={"text": "Welcome to MURAILEX.", "voice": "en-Carter_man", "consent": True},
    )
    assert r.status_code == 200
    assert r.content == b"\x01\x00\x02\x00"
    assert r.headers["x-audio-sample-rate"] == "24000"
    assert "voice=en-Carter_man" in seen["uri"]
    assert seen["headers"] == {"Authorization": "Bearer private-tts"}
