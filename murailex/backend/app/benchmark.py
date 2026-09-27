"""Forensic benchmark primitives.

This module measures quality only against externally produced human ground truth. It never
creates, repairs, or infers a reference transcript. Measurement normalization is isolated
from evidence text and is used only to compute explicitly labelled normalized metrics.
"""
from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

_ARABIC_DIACRITICS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")
_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[^\w\s\u0600-\u06ff]", re.UNICODE)


def measurement_normalize(text: str) -> str:
    """Conservative comparison-only normalization; never use for canonical evidence."""
    value = text.strip().lower()
    value = _ARABIC_DIACRITICS.sub("", value)
    value = _PUNCT.sub(" ", value)
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


def critical_entity_accuracy(
    reference: list[dict[str, str]], hypothesis: list[dict[str, str]]
) -> dict[str, Any]:
    """Exact typed entity accuracy. Inputs must be human-annotated/reference-extracted records."""

    def key(row: dict[str, str]) -> tuple[str, str]:
        return (str(row["type"]).strip(), str(row["text"]).strip())

    ref = Counter(key(row) for row in reference)
    hyp = Counter(key(row) for row in hypothesis)
    total = sum(ref.values())
    if total == 0:
        raise ValueError("No human-ground-truth critical entities are available.")
    matched = sum(min(count, hyp[item]) for item, count in ref.items())
    by_type: dict[str, dict[str, int | float]] = {}
    for entity_type in sorted({item[0] for item in ref}):
        type_total = sum(count for (kind, _), count in ref.items() if kind == entity_type)
        type_matched = sum(
            min(count, hyp[(kind, text)])
            for (kind, text), count in ref.items()
            if kind == entity_type
        )
        by_type[entity_type] = {
            "matched": type_matched,
            "reference": type_total,
            "accuracy": type_matched / type_total,
        }
    return {
        "matched": matched,
        "reference": total,
        "accuracy": matched / total,
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
