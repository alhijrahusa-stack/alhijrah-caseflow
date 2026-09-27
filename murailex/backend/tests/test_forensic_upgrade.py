from app.pipeline import consensus
from app.providers import registry
from app.providers.deepgram import DeepgramNova3
from app.providers.openai_stt import OpenAITranscribe


def tok(text: str, start: int = 0, end: int = 300):
    return {"text": text, "start_ms": start, "end_ms": end, "confidence": 0.99, "speaker": None}


def test_supported_locales_are_exactly_the_five_forensic_locales():
    assert registry.SUPPORTED_LOCALES == frozenset({"ar-YE", "ar-EG", "ar-SY", "ar-LB", "ar-IQ"})


def test_exact_five_locale_routing():
    ye_primary = registry.primary_asr("ar-YE")
    assert [p.name for p in ye_primary] == ["assemblyai", "google_chirp3"]
    assert ye_primary[1].info().parameters["languageCodes"] == ["ar-YE"]
    ye_verify = registry.verification_asr("ar-YE")
    assert [p.name for p in ye_verify] == ["openai", "deepgram"]
    assert ye_verify[1].info().parameters["language"] == "ar"

    for locale in ("ar-EG", "ar-SY", "ar-LB", "ar-IQ"):
        primary = registry.primary_asr(locale)
        assert [p.name for p in primary] == ["deepgram", "google_chirp3"]
        assert primary[0].info().parameters["language"] == locale
        assert primary[1].info().parameters["languageCodes"] == [locale]
        assert [p.name for p in registry.verification_asr(locale)] == ["assemblyai", "openai"]


def test_deepgram_rejects_yemeni_regional_locale():
    try:
        DeepgramNova3("ar-YE")
    except ValueError as exc:
        assert "must not be configured with ar-YE" in str(exc)
    else:
        raise AssertionError("Deepgram ar-YE must be rejected")


def test_google_chirp_has_word_offsets_but_no_google_diarization_or_confidence_gate():
    google = registry.primary_asr("ar-YE")[1]
    features = google.info().parameters["features"]
    assert features == {"enableWordTimeOffsets": True}


def test_openai_verifier_is_region_level_without_synthetic_tokens():
    normalized = OpenAITranscribe().normalize({"text": "نص تحقق", "languages": ["ar"]})
    assert normalized["tokens"] == []
    assert normalized["text"] == "نص تحقق"
    assert normalized["timestamp_granularity"] == "region_native"
    assert normalized["timestamp_source"] == "provider"


def test_critical_region_never_auto_resolves():
    meta = {"provider": "A", "model": "a", "run_id": "1"}
    verifier = {"provider": "V", "model": "v", "run_id": "2"}
    a = consensus.candidate(meta, [tok("سالم")], "primary_asr")
    v = consensus.candidate(verifier, [tok("سالم")], "verification_asr")
    region = {"reasons": [], "risks": ["name"], "critical": True, "hard": False}
    assert consensus.auto_resolution(region, [a, v], 0.6) is None


def test_primary_disagreement_never_auto_resolves_even_if_verifiers_match():
    meta = {"provider": "A", "model": "a", "run_id": "1"}
    verifier = {"provider": "V", "model": "v", "run_id": "2"}
    a = consensus.candidate(meta, [tok("تعال")], "primary_asr")
    v = consensus.candidate(verifier, [tok("تعال")], "verification_asr")
    region = {"reasons": ["engine_disagreement"], "risks": [], "critical": False, "hard": True}
    assert consensus.auto_resolution(region, [a, v], 0.6) is None
