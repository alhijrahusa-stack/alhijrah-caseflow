"""Verified provider capability registry.

This registry records only provider capabilities verified against first-party documentation.
It is descriptive evidence for routing/readiness; it does not mark a provider READY. Runtime
readiness still requires a real successful request and persistence in MURAILEX.
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
        "api_status": "production",
        "ga_or_preview": "provider production API",
        "pricing_reference": "https://www.assemblyai.com/pricing/",
        "verified_source": [
            "https://www.assemblyai.com/products/speech-to-text",
            "https://www.assemblyai.com/blog/multilingual-transcription",
            "https://www.assemblyai.com/pricing/",
        ],
        "verified_at": VERIFIED_AT,
        "notes": "Arabic is one of the current native code-switching languages for Universal-3.5 Pro; actual speech_model_used must be preserved.",
    },
    "google_chirp3": {
        "provider": "Google Cloud Speech-to-Text V2",
        "model": "chirp_3",
        "model_version": "provider-managed",
        "supported_languages": ["ar"],
        "supported_locales": ["ar-EG", "ar-YE", "ar-SY", "ar-LB", "ar-IQ"],
        "word_timestamps": True,
        "segment_timestamps": True,
        "code_switch_support": False,
        "keyterm_or_context_support": True,
        "diarization_support": True,
        "api_status": "production API; listed Arabic locales are Preview",
        "ga_or_preview": "Preview for listed Arabic locales",
        "pricing_reference": "https://cloud.google.com/speech-to-text/pricing",
        "verified_source": [
            "https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3",
        ],
        "verified_at": VERIFIED_AT,
        "notes": "MURAILEX uses exact user-selected regional locale. Google documents listed Arabic locale launch readiness as Preview.",
    },
    "deepgram": {
        "provider": "Deepgram",
        "model": "nova-3",
        "model_version": "provider-managed",
        "supported_languages": ["ar"],
        "supported_locales": ["ar", "ar-EG", "ar-SY", "ar-LB", "ar-IQ"],
        "word_timestamps": True,
        "segment_timestamps": True,
        "code_switch_support": True,
        "keyterm_or_context_support": True,
        "diarization_support": True,
        "api_status": "production",
        "ga_or_preview": "production",
        "pricing_reference": "https://deepgram.com/pricing",
        "verified_source": [
            "https://developers.deepgram.com/docs/models-languages-overview",
            "https://developers.deepgram.com/trust-security/your-data",
        ],
        "verified_at": VERIFIED_AT,
        "notes": "Nova-3 does not list ar-YE; MURAILEX must not silently map Yemeni Arabic to another regional locale. mip_opt_out=true is required for legal-audio requests.",
    },
    "openai": {
        "provider": "OpenAI",
        "model": "gpt-transcribe",
        "model_version": "provider-managed",
        "supported_languages": ["ar", "en"],
        "supported_locales": ["ar"],
        "word_timestamps": False,
        "segment_timestamps": False,
        "code_switch_support": True,
        "keyterm_or_context_support": True,
        "diarization_support": False,
        "api_status": "production",
        "ga_or_preview": "production",
        "pricing_reference": "https://developers.openai.com/api/docs/models/gpt-transcribe",
        "verified_source": [
            "https://developers.openai.com/api/docs/guides/speech-to-text",
            "https://developers.openai.com/api/docs/models/gpt-transcribe",
        ],
        "verified_at": VERIFIED_AT,
        "notes": "gpt-transcribe is used only as independent region-level verification because current file transcription documentation directs word timestamps to whisper-1.",
    },
    "pyannoteai": {
        "provider": "pyannoteAI",
        "model": "precision-3",
        "model_version": "provider-managed",
        "supported_languages": ["language-agnostic"],
        "supported_locales": ["language-agnostic"],
        "word_timestamps": False,
        "segment_timestamps": True,
        "code_switch_support": True,
        "keyterm_or_context_support": False,
        "diarization_support": True,
        "api_status": "production",
        "ga_or_preview": "production",
        "pricing_reference": "https://www.pyannote.ai/pricing",
        "verified_source": [
            "https://www.pyannote.ai/changelog/precision-3",
            "https://www.pyannote.ai/precision-3",
        ],
        "verified_at": VERIFIED_AT,
        "notes": "Precision-3 is acoustic/language-agnostic speaker diarization; automatic speaker labels are not real-person identity.",
    },
}


def get(provider: str) -> dict[str, Any]:
    return CAPABILITIES[provider].copy()


def all_capabilities() -> list[dict[str, Any]]:
    return [CAPABILITIES[name].copy() for name in sorted(CAPABILITIES)]
