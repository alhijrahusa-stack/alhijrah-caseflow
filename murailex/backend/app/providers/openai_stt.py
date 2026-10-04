"""OpenAI gpt-transcribe for independent disputed-region verification."""
from __future__ import annotations

import os
from typing import Any

from ..config import get_settings
from . import privacy
from .base import AsrAdapter, DataPolicyBlocked, NotConfigured, ProviderInfo
from .http import request


class OpenAITranscribe(AsrAdapter):
    name = "openai"

    def info(self, context: dict[str, Any] | None = None) -> ProviderInfo:
        s = get_settings()
        has_key = bool(s.openai_api_key and s.openai_api_key.get_secret_value())
        return ProviderInfo(
            self.name,
            s.openai_transcribe_model,
            "verification_asr",
            has_key and privacy.approved(self.name),
            {
                "timestamp_granularity": "region_native",
                "languages": ["ar"],
                "privacy_gate": privacy.status(self.name),
            },
        )

    def transcribe(self, audio_path: str, context: dict[str, Any]) -> Any:
        s = get_settings()
        if not s.openai_api_key or not s.openai_api_key.get_secret_value():
            raise NotConfigured(self.name)
        if not privacy.approved(self.name):
            raise DataPolicyBlocked(self.name)
        with open(audio_path, "rb") as fh:
            files = {"file": (os.path.basename(audio_path), fh.read(), "audio/wav")}
        expected_terms = [
            str(term).strip()
            for term in (context.get("expected_terms") or [])
            if str(term).strip()
        ]
        data: list[tuple[str, str]] = [("model", s.openai_transcribe_model), ("languages[]", "ar")]
        data.extend(("keywords[]", term) for term in expected_terms)
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
