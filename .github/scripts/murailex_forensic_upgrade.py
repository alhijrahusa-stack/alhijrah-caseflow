from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def p(rel: str) -> Path:
    return ROOT / rel


def replace_once(rel: str, old: str, new: str) -> None:
    path = p(rel)
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f"expected block missing: {rel}")
    path.write_text(text.replace(old, new, 1))


replace_once(
    "murailex/backend/app/config.py",
    '    pyannote_model: str = "precision-2"\n',
    '    pyannote_model: str = "precision-3"\n',
)
replace_once(
    "murailex/backend/app/config.py",
    '    openai_transcribe_model: str = "gpt-4o-transcribe-diarize"\n',
    '    openai_transcribe_model: str = "gpt-transcribe"\n',
)

replace_once(
    "murailex/backend/app/providers/google_chirp.py",
    '''class GoogleChirp3(AsrAdapter):
    name = "google_chirp3"
    asynchronous = True

    def parameters(self) -> dict[str, Any]:
        s = get_settings()
        return {
            "model": s.google_stt_model,
            "languageCodes": s.language_codes(),
            "location": s.google_stt_location,
            "features": {"enableWordTimeOffsets": True, "enableWordConfidence": True, "diarizationConfig": {}},
        }
''',
    '''class GoogleChirp3(AsrAdapter):
    name = "google_chirp3"
    asynchronous = True

    def __init__(self, language_code: str):
        self.language_code = language_code

    def parameters(self) -> dict[str, Any]:
        s = get_settings()
        return {
            "model": s.google_stt_model,
            "languageCodes": [self.language_code],
            "location": s.google_stt_location,
            "features": {"enableWordTimeOffsets": True},
        }
''',
)
replace_once(
    "murailex/backend/app/providers/google_chirp.py",
    '''                            "confidence": w.get("confidence"),
                            "speaker": w.get("speakerLabel") or None,
''',
    '''                            "confidence": None,
                            "provider_confidence_raw": w.get("confidence"),
                            "confidence_semantics": "not_reliable_for_chirp3",
                            "speaker": None,
''',
)

replace_once(
    "murailex/backend/app/providers/deepgram.py",
    '''class DeepgramNova3(AsrAdapter):
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
''',
    '''class DeepgramNova3(AsrAdapter):
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
        }
''',
)
replace_once(
    "murailex/backend/app/providers/deepgram.py",
    '            self.name, f"{s.deepgram_model}:{s.deepgram_language}", "verification_asr",\n',
    '            self.name, f"{s.deepgram_model}:{self.language}", "asr",\n',
)

p("murailex/backend/app/providers/openai_stt.py").write_text('''"""OpenAI gpt-transcribe for independent disputed-region verification."""
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
''')

replace_once(
    "murailex/backend/app/providers/pyannote.py",
    '''                    "confidence": seg.get("confidence"),
''',
    '''                    "turn_level_confidence": seg.get("turnLevelConfidence"),
                    "speaker_probability": seg.get("speakerProbability"),
                    "speech_probability": seg.get("speechProbability"),
                    "crosstalk_probability": seg.get("crosstalkProbability"),
''',
)

p("murailex/backend/app/providers/registry.py").write_text('''from __future__ import annotations

from ..config import get_settings
from .assemblyai import AssemblyAI
from .base import AsrAdapter, DiarizationAdapter
from .deepgram import DeepgramNova3
from .google_chirp import GoogleChirp3
from .openai_stt import OpenAITranscribe
from .pyannote import PyannoteAI

SUPPORTED_LOCALES = frozenset({"ar-YE", "ar-EG", "ar-SY", "ar-LB", "ar-IQ"})
_override: dict[str, list] | None = None


def fixtures_enabled() -> bool:
    s = get_settings()
    return s.environment == "test" and s.test_fixture_providers


def install_test_fixtures(primary: list[AsrAdapter], diarization: list[DiarizationAdapter], verification: list[AsrAdapter]) -> None:
    global _override
    if not fixtures_enabled():
        raise RuntimeError("Fixture providers are available only in the automated test environment.")
    _override = {"primary": primary, "diarization": diarization, "verification": verification}


def clear_test_fixtures() -> None:
    global _override
    _override = None


def _locale(locale: str) -> str:
    if locale not in SUPPORTED_LOCALES:
        raise ValueError(f"Unsupported recording locale: {locale!r}")
    return locale


def primary_asr(locale: str) -> list[AsrAdapter]:
    if _override is not None and fixtures_enabled():
        return _override["primary"]
    locale = _locale(locale)
    if locale == "ar-YE":
        return [AssemblyAI(), GoogleChirp3("ar-YE")]
    return [DeepgramNova3(locale), GoogleChirp3(locale)]


def diarization() -> list[DiarizationAdapter]:
    if _override is not None and fixtures_enabled():
        return _override["diarization"]
    return [PyannoteAI()]


def verification_asr(locale: str) -> list[AsrAdapter]:
    if _override is not None and fixtures_enabled():
        return _override["verification"]
    locale = _locale(locale)
    if locale == "ar-YE":
        return [OpenAITranscribe(), DeepgramNova3("ar")]
    return [AssemblyAI(), OpenAITranscribe()]


def all_adapters() -> list[AsrAdapter]:
    return [AssemblyAI(), GoogleChirp3("ar-YE"), DeepgramNova3("ar"), OpenAITranscribe(), PyannoteAI()]


def by_name(name: str) -> AsrAdapter:
    for a in all_adapters():
        if a.name == name:
            return a
    raise KeyError(name)
''')

print("provider upgrade applied")
