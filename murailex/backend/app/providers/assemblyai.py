"""AssemblyAI pre-recorded transcription (POST /v2/upload, POST /v2/transcript, GET /v2/transcript/{id}).

Model: Universal-3.5 Pro, requested with speech_models=["universal-3-5-pro"].
"""
from __future__ import annotations

from typing import Any

from ..config import get_settings
from .base import AsrAdapter, NotConfigured, Pending, ProviderError, ProviderInfo
from .http import request


class AssemblyAI(AsrAdapter):
    name = "assemblyai"
    asynchronous = True

    def _key(self) -> str:
        key = get_settings().assemblyai_api_key
        if not key or not key.get_secret_value():
            raise NotConfigured(self.name)
        return key.get_secret_value()

    def parameters(self, context: dict[str, Any] | None = None) -> dict[str, Any]:
        s = get_settings()
        params: dict[str, Any] = {
            "speech_models": [s.assemblyai_speech_model],
            "speaker_labels": True,
            "language_detection": True,
            "disfluencies": True,
        }
        expected = (context or {}).get("expected_speakers")
        if expected:
            params["speakers_expected"] = int(expected)
        return params

    def info(self) -> ProviderInfo:
        s = get_settings()
        return ProviderInfo(
            self.name,
            s.assemblyai_speech_model,
            "primary_asr",
            bool(s.assemblyai_api_key and s.assemblyai_api_key.get_secret_value()),
            self.parameters(),
        )

    def submit(self, audio_path: str, context: dict[str, Any]) -> str:
        key = self._key()
        base = get_settings().assemblyai_base_url
        with open(audio_path, "rb") as fh:
            up = request("POST", f"{base}/v2/upload", self.name, timeout=900, headers={"authorization": key}, content=fh.read())
        upload_url = up.json().get("upload_url")
        if not upload_url:
            raise ProviderError("AssemblyAI upload returned no upload_url", retryable=True)
        body = {"audio_url": upload_url, **self.parameters(context)}
        resp = request("POST", f"{base}/v2/transcript", self.name, headers={"authorization": key}, json=body)
        tid = resp.json().get("id")
        if not tid:
            raise ProviderError("AssemblyAI returned no transcript id", retryable=True)
        return str(tid)

    def fetch(self, remote_id: str) -> dict[str, Any] | Pending:
        key = self._key()
        base = get_settings().assemblyai_base_url
        data = request("GET", f"{base}/v2/transcript/{remote_id}", self.name, headers={"authorization": key}).json()
        status = data.get("status")
        if status == "completed":
            return data
        if status == "error":
            raise ProviderError(f"AssemblyAI transcription error: {data.get('error')}", retryable=False)
        return Pending(str(status))

    def normalize(self, raw: Any) -> dict[str, Any]:
        tokens = []
        for w in raw.get("words") or []:
            tokens.append(
                {
                    "text": w.get("text", ""),
                    "start_ms": int(w.get("start") or 0),
                    "end_ms": int(w.get("end") or 0),
                    "confidence": w.get("confidence"),
                    "speaker": w.get("speaker"),
                }
            )
        return {"tokens": tokens, "language": raw.get("language_code")}
