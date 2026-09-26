"""OpenAI transcription for targeted verification (POST /v1/audio/transcriptions, diarized_json)."""
from __future__ import annotations

import os
from typing import Any

from ..config import get_settings
from .base import AsrAdapter, NotConfigured, ProviderInfo
from .http import request


class OpenAITranscribe(AsrAdapter):
    name = "openai"

    def info(self) -> ProviderInfo:
        s = get_settings()
        return ProviderInfo(
            self.name,
            s.openai_transcribe_model,
            "verification_asr",
            bool(s.openai_api_key and s.openai_api_key.get_secret_value()),
            {"response_format": "diarized_json", "chunking_strategy": "auto"},
        )

    def transcribe(self, audio_path: str, context: dict[str, Any]) -> Any:
        s = get_settings()
        if not s.openai_api_key or not s.openai_api_key.get_secret_value():
            raise NotConfigured(self.name)
        with open(audio_path, "rb") as fh:
            files = {"file": (os.path.basename(audio_path), fh.read(), "audio/wav")}
        data = {"model": s.openai_transcribe_model, "response_format": "diarized_json", "chunking_strategy": "auto"}
        resp = request(
            "POST",
            f"{s.openai_base_url}/audio/transcriptions",
            self.name,
            timeout=600,
            headers={"Authorization": f"Bearer {s.openai_api_key.get_secret_value()}"},
            data=data,
            files=files,
        )
        return resp.json()

    def normalize(self, raw: Any) -> dict[str, Any]:
        # Segment-level timestamps only; token times inside a segment are interpolated and flagged.
        tokens = []
        for seg in raw.get("segments") or []:
            words = (seg.get("text") or "").split()
            if not words:
                continue
            start = int(round(float(seg.get("start", 0)) * 1000))
            end = int(round(float(seg.get("end", 0)) * 1000))
            step = max(1, (end - start) // len(words))
            for i, w in enumerate(words):
                tokens.append(
                    {
                        "text": w,
                        "start_ms": start + i * step,
                        "end_ms": end if i == len(words) - 1 else start + (i + 1) * step,
                        "confidence": None,
                        "speaker": seg.get("speaker"),
                        "timing": "interpolated_within_segment",
                    }
                )
        return {"tokens": tokens}
