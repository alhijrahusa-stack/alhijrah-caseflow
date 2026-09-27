from __future__ import annotations

from ..config import get_settings
from .assemblyai import AssemblyAI
from .base import AsrAdapter, DiarizationAdapter
from .deepgram import DeepgramNova3
from .google_chirp import GoogleChirp3
from .openai_stt import OpenAITranscribe
from .pyannote import PyannoteAI

SUPPORTED_LOCALES = frozenset({"ar", "ar-YE", "ar-EG", "ar-SY", "ar-LB", "ar-IQ"})
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
    """Primary ASR engines with exact locale routing.
    
    ar (general): AssemblyAI + Deepgram ar
    ar-YE: AssemblyAI + Google ar-YE (no Deepgram ar-YE)
    ar-EG/ar-SY/ar-LB/ar-IQ: Deepgram exact-locale + Google exact-locale
    """
    if _override is not None and fixtures_enabled():
        return _override["primary"]
    locale = _locale(locale)
    if locale == "ar":
        return [AssemblyAI(), DeepgramNova3("ar")]
    if locale == "ar-YE":
        return [AssemblyAI(), GoogleChirp3("ar-YE")]
    return [DeepgramNova3(locale), GoogleChirp3(locale)]


def diarization() -> list[DiarizationAdapter]:
    """Pyannote independent speaker diarization."""
    if _override is not None and fixtures_enabled():
        return _override["diarization"]
    return [PyannoteAI()]


def verification_asr(locale: str) -> list[AsrAdapter]:
    """Verification/secondary engines for disputed regions.
    
    ar (general): OpenAI only
    ar-YE: OpenAI + Deepgram ar (no Google re-check)
    ar-EG/ar-SY/ar-LB/ar-IQ: AssemblyAI + OpenAI
    """
    if _override is not None and fixtures_enabled():
        return _override["verification"]
    locale = _locale(locale)
    if locale == "ar":
        return [OpenAITranscribe()]
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

