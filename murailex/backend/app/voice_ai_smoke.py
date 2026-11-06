"""Live Groq inference smoke using real TTS audio as STT input.

No fixtures, mocked responses or user recordings. Logs only HTTP status,
audio byte count, hash, timing and whether the STT transcript was nonempty.
The test is best-effort: upstream outages do not make the existing API unbootable.
"""
from __future__ import annotations

import hashlib
import logging
import time

import httpx

from .config import get_settings

log = logging.getLogger("murailex.groq_smoke")
BASE = "https://api.groq.com/openai/v1"


def run_groq_smoke() -> None:
    configured = get_settings().groq_api_key
    if configured is None or not configured.get_secret_value().strip():
        log.warning("GROQ_REAL_SMOKE status=SKIPPED reason=key_unconfigured")
        return

    headers = {"Authorization": "Bearer " + configured.get_secret_value().strip()}
    started = time.monotonic()
    try:
        with httpx.Client(
            timeout=httpx.Timeout(20.0, read=60.0, write=30.0),
            follow_redirects=False,
            trust_env=False,
        ) as client:
            tts = client.post(
                BASE + "/audio/speech",
                headers={**headers, "Content-Type": "application/json"},
                json={
                    "model": "canopylabs/orpheus-arabic-saudi",
                    "input": "مرحباً بكم في مورايلكس.",
                    "voice": "fahad",
                    "response_format": "wav",
                },
            )
            if tts.status_code != 200:
                log.error("GROQ_REAL_SMOKE stage=TTS status=FAILED upstream_http=%d", tts.status_code)
                return
            wave = tts.content
            if len(wave) < 44 or wave[:4] not in (b"RIFF", b"RF64") or wave[8:12] != b"WAVE":
                log.error("GROQ_REAL_SMOKE stage=TTS status=FAILED reason=invalid_wav")
                return
            tts_ms = round((time.monotonic() - started) * 1000)
            log.info(
                "GROQ_REAL_SMOKE stage=TTS status=SUCCESS model=canopylabs/orpheus-arabic-saudi "
                "bytes=%d sha256=%s elapsed_ms=%d",
                len(wave), hashlib.sha256(wave).hexdigest(), tts_ms,
            )

            stt_start = time.monotonic()
            transcription = client.post(
                BASE + "/audio/transcriptions",
                headers=headers,
                files={"file": ("groq-real-smoke.wav", wave, "audio/wav")},
                data={"model": "whisper-large-v3", "response_format": "verbose_json", "language": "ar"},
            )
            if transcription.status_code != 200:
                log.error("GROQ_REAL_SMOKE stage=STT status=FAILED upstream_http=%d", transcription.status_code)
                return
            data = transcription.json()
            content = data.get("text") if isinstance(data, dict) else None
            if not isinstance(content, str) or not content.strip():
                log.error("GROQ_REAL_SMOKE stage=STT status=FAILED reason=empty_transcript")
                return
            log.info(
                "GROQ_REAL_SMOKE stage=STT status=SUCCESS model=whisper-large-v3 "
                "nonempty=true chars=%d elapsed_ms=%d",
                len(content), round((time.monotonic() - stt_start) * 1000),
            )
            log.info("GROQ_REAL_SMOKE status=SUCCESS stages=2 elapsed_ms=%d", round((time.monotonic() - started) * 1000))
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        log.error("GROQ_REAL_SMOKE status=FAILED exception=%s", type(exc).__name__)
