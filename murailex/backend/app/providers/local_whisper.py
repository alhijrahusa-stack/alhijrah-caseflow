"""On-device Whisper ASR (faster-whisper / CTranslate2) for ENVIRONMENT=local.

Audio never leaves the machine. Decoding is configured for verbatim coverage:
- no voice-activity filter and no no-speech skipping, so no part of the recording is
  silently dropped;
- no initial prompt or hotwords, so nothing biases the text;
- condition_on_previous_text disabled to prevent repetition loops carrying across windows.

Long-form recordings are decoded in windows (default 10 min). Window boundaries are placed
at the middle of a detected pause near each target point when one exists, and every window
is decoded with an overlap on both sides, so a word that straddles a boundary is decoded
whole in at least one window. Merging is deterministic: each word belongs to the window
whose own interval contains the word's midpoint. Each finished window is checkpointed to
disk keyed by the input SHA-256 and the exact engine fingerprint; a restarted job resumes
from the checkpoints instead of re-decoding the whole recording.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
import threading
import time
from collections.abc import Callable
from typing import Any

from ..config import get_settings
from ..resources import effective_cpus, worker_threads
from .base import AsrAdapter, ProviderError, ProviderInfo

_log = logging.getLogger("murailex.asr")
_MODELS: dict[tuple[str, str, int], Any] = {}
_LOCK = threading.Lock()
_REVISIONS: dict[str, str] = {}

# Deterministic decoding. The engine's default is a temperature fallback list: a window that
# trips the compression-ratio or log-probability threshold is retried with temperature > 0,
# which SAMPLES, so the same evidence decodes differently on every run (measured: 467 vs 432
# words on one 4-minute recording, identical audio and configuration). Evidence has to be
# reproducible, so decoding stays at temperature 0 and a hard window is left to the
# independent verifier and human review rather than re-rolled.
TEMPERATURE = 0.0
WINDOWING_VERSION = "murailex.window/1"
_SIL_START = re.compile(r"silence_start: (-?[0-9.]+)")
_SIL_END = re.compile(r"silence_end: ([0-9.]+)")


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
                revision=_pinned(name) or None,
                device="cpu",
                compute_type=s.local_asr_compute_type,
                # leave one core for the API/web app unless explicitly configured
                cpu_threads=s.local_asr_threads or worker_threads(),
            )
        return _MODELS[key]


def _pinned(name: str) -> str:
    s = get_settings()
    return {s.local_asr_model: s.local_asr_model_revision, s.local_verify_model: s.local_verify_model_revision}.get(name, "")


def model_revision(name: str) -> str:
    """Immutable identity of the checkpoint (Hugging Face snapshot commit id): the pinned
    revision when configured (the engine downloads exactly that snapshot), else the installed one."""
    pinned = _pinned(name)
    if pinned:
        return pinned
    if name not in _REVISIONS:
        try:
            from faster_whisper.utils import download_model

            path = download_model(name, local_files_only=True)
            _REVISIONS[name] = os.path.basename(os.path.normpath(path))
        except Exception:  # noqa: BLE001 - not downloaded yet; the self-test will download it
            return "not-installed"
    return _REVISIONS[name]


def _versions() -> dict[str, str]:
    try:
        import ctranslate2
        import faster_whisper

        return {"faster_whisper": faster_whisper.__version__, "ctranslate2": ctranslate2.__version__}
    except Exception:  # noqa: BLE001
        return {"faster_whisper": "not-installed", "ctranslate2": "not-installed"}


def hardware_profile() -> dict[str, Any]:
    """Detected hardware and the resource policy actually in force (ResourceGovernor v1).
    GPU is reported when CTranslate2 sees CUDA devices, but routing stays on the CPU profile
    until a GPU self-test and benchmark prove the GPU route; that promotion is not automatic."""
    s = get_settings()
    cuda = 0
    try:
        import ctranslate2

        cuda = int(ctranslate2.get_cuda_device_count())
    except Exception:  # noqa: BLE001
        cuda = 0
    cpus = effective_cpus()
    return {
        "profile": "CPU_PROFILE",
        "cpu_count": cpus,
        "host_cpu_count": os.cpu_count() or 1,
        "cuda_devices_detected": cuda,
        "gpu_route": "not promoted (requires GPU self-test + benchmark evidence)" if cuda else "no GPU detected",
        "asr_threads": s.local_asr_threads or max(1, cpus - 1),
        "reserved_cores_for_ui_api": 0 if s.local_asr_threads else min(1, cpus - 1),
        "max_parallel_asr": 1,
        "worker_priority": "nice 10 (launcher)",
        "long_job_fairness": "window-level checkpoints; queued jobs run in arrival order",
    }


def plan_windows(
    duration_ms: int,
    silences: list[tuple[int, int]],
    target_ms: int,
    search_ms: int,
    overlap_ms: int,
) -> list[dict[str, int]]:
    """Deterministic window plan. Own intervals tile [0, duration) exactly; cut intervals
    extend each own interval by `overlap_ms` on both sides (clamped to the recording)."""
    if duration_ms <= 0:
        return []
    bounds = [0]
    while duration_ms - bounds[-1] > target_ms + target_ms // 4:
        target = bounds[-1] + target_ms
        best: int | None = None
        for start, end in silences:
            mid = (start + end) // 2
            if abs(mid - target) <= search_ms and mid > bounds[-1] + target_ms // 2:
                if best is None or abs(mid - target) < abs(best - target):
                    best = mid
        bounds.append(best if best is not None else target)
    bounds.append(duration_ms)
    return [
        {
            "index": i,
            "own_start_ms": bounds[i],
            "own_end_ms": bounds[i + 1],
            "cut_start_ms": max(0, bounds[i] - overlap_ms),
            "cut_end_ms": min(duration_ms, bounds[i + 1] + overlap_ms),
        }
        for i in range(len(bounds) - 1)
    ]


def merge_windows(windows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep each word only in the window whose own interval contains its midpoint."""
    merged: list[dict[str, Any]] = []
    last = len(windows) - 1
    for w in windows:
        lo = w["own_start_ms"] / 1000.0
        hi = float("inf") if w["index"] == last else w["own_end_ms"] / 1000.0
        for seg in w["segments"]:
            words = [x for x in seg["words"] if lo <= (x["start"] + x["end"]) / 2 < hi]
            if seg["words"] and not words:
                continue
            if not seg["words"] and not (lo <= (seg["start"] + seg["end"]) / 2 < hi):
                continue
            merged.append(
                {
                    **seg,
                    "window": w["index"],
                    "start": words[0]["start"] if words else seg["start"],
                    "end": words[-1]["end"] if words else seg["end"],
                    "text": "".join(x["word"] for x in words) if words else seg["text"],
                    "words": words,
                }
            )
    return merged


