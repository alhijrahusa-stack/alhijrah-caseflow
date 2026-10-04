from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..forensic_models import ProviderSelfTest
from . import local_diarization, privacy
from .assemblyai import AssemblyAI
from .base import AsrAdapter, DiarizationAdapter, Pending, ProviderInfo
from .deepgram import DeepgramNova3
from .google_chirp import GoogleChirp3
from .local_diarization import LocalDiarization
from .local_whisper import LocalWhisper
from .openai_stt import OpenAITranscribe
from .pyannote import PyannoteAI

SUPPORTED_LOCALES = frozenset({"ar", "ar-YE", "ar-EG", "ar-SY", "ar-LB", "ar-IQ"})
ENGINE_STATUSES = frozenset({"READY", "NOT_CONFIGURED", "FAILED", "BLOCKED"})
_override: dict[str, list] | None = None

_CREDENTIAL_ENV: dict[str, tuple[str, ...]] = {
    "assemblyai": ("ASSEMBLYAI_API_KEY",),
    "google_chirp3": ("GOOGLE_CREDENTIALS_JSON", "GOOGLE_STT_GCS_BUCKET"),
    "deepgram": ("DEEPGRAM_API_KEY",),
    "openai": ("OPENAI_API_KEY",),
    "pyannoteai": ("PYANNOTE_API_KEY",),
}
_PRIVACY_ENV: dict[str, str] = {
    "assemblyai": "ASSEMBLYAI_LEGAL_AUDIO_APPROVED",
    "google_chirp3": "GOOGLE_LEGAL_AUDIO_APPROVED",
    "deepgram": "DEEPGRAM_LEGAL_AUDIO_APPROVED",
    "openai": "OPENAI_LEGAL_AUDIO_APPROVED",
    "pyannoteai": "PYANNOTE_LEGAL_AUDIO_APPROVED",
}


@dataclass(frozen=True)
class EngineSpec:
    internal_id: str
    provider: str
    model: str
    role: str
    locale: str
    params: dict[str, Any]
    credential: str


class _BenchmarkBlocked(AsrAdapter):
    """Adapter facade that prevents provider calls before benchmark approval."""

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


LOCAL_BENCHMARK_LABEL = "NOT BENCHMARKED — local personal-use routing (no human-ground-truth benchmark)"


def local_mode() -> bool:
    """On-device engine routing: personal local mode or the self-hosted production route."""
    s = get_settings()
    return s.environment == "local" or s.asr_route == "self_hosted"


def personal_local() -> bool:
    return get_settings().environment == "local"


def local_primary() -> LocalWhisper:
    return LocalWhisper("local_whisper", "local_asr_model", "primary_asr")


def local_verifier() -> LocalWhisper:
    return LocalWhisper("local_whisper_verify", "local_verify_model", "verification_asr")


def local_diarizer() -> LocalDiarization:
    return LocalDiarization()


def required_roles() -> frozenset[str]:
    """In local mode diarization is required once its on-device models are installed;
    without them speakers stay unattributed (never inferred)."""
    if local_mode():
        if local_diarization.installed():
            return frozenset({"primary_asr", "diarization", "verification_asr"})
        return frozenset({"primary_asr", "verification_asr"})
    return frozenset({"primary_asr", "diarization", "verification_asr"})


def fixtures_enabled() -> bool:
    settings = get_settings()
    return settings.environment == "test" and settings.test_fixture_providers


