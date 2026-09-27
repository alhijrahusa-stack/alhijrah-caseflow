"""pyannoteAI diarization (POST /v1/media/input, PUT presigned, POST /v1/diarize, GET /v1/jobs/{id})."""
from __future__ import annotations

from typing import Any

from ..config import get_settings
from .base import (
    DiarizationAdapter,
    NotConfigured,
    Pending,
    ProviderError,
    ProviderInfo,
)
from .http import request


class PyannoteAI(DiarizationAdapter):
    name = "pyannoteai"
    asynchronous = True

    def _headers(self) -> dict[str, str]:
        key = get_settings().pyannote_api_key
        if not key or not key.get_secret_value():
            raise NotConfigured(self.name)
        return {"Authorization": f"Bearer {key.get_secret_value()}"}

    def parameters(self, context: dict[str, Any] | None = None) -> dict[str, Any]:
        p: dict[str, Any] = {"model": get_settings().pyannote_model}
        if context and context.get("expected_speakers"):
            p["numSpeakers"] = int(context["expected_speakers"])
        return p

    def info(self) -> ProviderInfo:
        s = get_settings()
        return ProviderInfo(
            self.name, s.pyannote_model, "diarization", bool(s.pyannote_api_key and s.pyannote_api_key.get_secret_value()), self.parameters()
        )

    def submit(self, audio_path: str, context: dict[str, Any]) -> str:
        headers = self._headers()
        base = get_settings().pyannote_base_url
        media = f"media://murailex/{context['recording_id']}/{context['derived_sha256'][:16]}.wav"
        presigned = request("POST", f"{base}/media/input", self.name, headers=headers, json={"url": media}).json().get("url")
        if not presigned:
            raise ProviderError("pyannoteAI returned no presigned URL", retryable=True)
        with open(audio_path, "rb") as fh:
            request("PUT", presigned, self.name, timeout=900, content=fh.read())
        body = {"url": media, **self.parameters(context)}
        job = request("POST", f"{base}/diarize", self.name, headers=headers, json=body).json()
        if not job.get("jobId"):
            raise ProviderError("pyannoteAI returned no jobId", retryable=True)
        return str(job["jobId"])

    def fetch(self, remote_id: str) -> dict[str, Any] | Pending:
        base = get_settings().pyannote_base_url
        job = request("GET", f"{base}/jobs/{remote_id}", self.name, headers=self._headers()).json()
        status = job.get("status")
        if status == "succeeded":
            return job
        if status in ("failed", "canceled"):
            raise ProviderError(f"pyannoteAI job {status}: {(job.get('output') or {}).get('error')}", retryable=False)
        return Pending(str(status))

    def normalize(self, raw: Any) -> dict[str, Any]:
        turns = []
        for seg in (raw.get("output") or {}).get("diarization") or []:
            turns.append(
                {
                    "speaker": str(seg.get("speaker")),
                    "start_ms": int(round(float(seg.get("start", 0)) * 1000)),
                    "end_ms": int(round(float(seg.get("end", 0)) * 1000)),
                    "turn_level_confidence": seg.get("turnLevelConfidence"),
                    "speaker_probability": seg.get("speakerProbability"),
                    "speech_probability": seg.get("speechProbability"),
                    "crosstalk_probability": seg.get("crosstalkProbability"),
                }
            )
        turns.sort(key=lambda t: (t["start_ms"], t["end_ms"]))
        return {"turns": turns}
