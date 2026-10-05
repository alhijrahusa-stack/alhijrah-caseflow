from app.pipeline import consensus
from app.pipeline.process import _primary_trace_failures
from app.providers import registry
from app.providers.deepgram import DeepgramNova3
from app.providers.openai_stt import OpenAITranscribe


def tok(text: str, start: int = 0, end: int = 300):
    return {
        "text": text,
        "start_ms": start,
        "end_ms": end,
        "confidence": 0.99,
        "speaker": None,
    }


def test_supported_locales_include_six_forensic_locales():
    assert registry.SUPPORTED_LOCALES == frozenset(
        {"ar", "ar-YE", "ar-EG", "ar-SY", "ar-LB", "ar-IQ"}
    )


def test_ar_general_locale_routing():
    primary = registry.primary_asr("ar")
    assert [p.name for p in primary] == ["assemblyai", "deepgram"]
    assert primary[1].info().parameters["language"] == "ar"
    verify = registry.verification_asr("ar")
    assert [p.name for p in verify] == ["openai"]


def test_ar_ye_locale_routing():
    primary = registry.primary_asr("ar-YE")
    assert [p.name for p in primary] == ["assemblyai", "google_chirp3"]
    assert primary[1].info().parameters["languageCodes"] == ["ar-YE"]
    verify = registry.verification_asr("ar-YE")
    assert [p.name for p in verify] == ["openai", "deepgram"]
    assert verify[1].info().parameters["language"] == "ar"


def test_ar_regional_locales_exact_routing():
    for locale in ("ar-EG", "ar-SY", "ar-LB", "ar-IQ"):
        primary = registry.primary_asr(locale)
        assert [p.name for p in primary] == ["deepgram", "google_chirp3"]
        assert primary[0].info().parameters["language"] == locale
        assert primary[1].info().parameters["languageCodes"] == [locale]
        verify = registry.verification_asr(locale)
        assert [p.name for p in verify] == ["assemblyai", "openai"]


def test_deepgram_rejects_yemeni_regional_locale():
    try:
        DeepgramNova3("ar-YE")
    except ValueError as exc:
        assert "must not be configured with ar-YE" in str(exc)
    else:
        raise AssertionError("Deepgram ar-YE must be rejected")


def test_google_chirp_has_word_offsets_no_diarization():
    google = registry.primary_asr("ar-YE")[1]
    features = google.info().parameters["features"]
    assert features == {"enableWordTimeOffsets": True}


def test_openai_verifier_region_level_no_synthetic_tokens():
    normalized = OpenAITranscribe().normalize({"text": "نص تحقق", "languages": ["ar"]})
    assert normalized["tokens"] == []
    assert normalized["text"] == "نص تحقق"
    assert normalized["timestamp_granularity"] == "region_native"
    assert normalized["timestamp_source"] == "provider"


def test_critical_region_closes_only_when_the_independent_check_passes():
    """A critical span is closed only by a passing targeted verification: an independent
    engine reading the same span the same way. Any mismatch stays disputed."""
    meta = {"provider": "A", "model": "a", "run_id": "1"}
    verifier = {"provider": "V", "model": "v", "run_id": "2"}
    primary = consensus.candidate(meta, [tok("سالم")], "primary_asr")
    region = {"reasons": [], "risks": ["name"], "critical": True, "hard": False}
    agreed = consensus.candidate(verifier, [tok("سالم")], "verification_asr")
    assert consensus.auto_resolution(region, [primary, agreed], 0.6) is primary
    other = consensus.candidate(verifier, [tok("سليم")], "verification_asr")
    assert consensus.auto_resolution(region, [primary, other], 0.6) is None
    assert consensus.auto_resolution(region, [primary], 0.6) is None


def test_primary_disagreement_never_auto_resolves():
    meta = {"provider": "A", "model": "a", "run_id": "1"}
    verifier = {"provider": "V", "model": "v", "run_id": "2"}
    primary = consensus.candidate(meta, [tok("تعال")], "primary_asr")
    checked = consensus.candidate(verifier, [tok("تعال")], "verification_asr")
    region = {
        "reasons": ["engine_disagreement"],
        "risks": [],
        "critical": False,
        "hard": True,
    }
    assert consensus.auto_resolution(region, [primary, checked], 0.6) is None


def test_primary_token_traceability_allows_different_token_counts():
    inputs = [
        (
            {"provider": "A", "model": "a", "run_id": "1"},
            [tok("السلام", 0, 200), tok("عليكم", 210, 450)],
        ),
        (
            {"provider": "B", "model": "b", "run_id": "2"},
            [tok("السلام", 0, 450)],
        ),
    ]
    result = consensus.analyze(inputs, [], 0.6)
    assert _primary_trace_failures(inputs, result["columns"]) == []


def test_primary_token_traceability_fails_if_provenance_is_dropped():
    inputs = [
        (
            {"provider": "A", "model": "a", "run_id": "1"},
            [tok("واحد", 0, 200)],
        ),
        (
            {"provider": "B", "model": "b", "run_id": "2"},
            [tok("واحد", 0, 200)],
        ),
    ]
    result = consensus.analyze(inputs, [], 0.6)
    result["columns"][0]["provenance"] = []
    missing = _primary_trace_failures(inputs, result["columns"])
    assert len(missing) == 2
    assert {item["run_id"] for item in missing} == {"1", "2"}
