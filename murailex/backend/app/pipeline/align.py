"""Deterministic time-constrained token alignment between two ASR engines."""
from __future__ import annotations

from typing import Any

from .text import match_key

Token = dict[str, Any]
Column = tuple[Token | None, Token | None]

MATCH_TOLERANCE_MS = 1500
SUBST_TOLERANCE_MS = 1200


def _mid(t: Token) -> float:
    return (t["start_ms"] + t["end_ms"]) / 2.0


def _near(a: Token, b: Token, tol: int) -> bool:
    return a["start_ms"] - tol <= b["end_ms"] and b["start_ms"] - tol <= a["end_ms"]


def _align_block(a: list[Token], b: list[Token]) -> list[Column]:
    n, m = len(a), len(b)
    if n == 0:
        return [(None, t) for t in b]
    if m == 0:
        return [(t, None) for t in a]
    ka = [match_key(t["text"]) for t in a]
    kb = [match_key(t["text"]) for t in b]
    gap = -2
    neg = -10**6
    score = [[0] * (m + 1) for _ in range(n + 1)]
    move = [[0] * (m + 1) for _ in range(n + 1)]  # 1 diag, 2 up (a only), 3 left (b only)
    for i in range(1, n + 1):
        score[i][0] = i * gap
        move[i][0] = 2
    for j in range(1, m + 1):
        score[0][j] = j * gap
        move[0][j] = 3
    for i in range(1, n + 1):
        ai = a[i - 1]
        for j in range(1, m + 1):
            bj = b[j - 1]
            if ka[i - 1] == kb[j - 1] and _near(ai, bj, MATCH_TOLERANCE_MS):
                d = score[i - 1][j - 1] + 3
            elif _near(ai, bj, SUBST_TOLERANCE_MS):
                d = score[i - 1][j - 1] - 1
            else:
                d = neg
            u = score[i - 1][j] + gap
            left = score[i][j - 1] + gap
            # Deterministic tie-break: diagonal, then a-only, then b-only.
            if d >= u and d >= left:
                score[i][j], move[i][j] = d, 1
            elif u >= left:
                score[i][j], move[i][j] = u, 2
            else:
                score[i][j], move[i][j] = left, 3
    cols: list[Column] = []
    i, j = n, m
    while i > 0 or j > 0:
        mv = move[i][j]
        if mv == 1:
            cols.append((a[i - 1], b[j - 1]))
            i, j = i - 1, j - 1
        elif mv == 2:
            cols.append((a[i - 1], None))
            i -= 1
        else:
            cols.append((None, b[j - 1]))
            j -= 1
    cols.reverse()
    return cols


def _cut_points(a: list[Token], b: list[Token], target_ms: int = 15000, hard_ms: int = 45000) -> list[int]:
    spans = sorted([(t["start_ms"], t["end_ms"]) for t in a + b])
    cuts: list[int] = []
    if not spans:
        return cuts
    block_start = spans[0][0]
    reach = spans[0][1]
    for s, e in spans[1:]:
        if s >= reach and s - block_start >= target_ms or s - block_start >= hard_ms:
            cuts.append(s)
            block_start = s
        reach = max(reach, e)
    return cuts


def align(a: list[Token], b: list[Token]) -> list[Column]:
    """Align two token streams. Streams are cut into blocks only where neither engine has
    a token spanning the cut, so the DP never compares distant words."""
    a = sorted(a, key=lambda t: (t["start_ms"], t["end_ms"]))
    b = sorted(b, key=lambda t: (t["start_ms"], t["end_ms"]))
    cuts = _cut_points(a, b) + [10**15]
    cols: list[Column] = []
    ia = ib = 0
    for cut in cuts:
        ba: list[Token] = []
        bb: list[Token] = []
        while ia < len(a) and _mid(a[ia]) < cut:
            ba.append(a[ia])
            ia += 1
        while ib < len(b) and _mid(b[ib]) < cut:
            bb.append(b[ib])
            ib += 1
        cols.extend(_align_block(ba, bb))
    return cols
