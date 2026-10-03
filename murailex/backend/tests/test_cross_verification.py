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


def _t(text, s, e):
    return {"text": text, "start_ms": s, "end_ms": e}


def test_verifier_only_speech_in_primary_gap_becomes_coverage_span():
    from app.pipeline.verification import cross_verify, verifier_only_spans

    primary = [_t("قال", 0, 400), _t("ذلك", 400, 800), _t("ثم", 9000, 9300)]
    verifier = [_t("قال", 0, 400), _t("ذلك", 400, 800), _t("ذهبنا", 3000, 3500), _t("إلى", 3500, 3800), _t("المحكمة", 3800, 4400), _t("ثم", 9000, 9300)]
    spans = verifier_only_spans(primary, verifier)
    assert spans == [{"start_ms": 3000, "end_ms": 4400, "words": 3, "text": "ذهبنا إلى المحكمة"}]
    _, summary = cross_verify(primary, verifier)
    assert summary["coverage"]["gaps"] == 1 and summary["coverage"]["verifier_words_in_gaps"] == 3


def test_verifier_extra_word_inside_primary_speech_is_not_a_coverage_gap():
    from app.pipeline.verification import verifier_only_spans

    primary = [_t("قال", 0, 500), _t("ذلك", 450, 900)]
    verifier = [_t("قال", 0, 400), _t("يعني", 420, 520), _t("ذلك", 520, 900)]
    assert verifier_only_spans(primary, verifier) == []


def test_coverage_gap_region_is_hard_and_merges_into_overlapping_region():
    from app.pipeline.process import _add_coverage_regions

    primary = [_t("a", 0, 400), _t("b", 9000, 9300)]
    verifier = [_t("a", 0, 400), _t("x", 3000, 3400), _t("y", 3400, 3900), _t("b", 9000, 9300)]
    regions = _add_coverage_regions([], primary, verifier, [])
    assert regions == [{"start_ms": 3000, "end_ms": 3900, "columns": [], "reasons": ["coverage_gap"], "risks": [], "critical": False,
                        "hard": True, "requires_independent_check": True, "speaker_raw": None}]
    existing = [{"start_ms": 3500, "end_ms": 5000, "columns": [7], "reasons": [], "risks": ["number"], "critical": True, "hard": False,
                 "requires_independent_check": True, "speaker_raw": None}]
    merged = _add_coverage_regions(existing, primary, verifier, [])
    assert len(merged) == 1 and merged[0]["reasons"] == ["coverage_gap"] and merged[0]["start_ms"] == 3000 and merged[0]["hard"]
