"""Forensic benchmark primitives.

This module measures quality only against externally produced human ground truth. It never
creates, repairs, or infers a reference transcript. Measurement normalization is isolated
from evidence text and is used only to compute explicitly labelled normalized metrics.
"""
from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

_ARABIC_DIACRITICS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")
_WS = re.compile(r"\s+")


def measurement_normalize(text: str) -> str:
    """Conservative comparison-only normalization; never use for canonical evidence."""
    value = text.strip().lower()
    value = _ARABIC_DIACRITICS.sub("", value)
    value = "".join(" " if unicodedata.category(ch).startswith("P") else ch for ch in value)
    return _WS.sub(" ", value).strip()


def _distance(reference: list[str], hypothesis: list[str]) -> tuple[int, int, int]:
    """Return substitutions, deletions, insertions using deterministic Levenshtein DP."""
    rows = len(reference) + 1
    cols = len(hypothesis) + 1
    dp: list[list[tuple[int, int, int, int]]] = [
        [(0, 0, 0, 0) for _ in range(cols)] for _ in range(rows)
    ]
    for i in range(1, rows):
        dp[i][0] = (i, 0, i, 0)
    for j in range(1, cols):
        dp[0][j] = (j, 0, 0, j)
    for i in range(1, rows):
        for j in range(1, cols):
            if reference[i - 1] == hypothesis[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
                continue
            sub = dp[i - 1][j - 1]
            delete = dp[i - 1][j]
            insert = dp[i][j - 1]
            candidates = [
                (sub[0] + 1, sub[1] + 1, sub[2], sub[3]),
                (delete[0] + 1, delete[1], delete[2] + 1, delete[3]),
                (insert[0] + 1, insert[1], insert[2], insert[3] + 1),
            ]
            dp[i][j] = min(candidates)
    _, substitutions, deletions, insertions = dp[-1][-1]
    return substitutions, deletions, insertions


def error_rate(reference: Iterable[str], hypothesis: Iterable[str]) -> dict[str, Any]:
    ref = list(reference)
    hyp = list(hypothesis)
    if not ref:
        raise ValueError("Human ground truth contains zero reference units; metric is undefined.")
    substitutions, deletions, insertions = _distance(ref, hyp)
    errors = substitutions + deletions + insertions
    return {
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
        "reference_units": len(ref),
        "errors": errors,
        "rate": errors / len(ref),
    }


def score_transcript(reference: str, hypothesis: str) -> dict[str, Any]:
    """Return raw and comparison-normalized WER/CER without altering either source string."""
    raw_words = error_rate(reference.split(), hypothesis.split())
    raw_chars = error_rate(list(reference), list(hypothesis))
    nref = measurement_normalize(reference)
    nhyp = measurement_normalize(hypothesis)
    normalized_words = error_rate(nref.split(), nhyp.split())
    normalized_chars = error_rate(list(nref), list(nhyp))
    return {
        "raw_wer": raw_words,
        "normalized_wer": normalized_words,
        "raw_cer": raw_chars,
        "normalized_cer": normalized_chars,
        "normalization_scope": "measurement_only",
    }


_DIGIT_FOLD = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_NUMBER = re.compile(r"\d+(?:[.,٫٬]\d+)*")
_ARABIC_FOLD = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي", "ـ": None})
ENTITY_EXTRACTION_VERSION = "murailex.entities.numeric/1"
FUZZY_MATCH_VERSION = "murailex.fuzzy/1"
FUZZY_THRESHOLD = 0.85


def extract_numeric_entities(text: str) -> list[dict[str, str]]:
    """Rule-based numeric entities (digit sequences) exactly as written in the text.

    Applied identically to the human reference and to the hypothesis; numbers spelled out in
    words are not extracted, so a hypothesis that spells out a reference number is a miss.
    """
    folded = unicodedata.normalize("NFKC", text).translate(_DIGIT_FOLD)
    return [{"type": "number", "text": m.group(0)} for m in _NUMBER.finditer(folded)]


def fuzzy_key(entity_type: str, text: str) -> str:
    """Comparison-only key: NFKC, digits folded, separators dropped for numbers, Arabic letter
    variants folded, diacritics and punctuation removed. Never applied to evidence text."""
    value = unicodedata.normalize("NFKC", text).translate(_DIGIT_FOLD)
    if entity_type in {"number", "money", "date", "time", "percent"}:
        return "".join(ch for ch in value if ch.isdigit())
    return measurement_normalize(value).translate(_ARABIC_FOLD)


def similarity(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    s, d, i = _distance(list(a), list(b))
    return 1.0 - (s + d + i) / max(len(a), len(b))


def _match_counts(ref: list[dict[str, str]], hyp: list[dict[str, str]], mode: str) -> dict[str, list[int]]:
    """Per-group (item), per-type one-to-one matching. exact: identical typed text.
    fuzzy: identical fuzzy key, else greedy best similarity >= FUZZY_THRESHOLD for
    non-numeric types (numbers never match approximately)."""
    by_group: dict[str, tuple[list, list]] = {}
    for row in ref:
        by_group.setdefault(str(row.get("item_id", "")), ([], []))[0].append(row)
    for row in hyp:
        by_group.setdefault(str(row.get("item_id", "")), ([], []))[1].append(row)
    out: dict[str, list[int]] = {}
    for refs, hyps in by_group.values():
        pool = [(str(h["type"]).strip(), str(h["text"]).strip()) for h in hyps]
        used = [False] * len(pool)
        for r in refs:
            kind, text = str(r["type"]).strip(), str(r["text"]).strip()
            counts = out.setdefault(kind, [0, 0])
            counts[1] += 1
            hit = -1
            for j, (hk, ht) in enumerate(pool):
                if used[j] or hk != kind:
                    continue
                if ht == text or (mode == "fuzzy" and fuzzy_key(kind, ht) == fuzzy_key(kind, text)):
                    hit = j
                    break
            if hit < 0 and mode == "fuzzy" and kind not in {"number", "money", "date", "time", "percent"}:
                best = FUZZY_THRESHOLD
                for j, (hk, ht) in enumerate(pool):
                    if used[j] or hk != kind:
                        continue
                    score = similarity(fuzzy_key(kind, ht), fuzzy_key(kind, text))
                    if score >= best:
                        best, hit = score, j
            if hit >= 0:
                used[hit] = True
                counts[0] += 1
    return out


def critical_entity_accuracy(
    reference: list[dict[str, str]], hypothesis: list[dict[str, str]]
) -> dict[str, Any]:
    """Typed entity accuracy (exact, plus a separately labelled fuzzy figure). Reference
    entities must be human-annotated or extracted from the human reference. Entities carrying
    an item_id are only matched within the same item."""
    exact = _match_counts(reference, hypothesis, "exact")
    total = sum(v[1] for v in exact.values())
    if total == 0:
        raise ValueError("No human-ground-truth critical entities are available.")
    fuzzy = _match_counts(reference, hypothesis, "fuzzy")
    matched = sum(v[0] for v in exact.values())
    fuzzy_matched = sum(v[0] for v in fuzzy.values())
    by_type: dict[str, dict[str, int | float]] = {}
    for entity_type in sorted(exact):
        m, t = exact[entity_type]
        by_type[entity_type] = {
            "matched": m,
            "reference": t,
            "accuracy": m / t,
            "fuzzy_matched": fuzzy[entity_type][0],
            "fuzzy_accuracy": fuzzy[entity_type][0] / t,
        }
    return {
        "matched": matched,
        "reference": total,
        "accuracy": matched / total,
        "fuzzy": {"version": FUZZY_MATCH_VERSION, "threshold": FUZZY_THRESHOLD, "matched": fuzzy_matched, "accuracy": fuzzy_matched / total},
        "by_type": by_type,
    }


def rtf(
    processing_seconds: float, audio_seconds: float, measurement_type: str
) -> dict[str, float | str]:
    if audio_seconds <= 0:
        raise ValueError("audio_seconds must be greater than zero")
    if processing_seconds < 0:
        raise ValueError("processing_seconds cannot be negative")
    allowed = {"self_hosted_inference", "cloud_service", "end_to_end"}
    if measurement_type not in allowed:
        raise ValueError(f"measurement_type must be one of {sorted(allowed)}")
    value = processing_seconds / audio_seconds
    return {
        "measurement_type": measurement_type,
        "rtf": value,
        "x_realtime": float("inf") if value == 0 else 1.0 / value,
    }


@dataclass(frozen=True)
class BenchmarkItem:
    item_id: str
    split: str
    audio_sha256: str
    locale: str
    ground_truth: str
    ground_truth_revision: str
    ground_truth_reviewer: str
    human_ground_truth: bool


def validate_corpus(items: list[BenchmarkItem]) -> None:
    if not items:
        raise ValueError("Benchmark corpus is empty.")
    allowed_splits = {"development", "held_out"}
    seen_audio: dict[str, str] = {}
    splits = set()
    for item in items:
        if item.split not in allowed_splits:
            raise ValueError(f"Invalid split for {item.item_id}: {item.split}")
        if not item.human_ground_truth:
            raise ValueError(f"{item.item_id}: WER/CER forbidden without human ground truth.")
        if not item.ground_truth_reviewer.strip() or not item.ground_truth_revision.strip():
            raise ValueError(f"{item.item_id}: reviewer and ground-truth revision are required.")
        if not re.fullmatch(r"[0-9a-f]{64}", item.audio_sha256):
            raise ValueError(f"{item.item_id}: invalid audio SHA-256.")
        other = seen_audio.get(item.audio_sha256)
        if other is not None and other != item.split:
            raise ValueError(f"Data leakage: audio {item.audio_sha256} occurs in both splits.")
        seen_audio[item.audio_sha256] = item.split
        splits.add(item.split)
    if splits != allowed_splits:
        raise ValueError("Both development and held_out splits are required.")


def aggregate_scores(scores: list[dict[str, Any]]) -> dict[str, Any]:
    """Micro-average edit counts so long and short recordings are weighted by reference units."""
    if not scores:
        raise ValueError("No benchmark scores supplied.")
    out: dict[str, Any] = {}
    for metric in ("raw_wer", "normalized_wer", "raw_cer", "normalized_cer"):
        totals = {
            "substitutions": 0,
            "deletions": 0,
            "insertions": 0,
            "reference_units": 0,
            "errors": 0,
        }
        for row in scores:
            part = row[metric]
            for key in totals:
                totals[key] += int(part[key])
        if totals["reference_units"] <= 0:
            raise ValueError(f"{metric} has zero reference units.")
        out[metric] = {
            **totals,
            "rate": totals["errors"] / totals["reference_units"],
        }
    out["normalization_scope"] = "measurement_only"
    return out
