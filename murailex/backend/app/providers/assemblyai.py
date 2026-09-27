"""AssemblyAI pre-recorded transcription using Universal-2 for Arabic.

MURAILEX supplies Arabic/English language codes for code-switch recognition. AssemblyAI
Universal-2 is used explicitly because current provider documentation supports Arabic on
Universal-2, while Universal-3 Pro does not support Arabic. Expected terminology is sent
only as recognition hints and never overwrites evidence text.
"""
from __future__ import annotations

from typing import Any

from ..config import get_settings
from .base import AsrAdapter, NotConfigured, Pending, ProviderError, ProviderInfo
from .http import request


class AssemblyAI(AsrAdapter):
    name = "assemblyai"
    asynchronous = True

    def _key(self) -> str:
        key = get_settings().assemblyai_api_key
        if not key or not key.get_secret_value():
            raise NotConfigured(self.name)
        return key.get_secret_value()

    def parameters(self, context: dict[str, Any] | None = None) -> dict[str, Any]:
        settings = get_settings()
        params: dict[str, Any] = {
            "speech_models": [settings.assemblyai_speech_model],
            "speaker_labels": True,
            "language_codes": ["ar", "en"],
        }
        expected_speakers = (context or {}).get("expected_speakers")
        if expected_speakers:
            params["speakers_expected"] = int(expected_speakers)

        expected_terms = [
            str(term).strip()
            for term in ((context or {}).get("expected_terms") or [])
            if str(term).strip()
        ]
        if expected_terms:
            # Universal-2 supports up to 200 keyterms in the current provider contract.
            params["keyterms_prompt"] = expected_terms[:200]
        return params

    def info(self, context: dict[str, Any] | None = None) -> ProviderInfo:
        settings = get_settings()
        return ProviderInfo(
            self.name,
            settings.assemblyai_speech_model,
            "primary_asr",
            bool(settings.assemblyai_api_key and settings.assemblyai_api_key.get_secret_value()),
            self.parameters(context),
        )

    def submit(self, audio_path: str, context: dict[str, Any]) -> str:
        key = self._key()
        base = get_settings().assemblyai_base_url
        with open(audio_path, "rb") as fh:
            upload = request(
                "POST",
                f"{base}/v2/upload",
                self.name,
                timeout=900,
                headers={"authorization": key},
                content=fh.read(),
            )
        upload_url = upload.json().get("upload_url")
        if not upload_url:
            raise ProviderError("AssemblyAI upload returned no upload_url", retryable=True)
        body = {"audio_url": upload_url, **self.parameters(context)}
        response = request(
            "POST",
            f"{base}/v2/transcript",
            self.name,
            headers={"authorization": key},
            json=body,
        )
        transcript_id = response.json().get("id")
        if not transcript_id:
            raise ProviderError("AssemblyAI returned no transcript id", retryable=True)
        return str(transcript_id)

    def fetch(self, remote_id: str) -> dict[str, Any] | Pending:
        key = self._key()
        base = get_settings().assemblyai_base_url
        data = request(
            "GET",
            f"{base}/v2/transcript/{remote_id}",
            self.name,
            headers={"authorization": key},
        ).json()
        status = data.get("status")
        if status == "completed":
            return data
        if status == "error":
            raise ProviderError(
                f"AssemblyAI transcription error: {data.get('error')}",
                retryable=False,
            )
        return Pending(str(status))

    def normalize(self, raw: Any) -> dict[str, Any]:
        tokens = []
        for word in raw.get("words") or []:
            tokens.append(
                {
                    "text": word.get("text", ""),
                    "start_ms": int(word.get("start") or 0),
                    "end_ms": int(word.get("end") or 0),
                    "confidence": word.get("confidence"),
                    "speaker": word.get("speaker"),
                }
            )
        return {
            "tokens": tokens,
            "language": raw.get("language_code"),
            "speech_model_used": raw.get("speech_model_used"),
        }
