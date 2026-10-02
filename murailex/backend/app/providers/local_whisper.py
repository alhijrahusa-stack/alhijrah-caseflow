"""On-device Whisper ASR (faster-whisper / CTranslate2) for ENVIRONMENT=local.

Audio never leaves the machine. Decoding is configured for verbatim coverage:
- no voice-activity filter and no no-speech skipping, so no window of the recording is
  silently dropped;
- no initial prompt or hotwords, so nothing biases the text;
- condition_on_previous_text disabled to prevent repetition loops carrying across windows.

The raw response keeps every decoded segment with its decoder statistics so coverage of the
full recording is auditable after the fact.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any

from ..config import get_settings
from .base import AsrAdapter, ProviderError, ProviderInfo

_MODELS: dict[tuple[str, str, int], Any] = {}
_LOCK = threading.Lock()


def _language(locale: str | None) -> str:
    if not locale or not locale.split("-")[0] == "ar":
        raise ProviderError(f"Unsupported recording locale for local Whisper: {locale!r}", retryable=False)
    return "ar"


def _model(name: str) -> Any:
    s = get_settings()
    key = (name, s.local_asr_compute_type, s.local_asr_threads)
    with _LOCK:
        if key not in _MODELS:
            from faster_whisper import WhisperModel

            _MODELS[key] = WhisperModel(
                name,
                device="cpu",
                compute_type=s.local_asr_compute_type,
                # leave one core for the API/web app unless explicitly configured
                cpu_threads=s.local_asr_threads or max(1, (os.cpu_count() or 4) - 1),
            )
        return _MODELS[key]


class LocalWhisper(AsrAdapter):
    asynchronous = False

    def __init__(self, name: str, model_setting: str, role: str):
        self.name = name
        self._model_setting = model_setting
        self._role = role

    def model_name(self) -> str:
        return str(getattr(get_settings(), self._model_setting))

    def info(self, context: dict[str, Any] | None = None) -> ProviderInfo:
        s = get_settings()
        return ProviderInfo(
            self.name,
            self.model_name(),
            self._role,
            s.environment == "local",
            {
                "runtime": "faster-whisper/CTranslate2",
                "device": "cpu",
                "compute_type": s.local_asr_compute_type,
                "language": "ar",
                "beam_size": s.local_asr_beam_size,
                "word_timestamps": True,
                "vad_filter": False,
                "no_speech_threshold": None,
                "condition_on_previous_text": False,
                "initial_prompt": None,
                "privacy_gate": "ON-DEVICE — audio is not transmitted",
            },
        )

    def transcribe(self, audio_path: str, context: dict[str, Any]) -> Any:
        if get_settings().environment != "local":
            raise ProviderError("Local Whisper runs only in ENVIRONMENT=local.", retryable=False)
        s = get_settings()
        language = _language(context.get("language_locale"))
        started = time.monotonic()
        try:
            model = _model(self.model_name())
            segments, info = model.transcribe(
                audio_path,
                language=language,
                task="transcribe",
                beam_size=s.local_asr_beam_size,
                word_timestamps=True,
                vad_filter=False,
                no_speech_threshold=None,
                condition_on_previous_text=False,
                initial_prompt=None,
            )
            out = []
            for seg in segments:  # generator: decoding happens here, window by window
                out.append(
                    {
                        "id": seg.id,
                        "seek": seg.seek,
                        "start": seg.start,
                        "end": seg.end,
                        "text": seg.text,
                        "avg_logprob": seg.avg_logprob,
                        "compression_ratio": seg.compression_ratio,
                        "no_speech_prob": seg.no_speech_prob,
                        "temperature": seg.temperature,
                        "words": [
                            {"start": w.start, "end": w.end, "word": w.word, "probability": w.probability}
                            for w in (seg.words or [])
                        ],
                    }
                )
        except ProviderError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"Local Whisper failed: {type(exc).__name__}: {exc}", retryable=False) from exc
        return {
            "model": self.model_name(),
            "language": info.language,
            "language_probability": info.language_probability,
            "audio_duration_s": info.duration,
            "processing_seconds": round(time.monotonic() - started, 3),
            "segments": out,
        }

    def normalize(self, raw: Any) -> dict[str, Any]:
        if raw.get("model") != self.model_name():
            raise ProviderError(
                f"Local Whisper produced output for model {raw.get('model')!r}, expected {self.model_name()!r}.",
                retryable=False,
            )
        tokens = []
        for seg in raw.get("segments") or []:
            for w in seg.get("words") or []:
                text = str(w.get("word") or "").strip()
                if not text:
                    continue
                tokens.append(
                    {
                        "text": text,
                        "start_ms": int(round(float(w["start"]) * 1000)),
                        "end_ms": int(round(float(w["end"]) * 1000)),
                        "confidence": w.get("probability"),
                        "speaker": None,
                    }
                )
        segments = raw.get("segments") or []
        return {
            "tokens": tokens,
            "text": " ".join(str(seg.get("text") or "").strip() for seg in segments).strip(),
            "language": raw.get("language"),
            "coverage": {
                "audio_duration_ms": int(round(float(raw.get("audio_duration_s") or 0) * 1000)),
                "decoded_until_ms": int(round(float(segments[-1]["end"]) * 1000)) if segments else 0,
                "segments": len(segments),
            },
            "timestamp_source": "provider",
        }
