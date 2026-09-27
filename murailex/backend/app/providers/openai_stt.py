"""OpenAI gpt-transcribe for independent disputed-region verification."""
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
            {"timestamp_granularity": "region_native", "languages": ["ar"]},
        )

    def transcribe(self, audio_path: str, context: dict[str, Any]) -> Any:
        s = get_settings()
        if not s.openai_api_key or not s.openai_api_key.get_secret_value():
            raise NotConfigured(self.name)
        with open(audio_path, "rb") as fh:
            files = {"file": (os.path.basename(audio_path), fh.read(), "audio/wav")}
        data: list[tuple[str, str]] = [("model", s.openai_transcribe_model), ("languages[]", "ar")]
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
        return {
            "tokens": [],
            "text": str(raw.get("text") or "").strip(),
            "languages": raw.get("languages") or [],
            "timestamp_granularity": "region_native",
            "timestamp_source": "provider",
        }