def _held_out_evidence(db: Session | None, spec: EngineSpec) -> bool:
    """Self-hosted production routes need a persisted held-out benchmark run of this provider
    whose stored engine fingerprint equals the route's current fingerprint."""
    if db is None:
        return False
    from ..forensic_models import BenchmarkRun

    settings = get_settings()
    ids = [x.strip() for x in (settings.benchmark_held_out_run_id or "").split(",") if x.strip()]
    for run_id in ids:
        try:
            row = db.get(BenchmarkRun, __import__("uuid").UUID(run_id))
        except ValueError:
            continue
        if (
            row is not None
            and row.split == "held_out"
            and row.ground_truth_status == "HUMAN VERIFIED"
            and row.dataset_version in (settings.benchmark_dataset_version or "").split(",")
            and row.provider == spec.provider
            and (row.parameters or {}).get("engine_fingerprint") == spec.params.get("engine_fingerprint")
        ):
            return True
    return False


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
    if local_mode():
        return [local_primary()]
    if locale == "ar":
        candidates: list[AsrAdapter] = [AssemblyAI(), DeepgramNova3("ar")]
    elif locale == "ar-YE":
        candidates = [AssemblyAI(), GoogleChirp3("ar-YE")]
    else:
        candidates = [DeepgramNova3(locale), GoogleChirp3(locale)]
    return _gate(candidates)


def diarization() -> list[DiarizationAdapter]:
    if _override is not None and fixtures_enabled():
        return _override["diarization"]
    if local_mode():
        return [local_diarizer()] if local_diarization.installed() else []
    gated = _gate([PyannoteAI()])
    return cast(list[DiarizationAdapter], gated)


def verification_asr(locale: str) -> list[AsrAdapter]:
    if _override is not None and fixtures_enabled():
        return _override["verification"]
    locale = _locale(locale)
    if local_mode():
        return [local_verifier()]
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
        local_primary(),
        local_verifier(),
        local_diarizer(),
    ]


def by_name(name: str) -> AsrAdapter | DiarizationAdapter:
    for adapter in all_adapters():
        if adapter.name == name:
            return adapter
    raise KeyError(name)


def routed_adapters(locale: str) -> list[tuple[AsrAdapter | DiarizationAdapter, str]]:
    locale = _locale(locale)
    return (
        [(adapter, "primary_asr") for adapter in primary_asr(locale)]
        + [(adapter, "diarization") for adapter in diarization()]
        + [(adapter, "verification_asr") for adapter in verification_asr(locale)]
    )


def _raw_credential(provider: str) -> str | None:
    settings = get_settings()
    secret = None
    if provider == "assemblyai":
        secret = settings.assemblyai_api_key
    elif provider == "google_chirp3":
        secret = settings.google_credentials_json
    elif provider == "deepgram":
        secret = settings.deepgram_api_key
    elif provider == "openai":
        secret = settings.openai_api_key
    elif provider == "pyannoteai":
        secret = settings.pyannote_api_key
    if secret is None:
        return None
    value = secret.get_secret_value()
    return value or None


def credential_fingerprint(provider: str) -> str | None:
    value = _raw_credential(provider)
    if value is None:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def missing_credential_environment(provider: str) -> list[str]:
    settings = get_settings()
    missing: list[str] = []
    if _raw_credential(provider) is None:
        primary = _CREDENTIAL_ENV.get(provider, ())
        if primary:
            missing.append(primary[0])
    if provider == "google_chirp3" and not settings.google_stt_gcs_bucket:
        missing.append("GOOGLE_STT_GCS_BUCKET")
    return missing


def engine_spec(adapter: AsrAdapter | DiarizationAdapter, role: str, locale: str) -> EngineSpec:
    locale = _locale(locale)
    context = {"language_locale": locale, "expected_terms": None, "expected_speakers": None}
    info = adapter.info(context)
    credential_vars = _CREDENTIAL_ENV.get(adapter.name, ())
    return EngineSpec(
        internal_id=f"{role}:{adapter.name}:{info.model}:{locale}",
        provider=adapter.name,
        model=info.model,
        role=role,
        locale=locale,
        params=dict(info.parameters),
        credential=credential_vars[0] if credential_vars else "",
    )


def engine_definitions(locale: str) -> list[dict[str, Any]]:
    return [asdict(engine_spec(adapter, role, locale)) for adapter, role in routed_adapters(locale)]


