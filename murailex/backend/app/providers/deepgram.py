"""Deepgram Nova-3 (Arabic) for primary or targeted verification transcription."""
from __future__ import annotations

from typing import Any

from ..config import get_settings
from .base import AsrAdapter, NotConfigured, ProviderInfo
from .http import request


class DeepgramNova3(AsrAdapter):
    name = "deepgram"

    def __init__(self, language: str):
        if language == "ar-YE":
            raise ValueError("Deepgram Nova-3 must not be configured with ar-YE; use ar for Yemeni verification.")
        self.language = language

    def query(self) -> dict[str, str]:
        s = get_settings()
        return {
            "model": s.deepgram_model,
            "language": self.language,
            "punctuate": "false",
            "smart_format": "false",
            "numerals": "false",
            "filler_words": "true",
            # Do not permit legal-audio content to participate in Deepgram's Model Improvement Program.
            "mip_opt_out": "true",
        }

    def info(self, context: dict[str, Any] | None = None) -> ProviderInfo:
        s = get_settings()
        return ProviderInfo(
            self.name,
            f"{s.deepgram_model}:{self.language}",
            "asr",
            bool(s.deepgram_api_key and s.deepgram_api_key.get_secret_value()),
            self.query(),
        )

    def transcribe(self, audio_path: str, context: dict[str, Any]) -> Any:
        s = get_settings()
        if not s.deepgram_api_key or not s.deepgram_api_key.get_secret_value():
            raise NotConfigured(self.name)
        with open(audio_path, "rb") as fh:
            body = fh.read()
        resp = request(
            "POST",
            f"{s.deepgram_base_url}/listen",
            self.name,
            timeout=600,
            params=self.query(),
            headers={"Authorization": f"Token {s.deepgram_api_key.get_secret_value()}", "Content-Type": "audio/wav"},
            content=body,
        )
        return resp.json()

    def normalize(self, raw: Any) -> dict[str, Any]:
        tokens = []
        channels = (raw.get("results") or {}).get("channels") or []
        if channels and channels[0].get("alternatives"):
            for w in channels[0]["alternatives"][0].get("words") or []:
                tokens.append(
                    {
                        "text": w.get("word", ""),
                        "start_ms": int(round(float(w.get("start", 0)) * 1000)),
                        "end_ms": int(round(float(w.get("end", 0)) * 1000)),
                        "confidence": w.get("confidence"),
                        "speaker": None if w.get("speaker") is None else str(w.get("speaker")),
                    }
                )
        metadata = raw.get("metadata") or {}
        return {
            "tokens": tokens,
            "request_id": metadata.get("request_id"),
            "model_info": metadata.get("model_info"),
        }
