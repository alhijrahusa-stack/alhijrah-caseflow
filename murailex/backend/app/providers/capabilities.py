"""Verified provider capability registry.

Only capabilities supported by current first-party documentation are stated as facts.
Unknown, account-specific, or corpus-dependent capabilities remain UNVERIFIED. This registry
is descriptive evidence for routing/readiness; it does not select a benchmark winner and
never marks a provider READY.
"""
from __future__ import annotations

from typing import Any

VERIFIED_AT = "2026-09-27"

CAPABILITIES: dict[str, dict[str, Any]] = {
    "assemblyai": {
        "provider": "AssemblyAI",
        "model": "universal-3-5-pro",
        "model_version": "provider-managed",
        "supported_languages": ["ar", "en"],
        "supported_locales": ["ar"],
        "word_timestamps": True,
        "segment_timestamps": True,
        "code_switch_support": True,
        "keyterm_or_context_support": True,
        "diarization_support": True,
        "api_status": "available",
        "ga_or_preview": "UNVERIFIED",
        "pricing_reference": "https://www.assemblyai.com/pricing/",
        "verified_source": [
            "https://www.assemblyai.com/products/speech-to-text",
            "https://www.assemblyai.com/blog/u3-pro-may-updates",
            "https://www.assemblyai.com/pricing/",
        ],
        "verified_at": VERIFIED_AT,
        "notes": "Regional Arabic locale codes are not claimed. Actual provider-returned model metadata must be preserved.",
    },
    "google_chirp3": {
        "provider": "Google Cloud Speech-to-Text V2",
        "model": "chirp_3",
        "model_version": "provider-managed",
        "supported_languages": ["ar"],
        "supported_locales": ["ar-EG", "ar-YE", "ar-SY", "ar-LB", "ar-IQ"],
        "word_timestamps": True,
        "segment_timestamps": True,
        "code_switch_support": "UNVERIFIED for the exact MURAILEX Arabic routing",
        "keyterm_or_context_support": True,
        "diarization_support": "NOT SUPPORTED for the listed Arabic locales in the current Chirp 3 diarization language table",
        "api_status": "available",
        "ga_or_preview": "Preview for listed Arabic locales",
        "pricing_reference": "https://cloud.google.com/speech-to-text/pricing",
        "verified_source": [
            "https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3",
            "https://docs.cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages",
        ],
        "verified_at": VERIFIED_AT,
        "notes": "Word timestamps are available in Recognize/BatchRecognize. Word-level confidence is not treated as a calibrated confidence score.",
    },
    "deepgram": {
        "provider": "Deepgram",
        "model": "nova-3",
        "model_version": "provider-managed",
        "supported_languages": ["ar"],
        "supported_locales": ["ar", "ar-EG", "ar-SY", "ar-LB", "ar-IQ"],
        "word_timestamps": True,
        "segment_timestamps": True,
        "code_switch_support": "UNVERIFIED for Arabic-English on the MURAILEX legal corpus",
        "keyterm_or_context_support": True,
        "diarization_support": True,
        "api_status": "available",
        "ga_or_preview": "UNVERIFIED",
        "pricing_reference": "https://deepgram.com/pricing",
        "verified_source": [
            "https://developers.deepgram.com/docs/models-languages-overview",
            "https://developers.deepgram.com/docs/keyterm",
            "https://developers.deepgram.com/changelog/2026/1/27",
            "https://developers.deepgram.com/trust-security/your-data",
        ],
        "verified_at": VERIFIED_AT,
        "notes": "Nova-3 documents Arabic general and ar-EG/ar-SY/ar-LB/ar-IQ, but not ar-YE; ar-YE substitution is forbidden.",
    },
    "openai": {
        "provider": "OpenAI",
        "model": "gpt-transcribe",
        "model_version": "provider-managed",
        "supported_languages": ["ar", "en"],
        "supported_locales": ["ar"],
        "word_timestamps": "UNVERIFIED for gpt-transcribe; MURAILEX does not synthesize them",
        "segment_timestamps": "MURAILEX region boundaries only; not claimed as model-native segment timestamps",
        "code_switch_support": "UNVERIFIED for the MURAILEX legal corpus",
        "keyterm_or_context_support": "UNVERIFIED for the exact production request path",
        "diarization_support": False,
        "api_status": "available",
        "ga_or_preview": "UNVERIFIED",
        "pricing_reference": "https://developers.openai.com/api/docs/pricing",
        "verified_source": [
            "https://developers.openai.com/api/docs/guides/speech-to-text",
            "https://developers.openai.com/api/docs/models/gpt-transcribe",
        ],
        "verified_at": VERIFIED_AT,
        "notes": "Used only as independent region-level verification. No fabricated word timestamps or dialect claims.",
    },
    "pyannoteai": {
        "provider": "pyannoteAI",
        "model": "precision-3",
        "model_version": "provider-managed",
        "supported_languages": ["language-agnostic"],
        "supported_locales": ["language-agnostic"],
        "word_timestamps": False,
        "segment_timestamps": True,
        "code_switch_support": "not applicable to acoustic speaker diarization",
        "keyterm_or_context_support": False,
        "diarization_support": True,
        "api_status": "available when account/API access is configured",
        "ga_or_preview": "UNVERIFIED",
        "pricing_reference": "UNVERIFIED",
        "verified_source": [
            "https://www.pyannote.ai/changelog/precision-3",
            "https://www.pyannote.ai/precision-3",
        ],
        "verified_at": VERIFIED_AT,
        "notes": "Automatic speaker labels are not real-person identity. Active-account capability/privacy remain separately gated.",
    },
    "audar": {
        "provider": "Audar",
        "model": "Audar-ASR-V1-Turbo",
        "model_version": "UNVERIFIED",
        "supported_languages": "UNVERIFIED",
        "supported_locales": "UNVERIFIED",
        "word_timestamps": "UNVERIFIED",
        "segment_timestamps": "UNVERIFIED",
        "code_switch_support": "UNVERIFIED",
        "keyterm_or_context_support": "UNVERIFIED",
        "diarization_support": "UNVERIFIED",
        "api_status": "UNVERIFIED",
        "ga_or_preview": "UNVERIFIED",
        "pricing_reference": "UNVERIFIED",
        "verified_source": [],
        "verified_at": None,
        "notes": "Not eligible for production routing until current first-party documentation and a real benchmark are available.",
    },
}


def get(provider: str) -> dict[str, Any]:
    return CAPABILITIES[provider].copy()


def all_capabilities() -> list[dict[str, Any]]:
    return [CAPABILITIES[name].copy() for name in sorted(CAPABILITIES)]
