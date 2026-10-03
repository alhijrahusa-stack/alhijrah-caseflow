"""Provider privacy registry and fail-closed legal-audio dispatch gate.

Public documentation is not sufficient to prove the configuration of a specific customer
account/project. Therefore cloud providers remain blocked for legal audio until an explicit
server-side approval flag is set after the account/project controls have been verified.
"""
from __future__ import annotations

from typing import Any

from ..config import get_settings

VERIFIED_AT = "2026-09-27"

PRIVACY_REGISTRY: dict[str, dict[str, Any]] = {
    "assemblyai": {
        "provider": "AssemblyAI",
        "retention_policy": "Async retention depends on customer TTL/BAA/account configuration; uploaded audio deletion normally begins within the documented production retention window.",
        "training_policy": "Files may be used for model training when permitted by contract unless the customer is opted out or otherwise excluded by documented account conditions.",
        "deletion_policy": "Customer deletion and configurable TTL are documented; account configuration must be verified before legal-audio use.",
        "encryption_in_transit": "TLS 1.2+ documented",
        "encryption_at_rest": "AES-128/AES-256 documented",
        "authentication": "API key",
        "logging_exposure": "Certain metadata retained for logging/billing; account controls must be verified.",
        "subprocessor_implications": "DPA/subprocessors are contract-dependent; operator review required.",
        "verified_source": [
            "https://www.assemblyai.com/docs/data-retention-and-model-training",
            "https://www.assemblyai.com/security",
        ],
        "verified_at": VERIFIED_AT,
        "approval_setting": "ASSEMBLYAI_LEGAL_AUDIO_APPROVED",
    },
    "google_chirp3": {
        "provider": "Google Cloud Speech-to-Text",
        "retention_policy": "Cloud Speech-to-Text does not log customer audio/transcripts by default; projects can explicitly opt into data logging.",
        "training_policy": "Customer audio/transcripts are used for service improvement only when the project opts into the documented data logging program.",
        "deletion_policy": "If data logging is enabled, logged training data has separate retention/deletion terms; MURAILEX requires project-level verification that legal-audio routing is acceptable.",
        "encryption_in_transit": "Google Cloud transport encryption applies; project/network controls remain account-specific.",
        "encryption_at_rest": "Google Cloud storage/security controls are account/project-specific.",
        "authentication": "Google service account OAuth2",
        "logging_exposure": "Project data-logging configuration is decisive and cannot be inferred from possession of credentials.",
        "subprocessor_implications": "Google Cloud contractual/subprocessor terms require account review.",
        "verified_source": [
            "https://docs.cloud.google.com/speech-to-text/docs/v1/data-logging",
        ],
        "verified_at": VERIFIED_AT,
        "approval_setting": "GOOGLE_LEGAL_AUDIO_APPROVED",
    },
    "deepgram": {
        "provider": "Deepgram",
        "retention_policy": "With mip_opt_out=true, Deepgram documents zero content retention after the response; request metadata and usage logs remain.",
        "training_policy": "mip_opt_out=true opts the request out of the Model Improvement Program.",
        "deletion_policy": "No audio/text/transcript content retained after response when request opt-out is applied, subject to documented metadata/usage logging.",
        "encryption_in_transit": "Documented encrypted transport",
        "encryption_at_rest": "Provider documentation describes encryption controls; legal account review still required.",
        "authentication": "API token",
        "logging_exposure": "Request metadata and usage logs remain after content opt-out.",
        "subprocessor_implications": "Contract/subprocessor review remains account-specific.",
        "verified_source": [
            "https://developers.deepgram.com/trust-security/your-data",
        ],
        "verified_at": VERIFIED_AT,
        "approval_setting": "DEEPGRAM_LEGAL_AUDIO_APPROVED",
        "required_request_control": "mip_opt_out=true",
    },
    "openai": {
        "provider": "OpenAI API",
        "retention_policy": "API retention depends on endpoint and organization data controls; eligible organizations can use Zero Data Retention.",
        "training_policy": "API inputs/outputs are not used for model training by default unless the organization explicitly opts in.",
        "deletion_policy": "Default abuse-monitoring retention can apply; ZDR is an organization/project capability and must be verified for the actual account if required by policy.",
        "encryption_in_transit": "TLS documented for business data",
        "encryption_at_rest": "AES-256 documented for business data",
        "authentication": "API key",
        "logging_exposure": "Retention/data-control status is organization/project-specific and must not be inferred from API-key validity.",
        "subprocessor_implications": "Business/API contractual terms and subprocessors require account review.",
        "verified_source": [
            "https://developers.openai.com/api/docs/guides/your-data",
            "https://openai.com/business-data/",
        ],
        "verified_at": VERIFIED_AT,
        "approval_setting": "OPENAI_LEGAL_AUDIO_APPROVED",
    },
    "pyannoteai": {
        "provider": "pyannoteAI",
        "retention_policy": "Public privacy/terms material confirms processing of audio data, but this registry does not have a sufficiently specific cloud-API retention guarantee for the active account.",
        "training_policy": "UNVERIFIED for the active cloud account/path",
        "deletion_policy": "UNVERIFIED for the active cloud account/path",
        "encryption_in_transit": "UNVERIFIED for the active cloud account/path",
        "encryption_at_rest": "UNVERIFIED for the active cloud account/path",
        "authentication": "Bearer API key",
        "logging_exposure": "UNVERIFIED for the active cloud account/path",
        "subprocessor_implications": "DPA/terms require account review.",
        "verified_source": [
            "https://www.pyannote.ai/privacy-policy",
            "https://www.pyannote.ai/terms-of-use",
        ],
        "verified_at": VERIFIED_AT,
        "approval_setting": "PYANNOTE_LEGAL_AUDIO_APPROVED",
    },
    "local_whisper": {
        "provider": "On-device Whisper (faster-whisper)",
        "retention_policy": "Audio and transcripts stay on this machine; no third-party transfer.",
        "training_policy": "No data leaves the machine.",
        "deletion_policy": "Controlled by the local operator.",
        "encryption_in_transit": "Not applicable — no network transfer of audio.",
        "encryption_at_rest": "Local disk controls.",
        "authentication": "None — local process",
        "logging_exposure": "Local logs only.",
        "subprocessor_implications": "None.",
        "verified_source": ["app/providers/local_whisper.py"],
        "verified_at": VERIFIED_AT,
        "approval_setting": "ON-DEVICE (ENVIRONMENT=local)",
    },
}

LOCAL_PROVIDERS = frozenset({"local_whisper", "local_whisper_verify", "local_diarization"})


def approved(provider: str) -> bool:
    settings = get_settings()
    if provider in LOCAL_PROVIDERS:
        # On-device processing: no audio leaves the machine, so no third-party policy applies.
        return settings.environment == "local"
    flags = {
        "assemblyai": settings.assemblyai_legal_audio_approved,
        "google_chirp3": settings.google_legal_audio_approved,
        "deepgram": settings.deepgram_legal_audio_approved,
        "openai": settings.openai_legal_audio_approved,
        "pyannoteai": settings.pyannote_legal_audio_approved,
    }
    return bool(flags.get(provider, False))


def status(provider: str) -> str:
    return "APPROVED" if approved(provider) else "BLOCKED BY DATA POLICY"


def all_privacy() -> list[dict[str, Any]]:
    rows = []
    for name in sorted(PRIVACY_REGISTRY):
        row = PRIVACY_REGISTRY[name].copy()
        row["provider_key"] = name
        row["status"] = status(name)
        rows.append(row)
    return rows
