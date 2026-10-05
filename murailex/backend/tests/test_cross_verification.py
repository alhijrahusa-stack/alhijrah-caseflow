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


def _region(**kw):
    base = {"start_ms": 0, "end_ms": 1000, "columns": [0], "reasons": [], "risks": [], "critical": False, "hard": False}
    return {**base, **kw}


def _cand(role, text, provider="e"):
    from app.pipeline import consensus as cons

    toks = [{"text": w, "start_ms": 0, "end_ms": 100, "confidence": None} for w in text.split()]
    return cons.candidate({"provider": provider, "model": "m", "run_id": provider}, toks, role)


def test_critical_span_closes_only_on_exact_independent_agreement():
    from app.pipeline.consensus import auto_resolution

    crit = _region(risks=["money"], critical=True)
    agree = [_cand("primary_asr", "دفعت خمسة آلاف", "a"), _cand("verification_asr", "دفعت خمسه الاف", "b")]
    assert auto_resolution(crit, agree, 0.0) is agree[0]  # same comparison key: verification passed
    differ = [_cand("primary_asr", "دفعت خمسة آلاف", "a"), _cand("verification_asr", "دفعت سبعة آلاف", "b")]
    assert auto_resolution(crit, differ, 0.0) is None  # a number disagreement stays disputed
    assert auto_resolution(_region(risks=["overlap"], reasons=["overlap"]), agree, 0.0) is None
    assert auto_resolution(_region(reasons=["coverage_gap"]), agree, 0.0) is None
    assert auto_resolution(crit, [agree[0]], 0.0) is None  # no independent engine: never closed


def test_region_tokens_fall_back_to_overlap_when_timestamps_drift():
    from app.pipeline.consensus import tokens_for_region

    toks = [{"text": "a", "start_ms": 900, "end_ms": 2100}]  # midpoint 1500, outside 1000..1400
    assert tokens_for_region(toks, 1000, 1400) == toks
    inside = [{"text": "b", "start_ms": 1050, "end_ms": 1150}]
    assert tokens_for_region(inside + toks, 1000, 1400) == inside  # midpoint selection wins
    assert tokens_for_region(toks, 5000, 6000) == []
