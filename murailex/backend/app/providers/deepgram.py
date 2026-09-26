"""Deepgram Nova-3 (Arabic) for targeted verification (POST /v1/listen)."""
from __future__ import annotations

from typing import Any

from ..config import get_settings
from .base import AsrAdapter, NotConfigured, ProviderInfo
from .http import request


class DeepgramNova3(AsrAdapter):
    name = "deepgram"

    def query(self) -> dict[str, str]:
        s = get_settings()
        return {
            "model": s.deepgram_model,
            "language": s.deepgram_language,
            "diarize_model": "latest",
            "punctuate": "false",
            "smart_format": "false",
            "numerals": "false",
            "filler_words": "true",
        }

    def info(self) -> ProviderInfo:
        s = get_settings()
        return ProviderInfo(
            self.name, f"{s.deepgram_model}:{s.deepgram_language}", "verification_asr",
            bool(s.deepgram_api_key and s.deepgram_api_key.get_secret_value()), self.query(),
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
        return {"tokens": tokens}
