from __future__ import annotations

import os
import threading
from typing import Any

from ..audio import probe
from .base import AsrAdapter, NotConfigured, ProviderError, ProviderInfo


class LocalWhisper(AsrAdapter):
    name = "local_whisper"
    asynchronous = False

    _model: Any = None
    _model_key: tuple[str, str, str, str] | None = None
    _lock = threading.Lock()

    def _settings(self) -> tuple[str, str, str, str]:
        model = os.environ.get("MURAILEX_LOCAL_ASR_MODEL", "").strip()
        device = os.environ.get("MURAILEX_LOCAL_ASR_DEVICE", "cpu").strip() or "cpu"
        compute_type = os.environ.get("MURAILEX_LOCAL_ASR_COMPUTE_TYPE", "int8").strip() or "int8"
        cache_dir = os.environ.get(
            "MURAILEX_LOCAL_ASR_CACHE",
            os.path.join(os.path.expanduser("~"), ".cache", "murailex", "whisper"),
        )
        return model, device, compute_type, cache_dir

    def _key(self) -> str:
        model, _, _, _ = self._settings()
        if not model:
            raise NotConfigured(self.name)
        return model

    def parameters(self, context: dict[str, Any] | None = None) -> dict[str, Any]:
        model, device, compute_type, cache_dir = self._settings()
        return {
            "model": model or None,
            "device": device,
            "compute_type": compute_type,
            "cache_dir": cache_dir,
            "task": "transcribe",
            "beam_size": 5,
            "temperature": 0.0,
            "word_timestamps": True,
            "without_timestamps": False,
            "condition_on_previous_text": True,
            "vad_filter": False,
            "no_speech_threshold": 0.6,
            "log_prob_threshold": -1.0,
            "compression_ratio_threshold": 2.4,
            "hallucination_silence_threshold": 2.0,
            "multilingual": True,
        }

    def info(self) -> ProviderInfo:
        model, _, _, _ = self._settings()
        return ProviderInfo(
            self.name,
            model or "large-v3-turbo",
            "primary_asr",
            bool(model),
            self.parameters(),
        )

    @classmethod
    def _get_model(cls, key: tuple[str, str, str, str]) -> Any:
        with cls._lock:
            if cls._model is not None and cls._model_key == key:
                return cls._model
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                raise ProviderError(
                    "Local ASR requires faster-whisper to be installed.",
                    retryable=False,
                ) from exc

            model_name, device, compute_type, cache_dir = key
            try:
                model = WhisperModel(
                    model_name,
                    device=device,
                    compute_type=compute_type,
                    download_root=cache_dir,
                )
            except Exception as exc:  # noqa: BLE001
                raise ProviderError(
                    f"Local Whisper model initialization failed: {exc}",
                    retryable=False,
                ) from exc
            cls._model = model
            cls._model_key = key
            return model

    def transcribe(self, audio_path: str, context: dict[str, Any]) -> dict[str, Any]:
        key = self._settings()
        model_name = self._key()
        model = self._get_model(key)
        try:
            segments, info = model.transcribe(
                audio_path,
                task="transcribe",
                language=None,
                beam_size=5,
                temperature=0.0,
                word_timestamps=True,
                without_timestamps=False,
                condition_on_previous_text=True,
                vad_filter=False,
                no_speech_threshold=0.6,
                log_prob_threshold=-1.0,
                compression_ratio_threshold=2.4,
                hallucination_silence_threshold=2.0,
                multilingual=True,
            )
            words: list[dict[str, Any]] = []
            segment_count = 0
            previous_end = 0.0
            for segment in segments:
                segment_count += 1
                start = float(segment.start)
                end = float(segment.end)
                if start < 0 or end < start or start + 1e-6 < previous_end:
                    raise ProviderError("Local Whisper returned non-monotonic timestamps.", retryable=False)
                previous_end = end
                segment_words = segment.words
                if segment.text.strip() and not segment_words:
                    raise ProviderError("Local Whisper returned text without word timestamps.", retryable=False)
                for word in segment_words or []:
                    ws = float(word.start)
                    we = float(word.end)
                    if ws < 0 or we < ws:
                        raise ProviderError("Local Whisper returned invalid word timestamps.", retryable=False)
                    if we > end + 1.0:
                        raise ProviderError("Local Whisper word extends beyond its segment.", retryable=False)
                    words.append(
                        {
                            "text": word.word.strip(),
                            "start_ms": int(round(ws * 1000)),
                            "end_ms": int(round(we * 1000)),
                            "confidence": float(word.probability),
                            "speaker": None,
                        }
                    )
            media = probe(audio_path)
            duration_ms = int(media["duration_ms"])
            first_start = words[0]["start_ms"] if words else None
            last_end = words[-1]["end_ms"] if words else None
            return {
                "words": words,
                "language_code": getattr(info, "language", None),
                "language_probability": float(getattr(info, "language_probability", 0.0) or 0.0),
                "duration_ms": duration_ms,
                "segment_count": segment_count,
                "coverage": {
                    "duration_ms": duration_ms,
                    "first_word_start_ms": first_start,
                    "last_word_end_ms": last_end,
                    "word_count": len(words),
                    "segment_count": segment_count,
                    "application_level_chunks": 0,
                    "silent_truncation_detected": False,
                },
                "model": model_name,
            }
        except ProviderError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"Local Whisper transcription failed: {exc}", retryable=False) from exc

    def normalize(self, raw: Any) -> dict[str, Any]:
        tokens = [
            {
                "text": str(w.get("text", "")),
                "start_ms": int(w.get("start_ms") or 0),
                "end_ms": int(w.get("end_ms") or 0),
                "confidence": w.get("confidence"),
                "speaker": w.get("speaker"),
            }
            for w in raw.get("words") or []
            if str(w.get("text", ""))
        ]
        return {
            "tokens": tokens,
            "language": raw.get("language_code"),
            "language_probability": raw.get("language_probability"),
            "coverage": raw.get("coverage"),
        }
