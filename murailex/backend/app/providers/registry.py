from __future__ import annotations

from ..config import get_settings
from .assemblyai import AssemblyAI
from .base import AsrAdapter, DiarizationAdapter
from .deepgram import DeepgramNova3
from .google_chirp import GoogleChirp3
from .openai_stt import OpenAITranscribe
from .pyannote import PyannoteAI

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


def primary_asr() -> list[AsrAdapter]:
    if _override is not None and fixtures_enabled():
        return _override["primary"]
    return [AssemblyAI(), GoogleChirp3()]


def diarization() -> list[DiarizationAdapter]:
    if _override is not None and fixtures_enabled():
        return _override["diarization"]
    return [PyannoteAI()]


def verification_asr() -> list[AsrAdapter]:
    if _override is not None and fixtures_enabled():
        return _override["verification"]
    return [OpenAITranscribe(), DeepgramNova3()]


def all_adapters() -> list[AsrAdapter]:
    return [*primary_asr(), *diarization(), *verification_asr()]


def by_name(name: str) -> AsrAdapter:
    for a in all_adapters():
        if a.name == name:
            return a
    raise KeyError(name)