def _file_sha(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _duration_ms(path: str) -> int:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, timeout=300, check=True,
    ).stdout.strip()
    return int(round(float(out) * 1000))


def _silences(path: str) -> list[tuple[int, int]]:
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "info", "-i", path, "-af", "silencedetect=noise=-35dB:d=0.4", "-f", "null", "-"],
        capture_output=True, timeout=7200, check=False,
    )
    err = proc.stderr.decode("utf-8", "replace")
    starts = [float(x) for x in _SIL_START.findall(err)]
    ends = [float(x) for x in _SIL_END.findall(err)]
    return [(int(max(0.0, a) * 1000), int(b * 1000)) for a, b in zip(starts, ends, strict=False)]


def _cut(src: str, dst: str, start_ms: int, end_ms: int) -> None:
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", src, "-ss", f"{start_ms / 1000:.3f}", "-to", f"{end_ms / 1000:.3f}",
         "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", dst],
        check=True, timeout=3600,
    )


class LocalWhisper(AsrAdapter):
    asynchronous = False

    def __init__(self, name: str, model_setting: str, role: str):
        self.name = name
        self._model_setting = model_setting
        self._role = role

    def model_name(self) -> str:
        return str(getattr(get_settings(), self._model_setting))

    def decode_config(self) -> dict[str, Any]:
        s = get_settings()
        return {
            "language": "ar",
            "task": "transcribe",
            "beam_size": s.local_asr_beam_size,
            "word_timestamps": True,
            "vad_filter": False,
            "no_speech_threshold": None,
            "condition_on_previous_text": False,
            "initial_prompt": None,
            "temperature": TEMPERATURE,
            "windowing": {
                "version": WINDOWING_VERSION,
                "target_ms": s.local_asr_window_ms,
                "search_ms": s.local_asr_window_search_ms,
                "overlap_ms": s.local_asr_window_overlap_ms,
            },
        }

    def fingerprint_material(self) -> dict[str, Any]:
        s = get_settings()
        return {
            "engine": "faster-whisper",
            **_versions(),
            "model": self.model_name(),
            "model_revision": model_revision(self.model_name()),
            "device": "cpu",
            "compute_type": s.local_asr_compute_type,
            "decode": self.decode_config(),
        }

    def engine_fingerprint(self) -> str:
        blob = json.dumps(self.fingerprint_material(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(blob.encode()).hexdigest()

    def info(self, context: dict[str, Any] | None = None) -> ProviderInfo:
        s = get_settings()
        material = self.fingerprint_material()
        return ProviderInfo(
            self.name,
            self.model_name(),
            self._role,
            s.environment == "local" or s.asr_route == "self_hosted",
            {
                "runtime": "faster-whisper/CTranslate2",
                **{k: v for k, v in material.items() if k != "decode"},
                **{k: v for k, v in material["decode"].items()},
                "engine_fingerprint": self.engine_fingerprint(),
                "privacy_gate": "ON-DEVICE — audio is not transmitted",
            },
        )

    def _decode(self, model: Any, path: str, offset_s: float) -> dict[str, Any]:
        s = get_settings()
        segments, info = model.transcribe(
            path,
            language="ar",
            task="transcribe",
            beam_size=s.local_asr_beam_size,
            word_timestamps=True,
            vad_filter=False,
            no_speech_threshold=None,
            condition_on_previous_text=False,
            initial_prompt=None,
            temperature=TEMPERATURE,
        )
        out = []
        for seg in segments:  # generator: decoding happens here, 30 s at a time
            out.append(
                {
                    "id": seg.id,
                    "seek": seg.seek,
                    "start": seg.start + offset_s,
                    "end": seg.end + offset_s,
                    "text": seg.text,
                    "avg_logprob": seg.avg_logprob,
                    "compression_ratio": seg.compression_ratio,
                    "no_speech_prob": seg.no_speech_prob,
                    "temperature": seg.temperature,
                    "words": [
                        {"start": w.start + offset_s, "end": w.end + offset_s, "word": w.word, "probability": w.probability}
                        for w in (seg.words or [])
                    ],
                }
            )
        return {"language": info.language, "language_probability": info.language_probability, "duration_s": info.duration, "segments": out}

    def transcribe(self, audio_path: str, context: dict[str, Any]) -> Any:
        s = get_settings()
        if s.environment != "local" and s.asr_route != "self_hosted":
            raise ProviderError("Local Whisper runs only in ENVIRONMENT=local or on the self-hosted route.", retryable=False)
        s = get_settings()
        _language(context.get("language_locale"))
        progress: Callable[[int, int, int, int], None] | None = context.get("on_progress")
        should_yield: Callable[[], bool] | None = context.get("should_yield")
        yield_after: int | None = None
        started = time.monotonic()
        try:
            model = _model(self.model_name())
            fingerprint = self.engine_fingerprint()
            input_sha = _file_sha(audio_path)
            duration_ms = _duration_ms(audio_path)
            silences = _silences(audio_path) if duration_ms > s.local_asr_window_ms else []
            plan = plan_windows(duration_ms, silences, s.local_asr_window_ms, s.local_asr_window_search_ms, s.local_asr_window_overlap_ms)
            ckpt_dir = os.path.join(os.path.dirname(audio_path), "asr-checkpoints", self.name, f"{input_sha[:16]}-{fingerprint[:16]}")
            os.makedirs(ckpt_dir, mode=0o700, exist_ok=True)
            windows: list[dict[str, Any]] = []
            resumed = 0
            for w in plan:
                ckpt = os.path.join(ckpt_dir, f"window-{w['index']:04d}.json")
                data: dict[str, Any] | None = None
                if os.path.exists(ckpt):
                    try:
                        with open(ckpt, encoding="utf-8") as fh:
                            cand = json.load(fh)
                        if (
                            cand.get("input_sha256") == input_sha
                            and cand.get("engine_fingerprint") == fingerprint
                            and {k: cand.get(k) for k in w} == w
                        ):
                            data = cand
                            resumed += 1
                    except (OSError, ValueError):
                        data = None
                decoded_now = data is None
                if data is None:
                    t_window = time.monotonic()
                    if len(plan) == 1:
                        decoded = self._decode(model, audio_path, 0.0)
                    else:
                        clip = os.path.join(ckpt_dir, f"window-{w['index']:04d}.wav")
                        _cut(audio_path, clip, w["cut_start_ms"], w["cut_end_ms"])
                        decoded = self._decode(model, clip, w["cut_start_ms"] / 1000.0)
                        os.remove(clip)
                    data = {**w, **decoded, "input_sha256": input_sha, "engine_fingerprint": fingerprint, "decoded_at": time.time()}
                    tmp = f"{ckpt}.tmp"
                    with open(tmp, "w", encoding="utf-8") as fh:
                        json.dump(data, fh, ensure_ascii=False)
                        fh.flush()
                        os.fsync(fh.fileno())
                    os.replace(tmp, ckpt)
                    spent = time.monotonic() - t_window
                    audio_s = (w["cut_end_ms"] - w["cut_start_ms"]) / 1000.0
                    _log.info(
                        "%s window %d/%d decoded: %.1f s audio in %.1f s (RTF %.3f)",
                        self.name, w["index"] + 1, len(plan), audio_s, spent, spent / max(audio_s, 0.001),
                    )
                windows.append(data)
                if progress:
                    progress(len(windows), len(plan), w["own_end_ms"], duration_ms)
                if should_yield and decoded_now and len(windows) < len(plan) and should_yield():
                    # Long-job fairness: the finished window is checkpointed; let other queued
                    # work run and resume from the checkpoints afterwards.
                    yield_after = len(windows)
                    break
        except ProviderError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"Local Whisper failed: {type(exc).__name__}: {exc}", retryable=False) from exc
        if yield_after is not None:
            from ..pipeline.process import Wait

            _log.info("%s yielding after window %d/%d to other queued work", self.name, yield_after, len(plan))
            raise Wait(1.0, f"{self.name} yielded after window {yield_after}/{len(plan)}")
        first = windows[0] if windows else {}
        return {
            "model": self.model_name(),
            "engine_fingerprint": fingerprint,
            "fingerprint_material": self.fingerprint_material(),
            "input_sha256": input_sha,
            "language": first.get("language"),
            "language_probability": first.get("language_probability"),
            "audio_duration_s": duration_ms / 1000.0,
            "processing_seconds": round(time.monotonic() - started, 3),
            "windows": [
                {k: w[k] for k in ("index", "own_start_ms", "own_end_ms", "cut_start_ms", "cut_end_ms", "language", "duration_s")}
                | {"segments": len(w["segments"])}
                for w in windows
            ],
            "windows_resumed_from_checkpoint": resumed,
            "segments": merge_windows(windows),
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
                "windows": len(raw.get("windows") or []) or 1,
                "windows_resumed_from_checkpoint": raw.get("windows_resumed_from_checkpoint", 0),
            },
            "timestamp_source": "provider",
        }
