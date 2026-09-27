from app.pipeline import consensus
from app.providers import registry
from app.providers.deepgram import DeepgramNova3
from app.providers.openai_stt import OpenAITranscribe


def tok(text: str, start: int = 0, end: int = 300):
    return {"text": text, "start_ms": start, "end_ms": end, "confidence": 0.99, "speaker": None}


def test_supported_locales_include_six_forensic_locales():
    """Six-locale forensic contract: ar + five regional variants."""
    assert registry.SUPPORTED_LOCALES == frozenset({"ar", "ar-YE", "ar-EG", "ar-SY", "ar-LB", "ar-IQ"})


def test_ar_general_locale_routing():
    """ar (general): AssemblyAI + Deepgram ar for primary; OpenAI only for verification."""
    primary = registry.primary_asr("ar")
    assert [p.name for p in primary] == ["assemblyai", "deepgram"]
    assert primary[1].info().parameters["language"] == "ar"
    
    verify = registry.verification_asr("ar")
    assert [p.name for p in verify] == ["openai"]


def test_ar_ye_locale_routing():
    """ar-YE: AssemblyAI + Google ar-YE for primary; OpenAI + Deepgram ar for verification (no Deepgram ar-YE)."""
    primary = registry.primary_asr("ar-YE")
    assert [p.name for p in primary] == ["assemblyai", "google_chirp3"]
    assert primary[1].info().parameters["languageCodes"] == ["ar-YE"]
    
    verify = registry.verification_asr("ar-YE")
    assert [p.name for p in verify] == ["openai", "deepgram"]
    assert verify[1].info().parameters["language"] == "ar"


def test_ar_regional_locales_exact_routing():
    """ar-EG/ar-SY/ar-LB/ar-IQ: Deepgram exact-locale + Google exact-locale for primary;
    AssemblyAI + OpenAI for verification."""
    for locale in ("ar-EG", "ar-SY", "ar-LB", "ar-IQ"):
        primary = registry.primary_asr(locale)
        assert [p.name for p in primary] == ["deepgram", "google_chirp3"]
        assert primary[0].info().parameters["language"] == locale
        assert primary[1].info().parameters["languageCodes"] == [locale]
        
        verify = registry.verification_asr(locale)
        assert [p.name for p in verify] == ["assemblyai", "openai"]


def test_deepgram_rejects_yemeni_regional_locale():
    """Deepgram must reject ar-YE per forensic contract."""
    try:
        DeepgramNova3("ar-YE")
    except ValueError as exc:
        assert "must not be configured with ar-YE" in str(exc)
    else:
        raise AssertionError("Deepgram ar-YE must be rejected")


def test_google_chirp_has_word_offsets_no_diarization():
    """Google Chirp: enableWordTimeOffsets only, no diarization or confidence gates."""
    google = registry.primary_asr("ar-YE")[1]
    features = google.info().parameters["features"]
    assert features == {"enableWordTimeOffsets": True}


def test_openai_verifier_region_level_no_synthetic_tokens():
    """OpenAI verification: region-level granularity, no synthetic token generation."""
    normalized = OpenAITranscribe().normalize({"text": "نص تحقق", "languages": ["ar"]})
    assert normalized["tokens"] == []
    assert normalized["text"] == "نص تحقق"
    assert normalized["timestamp_granularity"] == "region_native"
    assert normalized["timestamp_source"] == "provider"


def test_critical_region_never_auto_resolves():
    """Critical regions (name/identity disputes) are never auto-resolved even with unanimous verification."""
    meta = {"provider": "A", "model": "a", "run_id": "1"}
    verifier = {"provider": "V", "model": "v", "run_id": "2"}
    a = consensus.candidate(meta, [tok("سالم")], "primary_asr")
    v = consensus.candidate(verifier, [tok("سالم")], "verification_asr")
    region = {"reasons": [], "risks": ["name"], "critical": True, "hard": False}
    assert consensus.auto_resolution(region, [a, v], 0.6) is None


def test_primary_disagreement_never_auto_resolves():
    """Primary engine disagreement forces manual review even if all verifiers match."""
    meta = {"provider": "A", "model": "a", "run_id": "1"}
    verifier = {"provider": "V", "model": "v", "run_id": "2"}
    a = consensus.candidate(meta, [tok("تعال")], "primary_asr")
    v = consensus.candidate(verifier, [tok("تعال")], "verification_asr")
    region = {"reasons": ["engine_disagreement"], "risks": [], "critical": False, "hard": True}
    assert consensus.auto_resolution(region, [a, v], 0.6) is None


def test_token_conservation_enforced():
    """Token count must match across all primary engines after alignment."""
    from app.pipeline.process import _check_token_conservation
    from app.providers.base import ProviderError
    
    # Matching counts: OK
    inputs_ok = [
        ({"provider": "A", "model": "a", "run_id": "1"}, [tok("test")]),
        ({"provider": "B", "model": "b", "run_id": "2"}, [tok("test")]),
    ]
    _check_token_conservation(inputs_ok)  # Should not raise
    
    # Mismatched counts: must fail
    inputs_bad = [
        ({"provider": "A", "model": "a", "run_id": "1"}, [tok("test1"), tok("test2")]),
        ({"provider": "B", "model": "b", "run_id": "2"}, [tok("test")]),
    ]
    try:
        _check_token_conservation(inputs_bad)
        raise AssertionError("Token conservation must fail on mismatch")
    except ProviderError as e:
        assert "Token conservation violation" in str(e)

