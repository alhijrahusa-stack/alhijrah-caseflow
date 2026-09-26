"""Deterministic consensus.

Rules (documented in the manifest of every export):

1. Two primary engines are aligned token-by-token under a time constraint.
2. A token is accepted only when both engines produced the same comparison key within
   the time tolerance and neither reported confidence below the threshold.
3. Disagreements, one-engine-only tokens, and low-confidence tokens become disputes.
4. High-risk tokens (numbers, money, dates, names, admissions, denials, threats,
   negations, code-switching, overlap) are escalated. Critical categories need
   independent verification-engine agreement or human review; with only one primary
   engine every escalated token needs review.
5. Verification runs over each region ±context. A region is closed automatically only
   when every available candidate (≥2 engines, including ≥1 verification engine) has the
   identical comparison-key sequence. Otherwise it stays open for human review.
6. No candidate is ever chosen by plausibility, grammar, or context.
"""
from __future__ import annotations

from typing import Any

from .align import align
from .text import CRITICAL_RISKS, match_key, token_risks

Token = dict[str, Any]


def _prov(meta: dict[str, Any], tok: Token) -> dict[str, Any]:
    return {
        "provider": meta["provider"],
        "model": meta["model"],
        "run_id": meta["run_id"],
        "raw": tok["text"],
        "start_ms": tok["start_ms"],
        "end_ms": tok["end_ms"],
        "confidence": tok.get("confidence"),
    }


def _low(tok: Token | None, threshold: float) -> bool:
    return tok is not None and tok.get("confidence") is not None and float(tok["confidence"]) < threshold


def speaker_at(turns: list[dict[str, Any]], start: int, end: int) -> tuple[str | None, bool]:
    """Return (speaker with the greatest overlap, overlapped-speech flag)."""
    overlaps: dict[str, int] = {}
    for t in turns:
        ov = min(end, t["end_ms"]) - max(start, t["start_ms"])
        if ov > 0:
            overlaps[t["speaker"]] = overlaps.get(t["speaker"], 0) + ov
    if not overlaps:
        # nearest turn within 500 ms (word boundary jitter); otherwise unknown
        best = None
        best_d = 501
        for t in turns:
            d = min(abs(start - t["end_ms"]), abs(t["start_ms"] - end))
            if d < best_d:
                best, best_d = t["speaker"], d
        return best, False
    ordered = sorted(overlaps.items(), key=lambda kv: (-kv[1], kv[0]))
    dur = max(1, end - start)
    overlap = len(ordered) > 1 and ordered[1][1] >= 0.3 * dur
    return ordered[0][0], overlap


