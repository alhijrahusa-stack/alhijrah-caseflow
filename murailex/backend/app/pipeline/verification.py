"""Independent full-pass cross-verification and Verification Confidence (versioned).

Every primary ASR token is aligned against an independent verifier's full-recording pass with
the same deterministic, time-constrained aligner used for consensus. A primary token is
CROSS_VERIFIED only when the verifier produced the same comparison key within the alignment
tolerance. Nothing is chosen by plausibility; disagreement never changes the text, it only
marks the token as not independently verified.

VERIFICATION_CONFIDENCE (murailex.vc/1) = cross-verified primary tokens / primary tokens.
It is a measured agreement rate between two independent engines on this recording, not an
accuracy against ground truth.
"""
from __future__ import annotations

from typing import Any

from .align import align
from .text import match_key

VERSION = "murailex.vc/1"
COVERAGE_VERSION = "murailex.coverage/1"
COVERAGE_MERGE_MS = 1500
COVERAGE_MIN_WORDS = 2
COVERAGE_MIN_MS = 300

Token = dict[str, Any]


def token_id(t: Token) -> tuple[str, int, int]:
    return (str(t.get("text") or ""), int(t.get("start_ms") or 0), int(t.get("end_ms") or 0))


def cross_verify(primary: list[Token], verifier: list[Token]) -> tuple[dict[tuple[str, int, int], bool], dict[str, Any]]:
    states: dict[tuple[str, int, int], bool] = {}
    substitutions = deletions = insertions = 0
    for a, b in align(primary, verifier):
        if a is not None and b is not None:
            same = match_key(a["text"]) == match_key(b["text"])
            states[token_id(a)] = same
            if not same:
                substitutions += 1
        elif a is not None:
            states[token_id(a)] = False
            deletions += 1  # primary token the verifier did not produce
        else:
            insertions += 1  # verifier token the primary did not produce
    spans = verifier_only_spans(primary, verifier)
    total = sum(1 for t in primary if str(t.get("text") or "").strip())
    agreed = sum(1 for t in primary if str(t.get("text") or "").strip() and states.get(token_id(t)))
    return states, {
        "version": VERSION,
        "primary_tokens": total,
        "cross_verified_tokens": agreed,
        "not_cross_verified_tokens": total - agreed,
        "verifier_tokens": len(verifier),
        "disagreements": {"substitution": substitutions, "primary_only": deletions, "verifier_only": insertions},
        "verification_confidence": round(agreed / total, 4) if total else None,
        "coverage": {
            "version": COVERAGE_VERSION,
            "gaps": len(spans),
            "verifier_words_in_gaps": sum(sp["words"] for sp in spans),
            "definition": "verifier-only words where no primary token overlaps; merged within 1.5 s; kept when >=2 words or >=300 ms; each becomes a review region",
        },
        "definition": "cross-verified primary tokens / primary tokens (independent full-pass engine, deterministic alignment)",
    }


def verifier_only_spans(primary: list[Token], verifier: list[Token]) -> list[dict[str, Any]]:
    """Intervals where the independent verifier decoded speech and the primary decoded none.

    Deterministic: verifier tokens left unaligned by the aligner, with no primary token
    overlapping them, grouped in time order (gap <= COVERAGE_MERGE_MS). A span is kept when it
    has >= COVERAGE_MIN_WORDS words or lasts >= COVERAGE_MIN_MS. These are possible primary
    deletions (coverage gaps); they are surfaced for review, never filled automatically."""
    unaligned = [b for a, b in align(primary, verifier) if a is None and b is not None and str(b.get("text") or "").strip()]
    spans_p = sorted((int(t["start_ms"]), int(t["end_ms"])) for t in primary if str(t.get("text") or "").strip())

    def overlaps_primary(s: int, e: int) -> bool:
        import bisect

        i = bisect.bisect_left(spans_p, (s, -1))
        for j in (i - 1, i):
            if 0 <= j < len(spans_p) and spans_p[j][0] < e and spans_p[j][1] > s:
                return True
        # a long primary token starting well before s
        k = i - 2
        while k >= 0 and spans_p[k][1] > s:
            if spans_p[k][0] < e:
                return True
            k -= 1
        return False

    lone = sorted((t for t in unaligned if not overlaps_primary(int(t["start_ms"]), int(t["end_ms"]))), key=lambda t: t["start_ms"])
    groups: list[list[Token]] = []
    for t in lone:
        if groups and int(t["start_ms"]) - int(groups[-1][-1]["end_ms"]) <= COVERAGE_MERGE_MS:
            groups[-1].append(t)
        else:
            groups.append([t])
    out = []
    for g in groups:
        start, end = int(g[0]["start_ms"]), max(int(t["end_ms"]) for t in g)
        if len(g) >= COVERAGE_MIN_WORDS or end - start >= COVERAGE_MIN_MS:
            out.append({"start_ms": start, "end_ms": end, "words": len(g), "text": " ".join(str(t["text"]) for t in g)})
    return out
