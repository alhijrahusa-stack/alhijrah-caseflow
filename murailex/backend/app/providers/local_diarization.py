"""On-device speaker diarization (ENVIRONMENT=local).

sherpa-onnx runs pyannote segmentation-3.0 (MIT) for speech/speaker-change/overlap frames and
WeSpeaker ResNet34 (VoxCeleb, CC-BY-4.0) embeddings, then clusters them. No audio leaves the
machine. Labels are anonymous (SPEAKER_00, …); naming a speaker stays a human act.

The route identity (engine fingerprint) covers the sherpa-onnx version, the SHA-256 of both
model files and the clustering/duration settings, so any change re-triggers the real
self-test before the route is READY again.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
import wave
from functools import lru_cache
from typing import Any

from ..config import get_settings
from .base import DiarizationAdapter, ProviderError, ProviderInfo

log = logging.getLogger("murailex.diar")
SEGMENTATION = "sherpa-onnx-pyannote-segmentation-3-0/model.onnx"
EMBEDDING = "wespeaker_en_voxceleb_resnet34_LM.onnx"
MODEL = "pyannote-segmentation-3.0+wespeaker-resnet34-voxceleb"
_lock = threading.Lock()


def _path(name: str) -> str:
    return os.path.join(get_settings().local_diar_dir, name)


def installed() -> bool:
    base = get_settings().local_diar_dir
    return bool(base) and os.path.isfile(_path(SEGMENTATION)) and os.path.isfile(_path(EMBEDDING))


@lru_cache(maxsize=8)
def _file_sha(path: str, mtime: float) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _sha(name: str) -> str:
    path = _path(name)
    return _file_sha(path, os.path.getmtime(path)) if os.path.isfile(path) else "missing"


def _version() -> str:
    try:
        import sherpa_onnx

        return str(getattr(sherpa_onnx, "__version__", "unknown"))
    except Exception:  # noqa: BLE001
        return "not-installed"


def read_pcm16_mono_16k(path: str):
    """Read the 16 kHz mono PCM analysis copy straight into float32 (bounded: 4 bytes/sample)."""
    import numpy as np

    with wave.open(path, "rb") as w:
        if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ProviderError("Diarization requires the 16 kHz mono PCM analysis copy.", retryable=False)
        n = w.getnframes()
        out = np.empty(n, dtype=np.float32)
        pos = 0
        while pos < n:
            block = np.frombuffer(w.readframes(min(1 << 20, n - pos)), dtype=np.int16)
            out[pos : pos + len(block)] = block
            pos += len(block)
            if not len(block):
                break
    out[:pos] *= 1.0 / 32768.0
    return out[:pos]


class LocalDiarization(DiarizationAdapter):
    name = "local_diarization"
    asynchronous = False

    def fingerprint_material(self) -> dict[str, Any]:
        s = get_settings()
        return {
            "engine": "sherpa-onnx",
            "sherpa_onnx": _version(),
            "segmentation_sha256": _sha(SEGMENTATION),
            "embedding_sha256": _sha(EMBEDDING),
            "clustering": "fast-agglomerative",
            "threshold": s.local_diar_threshold,
            "min_duration_on_s": s.local_diar_min_on_s,
            "min_duration_off_s": s.local_diar_min_off_s,
            "device": "cpu",
        }

    def engine_fingerprint(self) -> str:
        blob = json.dumps(self.fingerprint_material(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(blob.encode()).hexdigest()

    def info(self, context: dict[str, Any] | None = None) -> ProviderInfo:
        s = get_settings()
        return ProviderInfo(
            self.name,
            MODEL,
            "diarization",
            s.environment == "local" and installed(),
            {
                "runtime": "sherpa-onnx (onnxruntime, CPU)",
                **self.fingerprint_material(),
                "engine_fingerprint": self.engine_fingerprint(),
                "privacy_gate": "ON-DEVICE — audio is not transmitted",
                "licenses": "segmentation MIT (CNRS); embeddings CC-BY-4.0 (WeSpeaker/VoxCeleb)",
            },
        )

    def _diarizer(self, num_clusters: int):
        import sherpa_onnx

        s = get_settings()
        threads = max(1, (os.cpu_count() or 2) - 1)
        cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
            segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
                pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=_path(SEGMENTATION)),
                num_threads=threads,
            ),
            embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=_path(EMBEDDING), num_threads=threads),
            clustering=sherpa_onnx.FastClusteringConfig(num_clusters=num_clusters, threshold=s.local_diar_threshold),
            min_duration_on=s.local_diar_min_on_s,
            min_duration_off=s.local_diar_min_off_s,
        )
        if not cfg.validate():
            raise ProviderError("On-device diarization configuration is invalid.", retryable=False)
        return sherpa_onnx.OfflineSpeakerDiarization(cfg)

    def transcribe(self, audio_path: str, context: dict[str, Any]) -> Any:
        if not installed():
            raise ProviderError("On-device diarization models are not installed.", retryable=False)
        expected = context.get("expected_speakers")
        num_clusters = int(expected) if isinstance(expected, int) and expected > 0 else -1
        samples = read_pcm16_mono_16k(audio_path)
        seconds = len(samples) / 16000
        on_progress = context.get("on_progress")
        last = [0.0]

        def callback(done: int, total: int) -> int:
            now = time.monotonic()
            if on_progress and total and now - last[0] > 5:
                last[0] = now
                on_progress(1, 1, int(min(done / total, 1.0) * seconds * 1000), int(seconds * 1000))
            return 0

        t0 = time.monotonic()
        with _lock:
            result = self._diarizer(num_clusters).process(samples, callback=callback).sort_by_start_time()
        spent = time.monotonic() - t0
        del samples
        turns = [
            {"speaker": f"SPEAKER_{int(seg.speaker):02d}", "start": round(seg.start * 1000), "end": round(seg.end * 1000)}
            for seg in result
        ]
        log.info("local_diarization: %.1f s audio in %.1f s (RTF %.3f), %d turns, %d speakers",
                 seconds, spent, spent / seconds if seconds else 0, len(turns), len({t["speaker"] for t in turns}))
        return {
            "turns": turns,
            "num_clusters_requested": num_clusters,
            "audio_seconds": round(seconds, 3),
            "inference_seconds": round(spent, 3),
            "engine_fingerprint": self.engine_fingerprint(),
        }

    def normalize(self, raw: Any) -> dict[str, Any]:
        return {
            "turns": [
                {"speaker": t["speaker"], "start_ms": int(t["start"]), "end_ms": int(t["end"]), "confidence": None}
                for t in raw["turns"]
                if int(t["end"]) > int(t["start"])
            ]
        }
