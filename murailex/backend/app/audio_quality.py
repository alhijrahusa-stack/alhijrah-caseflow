"""Audio quality classification (murailex.aq/1).

Measured once on the 16 kHz analysis copy with FFmpeg `astats` (one streaming pass, bounded
memory) plus the source container facts from ffprobe. Labels are deterministic functions of
the persisted metrics; every label carries the measurement that triggered it.

Quality never stops processing and never changes the ASR route by itself: route adaptation
requires held-out benchmark evidence, so the route stays on the benchmarked baseline and the
labels are surfaced to the reviewer.
"""
from __future__ import annotations

import math
import re
import subprocess
from typing import Any

VERSION = "murailex.aq/1"
_STAT = re.compile(r"^\[Parsed_astats_\d+ @ [^\]]+\] ([A-Za-z ]+): (.+)$")


def measure(analysis_wav: str) -> dict[str, float]:
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "info", "-i", analysis_wav, "-af", "astats=measure_perchannel=none:length=0.5", "-f", "null", "-"],
        capture_output=True, timeout=7200, check=False,
    )
    stats: dict[str, float] = {}
    overall = False
    for line in proc.stderr.decode("utf-8", "replace").splitlines():
        m = _STAT.match(line.strip())
        if line.rstrip().endswith("Overall"):
            overall = True
            continue
        if overall and m:
            try:
                value = float(m.group(2).split("/")[0])
            except ValueError:
                continue
            stats[m.group(1).strip()] = value
    return stats


def _finite(x: float | None, floor: float = -96.0) -> float:
    if x is None or math.isnan(x):
        return floor
    return max(floor, x) if math.isfinite(x) else floor


def classify(stats: dict[str, float], media: dict[str, Any]) -> dict[str, Any]:
    rms = _finite(stats.get("RMS level dB"))
    trough = _finite(stats.get("RMS trough dB"))
    peak = _finite(stats.get("Peak level dB"))
    samples = stats.get("Number of samples") or 0.0
    peak_count = stats.get("Peak count") or 0.0
    clip_ratio = (peak_count / samples) if samples and peak >= -0.1 else 0.0
    snr = rms - trough
    sample_rate = int(media.get("sample_rate") or 0)
    bit_rate = int(media.get("bit_rate") or 0)
    codec = str(media.get("codec") or "")
    lossless = codec.startswith("pcm") or codec in {"flac", "alac", "wavpack"}

    reasons: dict[str, str] = {}
    if rms < -35.0:
        reasons["LOW_VOLUME"] = f"mean RMS {rms:.1f} dBFS < -35 dBFS"
    if clip_ratio > 0.0005:
        reasons["CLIPPED"] = f"{clip_ratio * 100:.3f}% of samples at full scale (peak {peak:.2f} dBFS)"
    if 0 < sample_rate <= 8000:
        reasons["TELEPHONE"] = f"source sample rate {sample_rate} Hz (narrowband)"
    if not lossless and 0 < bit_rate < 32000:
        reasons["COMPRESSED"] = f"lossy {codec} at {bit_rate // 1000} kb/s"
    if snr < 10.0:
        reasons["HEAVY_NOISE"] = f"estimated SNR {snr:.1f} dB < 10 dB"
    elif snr < 20.0:
        reasons["NOISY"] = f"estimated SNR {snr:.1f} dB < 20 dB"
    problems = [k for k in reasons]
    if len(problems) >= 2:
        overall = "DEGRADED"
    elif problems:
        overall = problems[0]
    elif snr >= 30.0:
        overall = "CLEAN"
    else:
        overall = "ACCEPTABLE"
    return {
        "version": VERSION,
        "overall": overall,
        "labels": problems or [overall],
        "reasons": reasons,
        "metrics": {
            "rms_dbfs": round(rms, 2),
            "noise_floor_dbfs_est": round(trough, 2),
            "snr_db_est": round(snr, 2),
            "peak_dbfs": round(peak, 2),
            "clip_ratio": round(clip_ratio, 6),
            "source_sample_rate": sample_rate,
            "source_bit_rate": bit_rate,
            "source_codec": codec,
        },
        "not_assessed": {"OVERLAP": "requires speaker diarization (not available on this route)"},
        "route_adaptation": "none — baseline route retained; adaptation requires held-out benchmark evidence",
        "definitions": "SNR estimate = mean RMS − quietest 0.5 s RMS window (astats); clipping = full-scale sample occurrences / samples",
    }


def analyze(analysis_wav: str, media: dict[str, Any]) -> dict[str, Any]:
    return classify(measure(analysis_wav), media)
