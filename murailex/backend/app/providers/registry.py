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
    settings = get_settings()
    return settings.environment == "test" and settings.test_fixture_providers


def install_test_fixtures(
    primary: list[AsrAdapter],
    diarization: list[DiarizationAdapter],
    verification: list[AsrAdapter],
) -> None:
    global _override
    if not fixtures_enabled():
        raise RuntimeError("Fixture providers are available only in the automated test environment.")
    _override = {
        "primary": primary,
        "diarization": diarization,
        "verification": verification,
    }


def clear_test_fixtures() -> None:
    global _override
    _override = None


def _locale(locale: str) -> str:
    if locale not in SUPPORTED_LOCALES:
        raise ValueError(f"Unsupported recording locale: {locale!r}")
    return locale


def primary_asr(locale: str) -> list[AsrAdapter]:
    """Return the two Primary engines for the exact user-selected locale."""
    if _override is not None and fixtures_enabled():
        return _override["primary"]
    locale = _locale(locale)
    if locale == "ar":
        return [AssemblyAI(), DeepgramNova3("ar")]
    if locale == "ar-YE":
        return [AssemblyAI(), GoogleChirp3("ar-YE")]
    return [DeepgramNova3(locale), GoogleChirp3(locale)]


def diarization() -> list[DiarizationAdapter]:
    """Return independent speaker diarization."""
    if _override is not None and fixtures_enabled():
        return _override["diarization"]
    return [PyannoteAI()]


def verification_asr(locale: str) -> list[AsrAdapter]:
    """Return independent verification engines for disputed/critical regions."""
    if _override is not None and fixtures_enabled():
        return _override["verification"]
    locale = _locale(locale)
    if locale == "ar":
        return [OpenAITranscribe()]
    if locale == "ar-YE":
        return [OpenAITranscribe(), DeepgramNova3("ar")]
    return [AssemblyAI(), OpenAITranscribe()]


def all_adapters() -> list[AsrAdapter | DiarizationAdapter]:
    return [
        AssemblyAI(),
        GoogleChirp3("ar-YE"),
        DeepgramNova3("ar"),
        OpenAITranscribe(),
        PyannoteAI(),
    ]


def by_name(name: str) -> AsrAdapter | DiarizationAdapter:
    for adapter in all_adapters():
        if adapter.name == name:
            return adapter
    raise KeyError(name)