def _latest_self_test(db: Session | None, spec: EngineSpec) -> ProviderSelfTest | None:
    if db is None:
        return None
    return db.execute(
        select(ProviderSelfTest)
        .where(
            ProviderSelfTest.provider == spec.provider,
            ProviderSelfTest.model == spec.model,
            ProviderSelfTest.locale == spec.locale,
            ProviderSelfTest.role == spec.role,
        )
        .order_by(ProviderSelfTest.started_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def engine_state(
    db: Session | None,
    adapter: AsrAdapter | DiarizationAdapter,
    role: str,
    locale: str,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    spec = engine_spec(adapter, role, locale)
    info = adapter.info(context or {"language_locale": locale, "expected_terms": None, "expected_speakers": None})
    required: list[str] = []
    blocker: str | None = None
    status = "BLOCKED"

    missing = missing_credential_environment(spec.provider)
    if missing:
        status = "NOT_CONFIGURED"
        blocker = "Required provider credential or provider storage configuration is not configured."
        required.extend(missing)
    elif privacy.status(spec.provider) != "APPROVED":
        status = "BLOCKED"
        blocker = "Provider legal-audio data policy is not approved."
        privacy_var = _PRIVACY_ENV.get(spec.provider)
        if privacy_var:
            required.append(privacy_var)
    elif get_settings().environment not in ("test", "local") and not benchmark_routing_approved():
        status = "BLOCKED"
        blocker = "Human-ground-truth benchmark routing is not approved."
        required.extend(["BENCHMARK_ROUTING_APPROVED", "BENCHMARK_DATASET_VERSION", "BENCHMARK_HELD_OUT_RUN_ID"])
    elif get_settings().environment not in ("test", "local") and local_mode() and not _held_out_evidence(db, spec):
        status = "BLOCKED"
        blocker = "No persisted held-out human-ground-truth benchmark run for this exact engine fingerprint."
    elif not info.configured:
        status = "NOT_CONFIGURED"
        blocker = "Provider adapter is not configured for the exact engine route."
    else:
        latest = _latest_self_test(db, spec)
        if latest is None:
            status = "BLOCKED"
            blocker = "A real provider self-test has not passed for this exact engine route."
        elif latest.status == "READY":
            meta = latest.response_metadata or {}
            fingerprint = credential_fingerprint(spec.provider)
            tested_engine = (meta.get("parameters") or {}).get("engine_fingerprint")
            if (
                latest.provider_run_id
                and latest.completed_at
                and meta.get("actual_persisted_model") == spec.model
                and meta.get("credential_fingerprint") == fingerprint
                and tested_engine == spec.params.get("engine_fingerprint")
            ):
                status = "READY"
            elif tested_engine != spec.params.get("engine_fingerprint"):
                status = "BLOCKED"
                blocker = "Engine version, model revision or decode configuration changed since the last real self-test."
            else:
                status = "FAILED"
                blocker = "Persisted READY evidence does not match the exact model or current credential."
        elif latest.status in ENGINE_STATUSES:
            status = latest.status
            blocker = latest.error or f"Latest real provider self-test status is {latest.status}."
        else:
            status = "FAILED"
            blocker = f"Invalid persisted provider self-test status: {latest.status}."

    latest = _latest_self_test(db, spec)
    last_test = None
    if latest is not None:
        last_test = {
            "id": str(latest.id),
            "status": latest.status,
            "completed_at": latest.completed_at.isoformat() if latest.completed_at else None,
            "provider_run_id": str(latest.provider_run_id) if latest.provider_run_id else None,
        }
    return {
        **asdict(spec),
        "benchmark": LOCAL_BENCHMARK_LABEL if personal_local() else ("APPROVED" if benchmark_routing_approved() else "NOT APPROVED"),
        "name": spec.provider,
        "status": status,
        "blocker": blocker,
        "required_environment_variables": sorted(set(required)),
        "last_real_self_test": last_test,
    }


def engine_states(db: Session | None, locale: str) -> list[dict[str, Any]]:
    locale = _locale(locale)
    return [engine_state(db, adapter, role, locale) for adapter, role in routed_adapters(locale)]


def registry_states(db: Session | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for locale in sorted(SUPPORTED_LOCALES):
        rows.extend(engine_states(db, locale))
    return rows