def analyze(
    primaries: list[tuple[dict[str, Any], list[Token]]],
    turns: list[dict[str, Any]],
    threshold: float,
) -> dict[str, Any]:
    if not primaries:
        raise ValueError("At least one primary ASR result is required.")
    single = len(primaries) == 1
    a_meta, a_tokens = primaries[0]
    if single:
        columns: list[tuple[Token | None, Token | None]] = [(t, None) for t in sorted(a_tokens, key=lambda t: (t["start_ms"], t["end_ms"]))]
        b_meta = None
    else:
        b_meta, b_tokens = primaries[1]
        columns = align(a_tokens, b_tokens)

    annotated: list[dict[str, Any]] = []
    texts = [((a or b) or {}).get("text", "") for a, b in columns]
    for idx, (a, b) in enumerate(columns):
        present = [t for t in (a, b) if t is not None]
        start = min(t["start_ms"] for t in present)
        end = max(t["end_ms"] for t in present)
        prev_text = texts[idx - 1] if idx > 0 else None
        next_text = texts[idx + 1] if idx + 1 < len(texts) else None
        risks: set[str] = set()
        for t in present:
            risks |= token_risks(t["text"], prev_text, next_text)
        speaker, overlap = speaker_at(turns, start, end) if turns else (None, False)
        if overlap:
            risks.add("overlap")
        reasons: set[str] = set()
        if single:
            agree = True
        else:
            agree = a is not None and b is not None and match_key(a["text"]) == match_key(b["text"])
            if not agree:
                reasons.add("engine_disagreement" if (a is not None and b is not None) else "single_engine_token")
        if _low(a, threshold) or _low(b, threshold):
            reasons.add("low_confidence")
        provenance = []
        if a is not None:
            provenance.append(_prov(a_meta, a))
        if b is not None and b_meta is not None:
            provenance.append(_prov(b_meta, b))
        annotated.append(
            {
                "index": idx,
                "start_ms": start,
                "end_ms": end,
                "text": present[0]["text"],  # display form = provider raw token (engine A when present)
                "agree": agree,
                "risks": sorted(risks),
                "reasons": sorted(reasons),
                "speaker_raw": speaker,
                "overlap": overlap,
                "provenance": provenance,
            }
        )

    # Decide which columns are flagged.
    for col in annotated:
        crit = CRITICAL_RISKS.intersection(col["risks"])
        escalate = bool(col["risks"])
        col["flag"] = bool(col["reasons"]) or col["overlap"]
        col["escalate"] = escalate
        col["needs_verification_or_review"] = bool(crit) or single and escalate

    regions: list[dict[str, Any]] = []
    for col in annotated:
        # Agreed non-critical escalations (e.g. negation, code-switching between two agreeing
        # engines) are accepted with their risk flags retained; they never form a region.
        if not (col["flag"] or col["needs_verification_or_review"]):
            continue
        if regions and col["start_ms"] - regions[-1]["end_ms"] <= 1500 and col["index"] - regions[-1]["columns"][-1] <= 3:
            r = regions[-1]
            for k in range(r["columns"][-1] + 1, col["index"] + 1):
                r["columns"].append(k)
            r["end_ms"] = max(r["end_ms"], col["end_ms"])
        else:
            regions.append({"start_ms": col["start_ms"], "end_ms": col["end_ms"], "columns": [col["index"]]})
    for r in regions:
        cols = [annotated[i] for i in r["columns"]]
        r_reasons: set[str] = set()
        r_risks: set[str] = set()
        for c in cols:
            r_reasons |= set(c["reasons"])
            r_risks |= set(c["risks"])
            if c["overlap"]:
                r_reasons.add("overlap")
        r["reasons"] = sorted(r_reasons)
        r["risks"] = sorted(r_risks)
        r["critical"] = bool(CRITICAL_RISKS & r_risks)
        # Hard disputes: disagreement, low confidence, overlap. Soft: agreed high-risk only.
        r["hard"] = bool(r_reasons)
        r["requires_independent_check"] = r["hard"] or r["critical"] or single
        speakers = [c["speaker_raw"] for c in cols if c["speaker_raw"] is not None]
        r["speaker_raw"] = max(sorted(set(speakers)), key=speakers.count) if speakers else None
    return {"columns": annotated, "regions": regions, "single_engine": single}


def tokens_in_window(tokens: list[Token], start: int, end: int) -> list[Token]:
    return [t for t in tokens if start <= (t["start_ms"] + t["end_ms"]) / 2 <= end]


def candidate(meta: dict[str, Any], tokens: list[Token], role: str) -> dict[str, Any]:
    confs = [float(t["confidence"]) for t in tokens if t.get("confidence") is not None]
    return {
        "provider": meta["provider"],
        "model": meta["model"],
        "run_id": meta["run_id"],
        "role": role,
        "text": " ".join(t["text"] for t in tokens),
        "tokens": tokens,
        "key": [match_key(t["text"]) for t in tokens],
        "mean_confidence": round(sum(confs) / len(confs), 4) if confs else None,
        "min_confidence": round(min(confs), 4) if confs else None,
    }


def annotate_agreement(cands: list[dict[str, Any]]) -> None:
    for c in cands:
        c["agrees_with"] = sorted(o["provider"] for o in cands if o is not c and o["key"] == c["key"])


def auto_resolution(region: dict[str, Any], cands: list[dict[str, Any]], threshold: float) -> dict[str, Any] | None:
    """Return the unanimous candidate when rule 5 permits automatic closure, else None."""
    if "overlap" in region["reasons"]:
        return None
    verifiers = [c for c in cands if c["role"] == "verification_asr"]
    if len(cands) < 2 or not verifiers:
        return None
    if any(not c["key"] for c in cands):
        return None
    first = cands[0]["key"]
    if any(c["key"] != first for c in cands):
        return None
    if any(c["min_confidence"] is not None and c["min_confidence"] < threshold for c in cands):
        return None
    return cands[0]
