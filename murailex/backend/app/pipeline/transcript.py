"""Transcript document model (revision.content) and pure editing operations."""
from __future__ import annotations

import copy
from typing import Any

from .text import UNCLEAR_MARKERS

SEGMENT_GAP_MS = 1500
SCHEMA = "murailex.transcript/1"


def speaker_map(raw_speakers: list[str | None]) -> dict[str, str]:
    """Map provider speaker ids to S1..Sn by first appearance (deterministic)."""
    mapping: dict[str, str] = {}
    for s in raw_speakers:
        if s is None or s in mapping:
            continue
        mapping[s] = f"S{len(mapping) + 1}"
    return mapping


def speaker_label(sid: str | None) -> str:
    if not sid:
        return "[متحدث غير محدد]"
    return f"[المتحدث {sid[1:]}]"


def build_items(
    columns: list[dict[str, Any]],
    accepted_columns: set[int],
    region_items: list[dict[str, Any]],
    silences: list[dict[str, int]],
    smap: dict[str, str],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for col in columns:
        if col["index"] not in accepted_columns:
            continue
        items.append(
            {
                "kind": "word",
                "text": col["text"],
                "start_ms": col["start_ms"],
                "end_ms": col["end_ms"],
                "speaker": smap.get(col["speaker_raw"]) if col["speaker_raw"] is not None else None,
                "risks": col["risks"],
                "source": "consensus",
                "provenance": col["provenance"],
            }
        )
    items.extend(region_items)
    occupied = [(i["start_ms"], i["end_ms"]) for i in items]
    for sil in silences:
        if any(s < sil["end_ms"] and e > sil["start_ms"] for s, e in occupied):
            continue
        items.append(
            {
                "kind": "marker",
                "text": UNCLEAR_MARKERS["silence"],
                "start_ms": sil["start_ms"],
                "end_ms": sil["end_ms"],
                "speaker": None,
                "risks": [],
                "source": "acoustic",
                "provenance": [{"method": "ffmpeg silencedetect", "noise_db": -35, "min_seconds": 2.0}],
            }
        )
    items.sort(key=lambda i: (i["start_ms"], i["end_ms"]))
    return items


def segment(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for it in items:
        spk = it["speaker"]
        standalone = it["kind"] == "marker" and spk is None  # acoustic silence stands alone
        if segments and not standalone and not segments[-1].get("_standalone"):
            cur = segments[-1]
            same = spk is None or cur["speaker"] is None or spk == cur["speaker"]
            if same and it["start_ms"] - cur["end_ms"] <= SEGMENT_GAP_MS:
                cur["items"].append(it)
                cur["end_ms"] = max(cur["end_ms"], it["end_ms"])
                if cur["speaker"] is None:
                    cur["speaker"] = spk
                continue
        segments.append({"speaker": spk, "start_ms": it["start_ms"], "end_ms": it["end_ms"], "items": [it], "_standalone": standalone})
    for n, seg in enumerate(segments, start=1):
        seg["id"] = f"seg-{n:05d}"
        seg.pop("_standalone", None)
    return segments


def new_content(recording: dict[str, Any], segments: list[dict[str, Any]], speakers: list[str], method: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": SCHEMA,
        "title": "MURAILEX FORENSIC VERBATIM TRANSCRIPT",
        "controlling_source": "The original audio recording is the controlling source.",
        "recording": recording,
        "speakers": {sid: {"label": speaker_label(sid), "verified_name": None, "verified_by": None, "verified_at": None} for sid in speakers},
        "segments": segments,
        "method": method,
    }


def segment_text(seg: dict[str, Any]) -> str:
    parts = []
    for it in seg["items"]:
        if it["kind"] == "dispute":
            parts.append("⟦UNRESOLVED⟧")
        else:
            parts.append(it["text"])
    return " ".join(p for p in parts if p)


def open_dispute_ids(content: dict[str, Any]) -> list[str]:
    return [it["dispute_id"] for seg in content["segments"] for it in seg["items"] if it["kind"] == "dispute"]


def _find_dispute(content: dict[str, Any], dispute_id: str) -> tuple[dict[str, Any], int]:
    for seg in content["segments"]:
        for i, it in enumerate(seg["items"]):
            if it["kind"] == "dispute" and it["dispute_id"] == dispute_id:
                return seg, i
    raise KeyError(dispute_id)


def resolve_dispute(content: dict[str, Any], dispute_id: str, replacement: list[dict[str, Any]]) -> dict[str, Any]:
    out = copy.deepcopy(content)
    seg, i = _find_dispute(out, dispute_id)
    seg["items"][i : i + 1] = replacement
    return out


def replace_segment_text(content: dict[str, Any], segment_id: str, text: str, actor: str) -> tuple[dict[str, Any], str]:
    out = copy.deepcopy(content)
    for seg in out["segments"]:
        if seg["id"] == segment_id:
            if any(it["kind"] == "dispute" for it in seg["items"]):
                raise ValueError("Resolve the open dispute in this segment first.")
            before = segment_text(seg)
            seg["items"] = [
                {
                    "kind": "word",
                    "text": text,
                    "start_ms": seg["start_ms"],
                    "end_ms": seg["end_ms"],
                    "speaker": seg["speaker"],
                    "risks": [],
                    "source": "human",
                    "provenance": [{"method": "type_exactly_what_i_hear", "by": actor, "replaced": before}],
                }
            ]
            return out, before
    raise KeyError(segment_id)


def set_segment_speaker(content: dict[str, Any], segment_id: str, speaker: str) -> tuple[dict[str, Any], str | None]:
    if speaker not in content["speakers"]:
        raise ValueError("Unknown speaker.")
    out = copy.deepcopy(content)
    for seg in out["segments"]:
        if seg["id"] == segment_id:
            before = seg["speaker"]
            seg["speaker"] = speaker
            for it in seg["items"]:
                it["speaker"] = speaker
            return out, before
    raise KeyError(segment_id)


def add_speaker(content: dict[str, Any]) -> tuple[dict[str, Any], str]:
    out = copy.deepcopy(content)
    n = 1
    while f"S{n}" in out["speakers"]:
        n += 1
    sid = f"S{n}"
    out["speakers"][sid] = {"label": speaker_label(sid), "verified_name": None, "verified_by": None, "verified_at": None}
    return out, sid


def verify_speaker_name(content: dict[str, Any], sid: str, name: str | None, actor: str, when: str) -> dict[str, Any]:
    out = copy.deepcopy(content)
    if sid not in out["speakers"]:
        raise KeyError(sid)
    out["speakers"][sid].update(
        {"verified_name": name or None, "verified_by": actor if name else None, "verified_at": when if name else None}
    )
    return out


def plain_lines(content: dict[str, Any], *, show_names: bool = True) -> list[tuple[str, str, str]]:
    """(timestamp, speaker label, text) per segment, for exports."""
    lines = []
    for seg in content["segments"]:
        sid = seg["speaker"]
        label = speaker_label(sid)
        info = content["speakers"].get(sid or "", {})
        if show_names and info.get("verified_name"):
            label = f"{label} ({info['verified_name']} — verified by {info['verified_by']})"
        lines.append((fmt_ts(seg["start_ms"]), label, segment_text(seg)))
    return lines


def fmt_ts(ms: int) -> str:
    s, milli = divmod(int(ms), 1000)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{sec:02d}.{milli:03d}"
