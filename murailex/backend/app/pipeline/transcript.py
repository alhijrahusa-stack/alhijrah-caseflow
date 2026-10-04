"""Transcript document model (revision.content) and pure editing operations."""
from __future__ import annotations

import copy
from typing import Any

from .text import UNCLEAR_MARKERS

SEGMENT_GAP_MS = 1500
# Readability bounds: a paragraph that has run this long starts a new one at the next
# natural pause (or unconditionally at the hard cap). Only paragraph boundaries change;
# no item is altered, merged, reordered or dropped.
SEGMENT_SOFT_MAX_MS = 20000
SEGMENT_PAUSE_MS = 300
SEGMENT_HARD_MAX_MS = 40000
SCHEMA = "murailex.transcript/2"


def speaker_map(raw_speakers: list[str | None]) -> dict[str, str]:
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


def _item_state(item: dict[str, Any]) -> str:
    if item.get("kind") == "dispute":
        return "DISPUTED"
    if item.get("source") in {"human", "reviewer_accepted_candidate"}:
        return "HUMAN VERIFIED"
    if "overlap" in set(item.get("risks") or []):
        return "OVERLAP"
    if item.get("source") == "consensus":
        return "CONSENSUS"
    return "CONSENSUS"


def _refresh_segment(seg: dict[str, Any]) -> None:
    items = seg.get("items") or []
    states = [_item_state(i) for i in items]
    if "DISPUTED" in states:
        state = "UNRESOLVED"
    elif "HUMAN VERIFIED" in states:
        state = "HUMAN VERIFIED"
    elif "OVERLAP" in states:
        state = "OVERLAP"
    else:
        state = "CONSENSUS"
    seg["review_state"] = state
    seg["provenance"] = [p for i in items for p in (i.get("provenance") or [])]


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
        items.append({
            "kind": "word",
            "text": col["text"],
            "start_ms": col["start_ms"],
            "end_ms": col["end_ms"],
            "speaker": smap.get(col["speaker_raw"]) if col["speaker_raw"] is not None else None,
            "risks": col["risks"],
            "source": "consensus",
            "review_state": "CONSENSUS",
            "provenance": col["provenance"],
        })
    for item in region_items:
        item.setdefault("review_state", "DISPUTED" if item.get("kind") == "dispute" else _item_state(item))
        items.append(item)
    occupied = [(i["start_ms"], i["end_ms"]) for i in items]
    for sil in silences:
        if any(s < sil["end_ms"] and e > sil["start_ms"] for s, e in occupied):
            continue
        items.append({
            "kind": "marker",
            "text": UNCLEAR_MARKERS["silence"],
            "start_ms": sil["start_ms"],
            "end_ms": sil["end_ms"],
            "speaker": None,
            "risks": [],
            "source": "acoustic",
            "review_state": "CONSENSUS",
            "provenance": [{"method": "ffmpeg silencedetect", "noise_db": -35, "min_seconds": 2.0}],
        })
    items.sort(key=lambda i: (i["start_ms"], i["end_ms"]))
    return items


def segment(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for it in items:
        spk = it["speaker"]
        standalone = it["kind"] == "marker" and spk is None
        if segments and not standalone and not segments[-1].get("_standalone"):
            cur = segments[-1]
            same = spk is None or cur["speaker"] is None or spk == cur["speaker"]
            gap = it["start_ms"] - cur["end_ms"]
            length = it["end_ms"] - cur["start_ms"]
            too_long = length > SEGMENT_HARD_MAX_MS or (
                cur["end_ms"] - cur["start_ms"] >= SEGMENT_SOFT_MAX_MS and gap >= SEGMENT_PAUSE_MS
            )
            if same and gap <= SEGMENT_GAP_MS and not too_long:
                cur["items"].append(it)
                cur["end_ms"] = max(cur["end_ms"], it["end_ms"])
                if cur["speaker"] is None:
                    cur["speaker"] = spk
                continue
        segments.append({
            "speaker": spk,
            "start_ms": it["start_ms"],
            "end_ms": it["end_ms"],
            "items": [it],
            "_standalone": standalone,
        })
    for n, seg in enumerate(segments, start=1):
        seg["id"] = f"seg-{n:05d}"
        seg["revision_id"] = None
        seg.pop("_standalone", None)
        _refresh_segment(seg)
    return segments


def bind_revision(content: dict[str, Any], revision_id: str) -> dict[str, Any]:
    out = copy.deepcopy(content)
    for seg in out.get("segments", []):
        seg["revision_id"] = revision_id
        _refresh_segment(seg)
    return out


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
    for item in replacement:
        item["review_state"] = "HUMAN VERIFIED"
    seg["items"][i : i + 1] = replacement
    _refresh_segment(seg)
    return out


def replace_segment_text(content: dict[str, Any], segment_id: str, text: str, actor: str) -> tuple[dict[str, Any], str]:
    out = copy.deepcopy(content)
    for seg in out["segments"]:
        if seg["id"] == segment_id:
            if any(it["kind"] == "dispute" for it in seg["items"]):
                raise ValueError("Resolve the open dispute in this segment first.")
            before = segment_text(seg)
            seg["items"] = [{
                "kind": "word",
                "text": text,
                "start_ms": seg["start_ms"],
                "end_ms": seg["end_ms"],
                "speaker": seg["speaker"],
                "risks": [],
                "source": "human",
                "review_state": "HUMAN VERIFIED",
                "provenance": [{"method": "type_exactly_what_i_hear", "by": actor, "replaced": before}],
            }]
            _refresh_segment(seg)
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
            _refresh_segment(seg)
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
    out["speakers"][sid].update({
        "verified_name": name or None,
        "verified_by": actor if name else None,
        "verified_at": when if name else None,
    })
    return out


def plain_lines(content: dict[str, Any], *, show_names: bool = True) -> list[tuple[str, str, str]]:
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
