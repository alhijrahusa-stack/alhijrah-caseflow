"""Optional VibeVoice ASR and Realtime TTS gateway.

This is a separate research-preview surface. It never writes to the forensic
recording, provider-run, transcript, or audit tables, and never modifies source audio.
An administrator must approve external processing and each request must opt in.
Model inference takes place on a separately secured GPU server, not Railway CPU.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
from collections.abc import AsyncIterator
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from websockets.asyncio.client import connect

from ..config import get_settings
from ..security import Principal, current_principal, require_capability

router = APIRouter(prefix="/api/vibevoice", tags=["vibevoice"])
log = logging.getLogger("murailex.vibevoice")

MAX_AUDIO_BYTES = 48 * 1024 * 1024
MAX_CONTEXT_CHARS = 1200
VOICE_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


def _check_remote_url(url: str | None, *, websocket: bool) -> str | None:
    """Accept a server-configured endpoint only; never accept a client URL."""
    if not url:
        return None
    parsed = urlsplit(url.strip())
    valid_schemes = ("ws", "wss") if websocket else ("http", "https")
    secure_scheme = "wss" if websocket else "https"
    if (
        parsed.scheme not in valid_schemes
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        return None
    if get_settings().environment == "production" and parsed.scheme != secure_scheme:
        return None
    return url.rstrip("/")


def _bearer(value) -> dict[str, str]:
    if value is None:
        return {}
    secret = value.get_secret_value().strip()
    return {"Authorization": "Bearer " + secret} if secret else {}


def _configured(url: str | None, token) -> bool:
    s = get_settings()
    return bool(s.vibevoice_external_processing_approved and url and _bearer(token))


def _audio_mime(raw: bytes) -> str | None:
    """Sniff the container, not a user-supplied filename or Content-Type."""
    if raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        return "audio/wav"
    if raw[:4] == b"fLaC":
        return "audio/flac"
    if raw[:4] == b"OggS":
        return "audio/ogg"
    if raw[:4] == b"\x1a\x45\xdf\xa3":
        return "audio/webm"
    if raw[:3] == b"ID3" or (len(raw) >= 2 and raw[0] == 0xFF and raw[1] & 0xE0 == 0xE0):
        return "audio/mpeg"
    if len(raw) >= 12 and raw[4:8] == b"ftyp":
        return "audio/mp4"
    return None


def _asr_payload(raw: bytes, mime: str, context: str, model: str) -> dict:
    fields = "Start time, End time, Speaker ID, Content"
    text = "Please transcribe the audio in JSON format with these keys: " + fields
    if context:
        text += ". with extra info: " + context
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a helpful assistant that transcribes audio input into text output in JSON format."},
            {"role": "user", "content": [
                {"type": "audio_url", "audio_url": {"url": "data:" + mime + ";base64," + base64.b64encode(raw).decode("ascii")}},
                {"type": "text", "text": text},
            ]},
        ],
        "temperature": 0.0,
        "top_p": 1.0,
        "stream": False,
        "max_tokens": 32768,
    }


def _segments(content: str) -> list[dict]:
    """Expose original model fields unchanged; no fabricated timestamps or speakers."""
    try:
        parsed = json.loads(content)
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) and all(isinstance(item, dict) for item in parsed) else []


def _require_remote(ready: bool) -> None:
    if not ready:
        raise HTTPException(503, "VibeVoice is not configured and externally approved for this service.")


@router.get("/status")
async def status(p: Principal = Depends(current_principal)):
    require_capability(p, "view")
    s = get_settings()
    asr_base = _check_remote_url(s.vibevoice_asr_base_url, websocket=False)
    tts_ws = _check_remote_url(s.vibevoice_tts_ws_url, websocket=True)
    asr_allowed = _configured(asr_base, s.vibevoice_asr_api_key)
    tts_allowed = _configured(tts_ws, s.vibevoice_tts_api_key)
    result: dict = {
        "scope": "RESEARCH_PREVIEW_ONLY",
        "asr": {"configured": asr_allowed, "ready": False, "model": s.vibevoice_asr_model},
        "tts": {"configured": tts_allowed, "ready": False, "model": "VibeVoice-Realtime-0.5B", "voices": [], "default_voice": None},
    }
    if not (asr_allowed or tts_allowed):
        return result

    async with httpx.AsyncClient(timeout=5.0, follow_redirects=False, trust_env=False) as client:
        if asr_allowed and asr_base:
            try:
                response = await client.get(asr_base + "/v1/models", headers=_bearer(s.vibevoice_asr_api_key))
                response.raise_for_status()
                models = response.json().get("data", [])
                result["asr"]["ready"] = any(
                    isinstance(item, dict) and item.get("id") == s.vibevoice_asr_model for item in models
                )
            except (httpx.HTTPError, ValueError, TypeError, AttributeError):
                log.warning("VibeVoice ASR status probe failed")
        if tts_allowed and tts_ws:
            try:
                parsed = urlsplit(tts_ws)
                config_url = urlunsplit(("https" if parsed.scheme == "wss" else "http", parsed.netloc, "/config", "", ""))
                response = await client.get(config_url, headers=_bearer(s.vibevoice_tts_api_key))
                response.raise_for_status()
                data = response.json()
                voices = [x for x in data.get("voices", []) if isinstance(x, str) and VOICE_RE.fullmatch(x)]
                result["tts"].update({
                    "ready": bool(voices),
                    "voices": voices,
                    "default_voice": data.get("default_voice") if data.get("default_voice") in voices else None,
                })
            except (httpx.HTTPError, ValueError, TypeError, AttributeError):
                log.warning("VibeVoice TTS status probe failed")
    return result


@router.post("/asr")
async def transcribe(
    file: UploadFile = File(...),
    context_info: str = Form(""),
    consent: bool = Form(False),
    p: Principal = Depends(current_principal),
):
    require_capability(p, "upload")
    s = get_settings()
    base = _check_remote_url(s.vibevoice_asr_base_url, websocket=False)
    _require_remote(_configured(base, s.vibevoice_asr_api_key))
    if not consent:
        raise HTTPException(400, "Explicit authorization to transmit audio to the configured GPU service is required.")
    if len(context_info) > MAX_CONTEXT_CHARS:
        raise HTTPException(422, "Context is too long.")

    raw = await file.read(MAX_AUDIO_BYTES + 1)
    await file.close()
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio exceeds the 48 MiB preview limit.")
    mime = _audio_mime(raw)
    if mime is None:
        raise HTTPException(415, "Unsupported or invalid audio container.")

    assert base is not None
    payload = _asr_payload(raw, mime, context_info.strip(), s.vibevoice_asr_model)
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, read=1200.0, write=120.0),
            follow_redirects=False,
            trust_env=False,
        ) as client:
            response = await client.post(
                base + "/v1/chat/completions",
                headers=_bearer(s.vibevoice_asr_api_key),
                json=payload,
            )
            response.raise_for_status()
            answer = response.json()
        content = answer["choices"][0]["message"]["content"]
        if not isinstance(content, str):
            raise ValueError("Model returned non-text content.")
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
        log.warning("VibeVoice ASR upstream failure: %s", type(exc).__name__)
        raise HTTPException(502, "VibeVoice ASR service did not return a valid transcription.") from None

    return {
        "scope": "RESEARCH_PREVIEW_ONLY",
        "recorded_to_forensic_case": False,
        "model": s.vibevoice_asr_model,
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "raw_transcript": content,
        "segments": _segments(content),
    }


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2400)
    voice: str | None = Field(default=None, max_length=80)
    cfg_scale: float = Field(default=1.5, ge=1.3, le=3.0)
    inference_steps: int = Field(default=5, ge=5, le=20)
    consent: bool = False


async def _pcm_stream(socket) -> AsyncIterator[bytes]:
    """Only forward PCM16 frames; upstream log messages are not audio."""
    try:
        async for message in socket:
            if isinstance(message, bytes):
                yield message
            elif isinstance(message, str):
                try:
                    event = json.loads(message)
                except ValueError:
                    continue
                if event.get("event") in ("generation_error", "backend_error"):
                    log.warning("VibeVoice TTS reported a generation error")
                    raise RuntimeError("VibeVoice TTS upstream generation failed")
    finally:
        await socket.close()


@router.post("/speech")
async def speech(body: SpeechRequest, p: Principal = Depends(current_principal)):
    require_capability(p, "upload")
    s = get_settings()
    upstream = _check_remote_url(s.vibevoice_tts_ws_url, websocket=True)
    _require_remote(_configured(upstream, s.vibevoice_tts_api_key))
    if not body.consent:
        raise HTTPException(400, "Explicit authorization to transmit text to the configured GPU service is required.")
    if not body.text.strip():
        raise HTTPException(422, "Text cannot be empty.")
    if body.voice is not None and not VOICE_RE.fullmatch(body.voice):
        raise HTTPException(422, "Invalid voice preset identifier.")

    assert upstream is not None
    query = {"text": body.text, "cfg": str(body.cfg_scale), "steps": str(body.inference_steps)}
    if body.voice:
        query["voice"] = body.voice
    target = upstream + "?" + urlencode(query)
    try:
        socket = await connect(
            target,
            additional_headers=_bearer(s.vibevoice_tts_api_key),
            open_timeout=20,
            max_size=16 * 1024 * 1024,
        )
    except Exception as exc:  # WebSocket handshake errors vary across library versions.
        log.warning("VibeVoice TTS connection failed: %s", type(exc).__name__)
        raise HTTPException(502, "VibeVoice realtime speech service is unavailable.") from None

    return StreamingResponse(
        _pcm_stream(socket),
        media_type="application/octet-stream",
        headers={
            "X-Audio-Format": "pcm_s16le",
            "X-Audio-Sample-Rate": "24000",
            "X-VibeVoice-Scope": "research-preview-only",
            "Cache-Control": "no-store",
        },
    )
