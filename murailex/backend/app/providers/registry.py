from __future__ import annotations

from typing import Any, cast

from ..config import get_settings
from .assemblyai import AssemblyAI
from .base import AsrAdapter, DiarizationAdapter, Pending, ProviderInfo
from .deepgram import DeepgramNova3
from .google_chirp import GoogleChirp3
from .openai_stt import OpenAITranscribe
from .pyannote import PyannoteAI

SUPPORTED_LOCALES = frozenset({"ar", "ar-YE", "ar-EG", "ar-SY", "ar-LB", "ar-IQ"})
_override: dict[str, list] | None = None


class _BenchmarkBlocked(AsrAdapter):
    """Adapter facade that prevents any provider call before benchmark approval."""

    def __init__(self, inner: AsrAdapter):
        self.inner = inner
        self.name = inner.name
        self.asynchronous = inner.asynchronous

    def info(self, context: dict[str, Any] | None = None) -> ProviderInfo:
        info = self.inner.info(context)
        return ProviderInfo(
            name=info.name,
            model=info.model,
            role=info.role,
            configured=False,
            parameters={
                **info.parameters,
                "benchmark_gate": "BLOCKED — no approved human-ground-truth benchmark routing",
            },
        )

    def submit(self, audio_path: str, context: dict[str, Any]) -> str:
        raise RuntimeError("Benchmark gate blocked provider execution before submission.")

    def fetch(self, remote_id: str) -> dict[str, Any] | Pending:
        raise RuntimeError("Benchmark gate blocked provider execution before polling.")

    def transcribe(self, audio_path: str, context: dict[str, Any]) -> Any:
        raise RuntimeError("Benchmark gate blocked provider execution before transcription.")

    def normalize(self, raw: Any) -> dict[str, Any]:
        raise RuntimeError("Benchmark gate blocked provider execution before normalization.")


def fixtures_enabled() -> bool:
    settings = get_settings()
    return settings.environment == "test" and settings.test_fixture_providers


def benchmark_routing_approved() -> bool:
    settings = get_settings()
    return bool(
        settings.benchmark_routing_approved
        and settings.benchmark_dataset_version
        and settings.benchmark_held_out_run_id
    )


def _gate(adapters: list[AsrAdapter]) -> list[AsrAdapter]:
    settings = get_settings()
    if settings.environment == "test" or benchmark_routing_approved():
        return adapters
    return [_BenchmarkBlocked(adapter) for adapter in adapters]


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
    """Return candidate primaries only after the benchmark gate authorizes production routing."""
    if _override is not None and fixtures_enabled():
        return _override["primary"]
    locale = _locale(locale)
    if locale == "ar":
        candidates: list[AsrAdapter] = [AssemblyAI(), DeepgramNova3("ar")]
    elif locale == "ar-YE":
        candidates = [AssemblyAI(), GoogleChirp3("ar-YE")]
    else:
        candidates = [DeepgramNova3(locale), GoogleChirp3(locale)]
    return _gate(candidates)


def diarization() -> list[DiarizationAdapter]:
    """Return independent diarization only after the benchmark gate authorizes routing."""
    if _override is not None and fixtures_enabled():
        return _override["diarization"]
    gated = _gate([PyannoteAI()])
    return cast(list[DiarizationAdapter], gated)


def verification_asr(locale: str) -> list[AsrAdapter]:
    """Return independent verification candidates only after benchmark routing approval."""
    if _override is not None and fixtures_enabled():
        return _override["verification"]
    locale = _locale(locale)
    if locale == "ar":
        candidates: list[AsrAdapter] = [OpenAITranscribe()]
    elif locale == "ar-YE":
        candidates = [OpenAITranscribe(), DeepgramNova3("ar")]
    else:
        candidates = [AssemblyAI(), OpenAITranscribe()]
    return _gate(candidates)


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
