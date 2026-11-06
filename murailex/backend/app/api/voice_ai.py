"""Opt-in Groq voice preview — not part of the forensic evidence chain.

Uses the existing authenticated FastAPI/CSRF boundary; GROQ_API_KEY stays
server-side. A provider response is never evidence, a verified transcript,
or a substitute for listening to the original recording.
"""
from __future__ import annotations

import hashlib
import logging
import time
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..config import get_settings
from ..security import Principal, current_principal, require_capability
from .vibevoice import _audio_mime

router = APIRouter(prefix="/api/voice-ai", tags=["voice-ai"])
logger = logging.getLogger("murailex.voice_ai")

GROQ_BASE = "https://api.groq.com/openai/v1"
STT_MODEL = "whisper-large-v3"
MAX_AUDIO = 25 * 1024 * 1024
MAX_PROMPT = 500
ORPHEUS_MODELS = {
    "ar": "canopylabs/orpheus-arabic-saudi",
    "en": "canopylabs/orpheus-v1-english",
}
ORPHEUS_VOICES = {
    "ar": ("abdullah", "fahad", "sultan", "lulwa", "noura", "aisha"),
    "en": ("autumn", "diana", "hannah", "austin", "daniel", "troy"),
}


def _api_key() -> str:
    value = get_settings().groq_api_key
    key = value.get_secret_value().strip() if value is not None else ""
    if not key:
        raise HTTPException(503, "Groq API key is not configured.")
    return key


def _check_consent(consent: bool) -> None:
    if not consent:
        raise HTTPException(400, "Explicit authorization to transmit content to Groq is required.")


def _upstream_error(status: int) -> HTTPException:
    if status == 429:
        return HTTPException(429, "Groq rate limit reached. Retry after your provider quota resets.")
    if status in (401, 403):
        return HTTPException(503, "Groq rejected the configured API credentials or model access.")
    if status in (400, 413, 422):
        return HTTPException(422, "Groq rejected the input format or model parameters.")
    return HTTPException(502, "The Groq inference service is unavailable.")


def _headers() -> dict[str, str]:
    return {"Authorization": "Bearer " + _api_key()}


@router.get("/status")
async def status(p: Principal = Depends(current_principal)):
    require_capability(p, "view")
    s = get_settings()
    configured = bool(s.groq_api_key and s.groq_api_key.get_secret_value().strip())
    return {
        "configured": configured,
        "engine_verified": False,
        "provider": "groq",
        "stt_model": STT_MODEL,
        "tts_models": ORPHEUS_MODELS,
        "voices": {name: list(voices) for name, voices in ORPHEUS_VOICES.items()},
        "max_stt_upload_bytes": MAX_AUDIO,
        "max_tts_characters": 200,
        "scope": "NON_FORENSIC_PREVIEW",
        "note": "Configured does not mean the provider model has passed a real inference test.",
    }


@router.post("/stt")
async def transcribe(
    file: UploadFile = File(...),
    language: Literal["ar", "en", "auto"] = Form("auto"),
    context_info: str = Form(""),
    consent: bool = Form(False),
    p: Principal = Depends(current_principal),
):
    require_capability(p, "upload")
    _check_consent(consent)
    _api_key()
    if len(context_info) > MAX_PROMPT:
        raise HTTPException(422, "Context exceeds the permitted length.")

    raw = await file.read(MAX_AUDIO + 1)
    await file.close()
    if not raw:
        raise HTTPException(422, "Audio file is empty.")
    if len(raw) > MAX_AUDIO:
        raise HTTPException(413, "The free-tier audio limit is 25 MiB per file.")
    mime = _audio_mime(raw)
    if not mime:
        raise HTTPException(415, "Unsupported or invalid audio container.")

    data: dict[str, object] = {
        "model": STT_MODEL,
        "response_format": "verbose_json",
        "timestamp_granularities[]": ["segment", "word"],
        "temperature": "0",
    }
    if language != "auto":
        data["language"] = language
    if context_info.strip():
        data["prompt"] = context_info.strip()

    start = time.monotonic()
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, read=240.0, write=120.0),
            follow_redirects=False,
            trust_env=False,
        ) as client:
            result = await client.post(
                GROQ_BASE + "/audio/transcriptions",
                headers=_headers(),
                data=data,
                files={"file": (file.filename or "speech.wav", raw, mime)},
            )
            if result.status_code >= 400:
                raise _upstream_error(result.status_code)
            payload = result.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        logger.warning("Groq STT request failed: %s", type(exc).__name__)
        raise HTTPException(502, "Groq failed to return a valid transcription.") from None

    if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
        raise HTTPException(502, "Groq STT returned an invalid transcription payload.")
    segments = payload.get("segments") or []
    words = payload.get("words") or []
    if not isinstance(segments, list) or not isinstance(words, list):
        raise HTTPException(502, "Groq STT returned invalid timestamp data.")
    return {
        "provider": "groq",
        "model": STT_MODEL,
        "scope": "NON_FORENSIC_PREVIEW",
        "saved_to_case": False,
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "elapsed_ms": int((time.monotonic() - start) * 1000),
        "text": payload["text"],
        "language": payload.get("language"),
        "duration": payload.get("duration"),
        "segments": segments,
        "words": words,
    }


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    language: Literal["ar", "en"] = "ar"
    voice: str = Field(min_length=1, max_length=40)
    consent: bool = False


@router.post("/tts")
async def synthesize(body: TTSRequest, p: Principal = Depends(current_principal)):
    require_capability(p, "upload")
    _check_consent(body.consent)
    _api_key()
    if not body.text.strip():
        raise HTTPException(422, "Text cannot be blank.")
    if body.voice not in ORPHEUS_VOICES[body.language]:
        raise HTTPException(422, "Voice is not available for the selected language.")

    request = {
        "model": ORPHEUS_MODELS[body.language],
        "input": body.text,
        "voice": body.voice,
        "response_format": "wav",
    }
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, read=120.0, write=30.0),
            follow_redirects=False,
            trust_env=False,
        ) as client:
            result = await client.post(
                GROQ_BASE + "/audio/speech",
                headers={**_headers(), "Content-Type": "application/json"},
                json=request,
            )
            if result.status_code >= 400:
                raise _upstream_error(result.status_code)
            sound = result.content
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        logger.warning("Groq TTS request failed: %s", type(exc).__name__)
        raise HTTPException(502, "Groq speech synthesis is unavailable.") from None

    if len(sound) < 44 or sound[:4] not in (b"RIFF", b"RF64") or sound[8:12] != b"WAVE":
        raise HTTPException(502, "Groq returned an invalid WAV file.")

    return Response(
        content=sound,
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'inline; filename="murailex-speech.wav"',
            "X-Voice-Model": ORPHEUS_MODELS[body.language],
            "X-Voice-Scope": "non-forensic-preview",
            "Cache-Control": "no-store",
        },
    )
