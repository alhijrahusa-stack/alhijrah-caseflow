from app.pipeline.verification import cross_verify, token_id


def tok(text, s, e):
    return {"text": text, "start_ms": s, "end_ms": e, "confidence": 0.9}


def test_cross_verification_marks_each_primary_token_and_never_changes_text():
    primary = [tok("قال", 0, 400), tok("إنه", 400, 800), tok("دفع", 800, 1200), tok("خمسين", 1200, 1700)]
    verifier = [tok("قال", 10, 390), tok("انه", 420, 790), tok("رفع", 810, 1190), tok("ألف", 1800, 2100), tok("زائدة", 9000, 9400)]
    states, summary = cross_verify(primary, verifier)
    assert states[token_id(primary[0])] is True
    assert states[token_id(primary[1])] is True  # alef variants normalise to the same comparison key
    assert states[token_id(primary[2])] is False  # substitution
    assert states[token_id(primary[3])] is False  # verifier heard a different word (substitution)
    assert summary["primary_tokens"] == 4 and summary["cross_verified_tokens"] == 2
    assert summary["verification_confidence"] == 0.5
    assert summary["disagreements"] == {"substitution": 2, "primary_only": 0, "verifier_only": 1}
    assert [t["text"] for t in primary] == ["قال", "إنه", "دفع", "خمسين"]


def test_empty_primary_has_undefined_confidence():
    states, summary = cross_verify([], [tok("x", 0, 10)])
    assert states == {} and summary["verification_confidence"] is None
