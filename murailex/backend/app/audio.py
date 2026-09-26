"""FFmpeg/FFprobe helpers. Every function operates on derived working copies only.

The original evidence object is downloaded to a private temporary file and read,
never written; derived files are produced alongside it and hashed separately.
"""
from __future__ import annotations

import array
import json
import os
import re
import subprocess
from typing import Any

FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN", "ffprobe")

AUDIO_MAGIC: list[tuple[bytes, int, str]] = [
    (b"RIFF", 0, "audio/wav"),
    (b"ID3", 0, "audio/mpeg"),
    (b"\xff\xfb", 0, "audio/mpeg"),
    (b"\xff\xf3", 0, "audio/mpeg"),
    (b"\xff\xf2", 0, "audio/mpeg"),
    (b"\xff\xf1", 0, "audio/aac"),
    (b"\xff\xf9", 0, "audio/aac"),
    (b"fLaC", 0, "audio/flac"),
    (b"OggS", 0, "audio/ogg"),
    (b"\x1aE\xdf\xa3", 0, "audio/webm"),
    (b"ftyp", 4, "audio/mp4"),
    (b"#!AMR", 0, "audio/amr"),
    (b"FORM", 0, "audio/aiff"),
    (b"0&\xb2u\x8ef\xcf\x11", 0, "audio/x-ms-wma"),
]

ALLOWED_EXTENSIONS = {
    ".wav", ".mp3", ".m4a", ".mp4", ".aac", ".flac", ".ogg", ".oga", ".opus", ".webm", ".amr", ".aiff", ".aif",
    ".wma", ".3gp", ".caf", ".mov",
}


def sniff_mime(head: bytes) -> str | None:
    for magic, offset, mime in AUDIO_MAGIC:
        if head[offset : offset + len(magic)] == magic:
            return mime
    if head[:4] == b"caff":
        return "audio/x-caf"
    return None


def _run(args: list[str], timeout: int = 3600) -> subprocess.CompletedProcess[bytes]:
    proc = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    if proc.returncode != 0:
        tail = proc.stderr.decode("utf-8", "replace")[-800:]
        raise RuntimeError(f"{os.path.basename(args[0])} failed: {tail}")
    return proc


def probe(path: str) -> dict[str, Any]:
    proc = _run([FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], 300)
    data = json.loads(proc.stdout)
    streams = [s for s in data.get("streams", []) if s.get("codec_type") == "audio"]
    if not streams:
        raise ValueError("No audio stream found.")
    s = streams[0]
    duration = float(data.get("format", {}).get("duration") or s.get("duration") or 0)
    return {
        "duration_ms": int(round(duration * 1000)),
        "codec": s.get("codec_name"),
        "sample_rate": int(s.get("sample_rate") or 0),
        "channels": int(s.get("channels") or 0),
        "format_name": data.get("format", {}).get("format_name"),
        "bit_rate": int(data.get("format", {}).get("bit_rate") or 0),
        "audio_streams": len(streams),
    }


def derive_analysis_wav(src: str, dst: str) -> None:
    """16 kHz mono PCM WAV — the provider/analysis working copy."""
    _run([FFMPEG, "-nostdin", "-y", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", dst])


def derive_flac(src_wav: str, dst: str) -> None:
    _run([FFMPEG, "-nostdin", "-y", "-v", "error", "-i", src_wav, "-c:a", "flac", dst])


def derive_playback(src: str, dst: str) -> None:
    """Browser-compatible playback copy (AAC/M4A). Labelled as derived in the UI."""
    _run([FFMPEG, "-nostdin", "-y", "-v", "error", "-i", src, "-vn", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dst])


def cut_segment(src_wav: str, dst: str, start_ms: int, end_ms: int) -> None:
    start = max(0, start_ms) / 1000.0
    dur = max(0.05, (end_ms - max(0, start_ms)) / 1000.0)
    _run([FFMPEG, "-nostdin", "-y", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", src_wav, "-c:a", "pcm_s16le", "-ac", "1", "-ar", "16000", dst])


_SIL_START = re.compile(r"silence_start: (-?[\d.]+)")
_SIL_END = re.compile(r"silence_end: (-?[\d.]+)")


def detect_silences(src_wav: str, min_seconds: float = 2.0, noise_db: int = -35) -> list[dict[str, int]]:
    proc = subprocess.run(
        [FFMPEG, "-nostdin", "-v", "info", "-i", src_wav, "-af", f"silencedetect=noise={noise_db}dB:d={min_seconds}", "-f", "null", "-"],
        capture_output=True, timeout=3600, check=False,
    )
    out = proc.stderr.decode("utf-8", "replace")
    starts = [float(m) for m in _SIL_START.findall(out)]
    ends = [float(m) for m in _SIL_END.findall(out)]
    result = []
    for i, st in enumerate(starts):
        en = ends[i] if i < len(ends) else None
        if en is None:
            continue
        result.append({"start_ms": int(max(0.0, st) * 1000), "end_ms": int(en * 1000)})
    return result


def waveform_peaks(src_wav: str, points_per_second: int = 50) -> dict[str, Any]:
    """Peak envelope computed from the 16 kHz analysis copy (display only)."""
    proc = subprocess.run(
        [FFMPEG, "-nostdin", "-v", "error", "-i", src_wav, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
        capture_output=True, timeout=3600, check=True,
    )
    samples = array.array("h")
    samples.frombytes(proc.stdout[: len(proc.stdout) - (len(proc.stdout) % 2)])
    step = max(1, 8000 // points_per_second)
    peaks = []
    for i in range(0, len(samples), step):
        window = samples[i : i + step]
        peaks.append(round(max(abs(min(window)), abs(max(window))) / 32768.0, 4) if len(window) else 0.0)
    return {"points_per_second": points_per_second, "peaks": peaks}
