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
        "definition": "cross-verified primary tokens / primary tokens (independent full-pass engine, deterministic alignment)",
    }
