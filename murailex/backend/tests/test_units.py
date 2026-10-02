from app.pipeline import align, consensus, transcript
from app.pipeline.text import match_key, token_risks


def tok(text, s, e, c=0.95, sp=None):
    return {"text": text, "start_ms": s, "end_ms": e, "confidence": c, "speaker": sp}


def test_match_key_never_changes_display_but_compares_orthography():
    assert match_key("أنا،") == match_key("انا")
    assert match_key("مُحَمَّد") == match_key("محمد")
    assert match_key("٥") == match_key("5")
    assert match_key("خمسة") != match_key("خمسين")


def test_risk_detection():
    assert "number" in token_risks("خمسة")
    assert "number" in token_risks("٢٠٠")
    assert "money" in token_risks("ريال")
    assert "negation" in token_risks("مش")
    assert "negation" in token_risks("didn't")
    assert "threat" in token_risks("بذبحك")
    assert "date" in token_risks("الخميس")
    assert "name" in token_risks("سالم", prev_text="أبو")
    assert "code_switch" in token_risks("okay", prev_text="شفته")
    assert token_risks("تعال", prev_text="سالم") == set()


def test_alignment_is_deterministic_and_time_constrained():
    a = [tok("انا", 0, 300), tok("رحت", 300, 600), tok("السوق", 600, 900)]
    b = [tok("انا", 10, 310), tok("روحت", 310, 610), tok("السوق", 610, 910)]
    cols = align.align(a, b)
    assert [(x["text"] if x else None, y["text"] if y else None) for x, y in cols] == [
        ("انا", "انا"), ("رحت", "روحت"), ("السوق", "السوق")]
    assert cols == align.align(a, b)


def test_alignment_does_not_match_distant_identical_words():
    a = [tok("نعم", 0, 300)]
    b = [tok("نعم", 60000, 60300)]
    cols = align.align(a, b)
    assert len(cols) == 2 and all((x is None) != (y is None) for x, y in cols)


def test_consensus_flags_disagreement_and_accepts_agreement():
    meta_a = {"provider": "A", "model": "a", "run_id": "1"}
    meta_b = {"provider": "B", "model": "b", "run_id": "2"}
    a = [tok("والله", 0, 400), tok("تعال", 400, 800), tok("خمسة", 2000, 2400)]
    b = [tok("والله", 0, 400), tok("تعال", 400, 800), tok("خمسين", 2000, 2400)]
    r = consensus.analyze([(meta_a, a), (meta_b, b)], [], 0.6)
    assert [c["agree"] for c in r["columns"]] == [True, True, False]
    assert len(r["regions"]) == 1
    reg = r["regions"][0]
    assert "engine_disagreement" in reg["reasons"] and "number" in reg["risks"]
    assert reg["requires_independent_check"]
    # provenance retained for accepted tokens
    assert {p["provider"] for p in r["columns"][0]["provenance"]} == {"A", "B"}


def test_single_engine_escalates_every_risk():
    meta = {"provider": "A", "model": "a", "run_id": "1"}
    r = consensus.analyze([(meta, [tok("ما", 0, 300), tok("رحت", 300, 600)])], [], 0.6)
    assert r["single_engine"] and r["regions"][0]["requires_independent_check"]


def test_auto_resolution_requires_unanimity_and_a_verifier():
    region = {"reasons": [], "risks": ["name"]}
    m = {"provider": "A", "model": "a", "run_id": "1"}
    v = {"provider": "V", "model": "v", "run_id": "3"}
    ca = consensus.candidate(m, [tok("سالم", 0, 300)], "primary_asr")
    cv = consensus.candidate(v, [tok("سالم", 0, 300)], "verification_asr")
    cx = consensus.candidate(v, [tok("سليم", 0, 300)], "verification_asr")
    assert consensus.auto_resolution(region, [ca, cv], 0.6) is ca
    assert consensus.auto_resolution(region, [ca], 0.6) is None
    assert consensus.auto_resolution(region, [ca, cx], 0.6) is None
    assert consensus.auto_resolution({"reasons": ["overlap"], "risks": []}, [ca, cv], 0.6) is None


def test_overlap_detection():
    turns = [{"speaker": "X", "start_ms": 0, "end_ms": 1000}, {"speaker": "Y", "start_ms": 400, "end_ms": 1500}]
    spk, ov = consensus.speaker_at(turns, 500, 900)
    assert ov is True and spk in ("X", "Y")
    assert consensus.speaker_at(turns, 0, 300) == ("X", False)


def test_speaker_labels():
    assert transcript.speaker_label("S1") == "[المتحدث 1]"
    assert transcript.speaker_map(["SPEAKER_01", "SPEAKER_00", "SPEAKER_01"]) == {"SPEAKER_01": "S1", "SPEAKER_00": "S2"}


def test_long_unattributed_speech_is_paragraphed_at_pauses_without_losing_items():
    from app.pipeline.transcript import SEGMENT_HARD_MAX_MS, segment

    items = []
    t = 0
    for n in range(300):  # 300 words, ~150 s, no speaker attribution
        gap = 400 if n % 15 == 14 else 50
        items.append({"kind": "word", "text": f"w{n}", "start_ms": t, "end_ms": t + 450, "speaker": None,
                      "risks": [], "source": "consensus", "provenance": []})
        t += 450 + gap
    segs = segment(items)
    assert len(segs) > 1
    flat = [it["text"] for s in segs for it in s["items"]]
    assert flat == [f"w{n}" for n in range(300)]
    assert all(s["end_ms"] - s["start_ms"] <= SEGMENT_HARD_MAX_MS for s in segs)
    assert all(a["end_ms"] <= b["start_ms"] for a, b in zip(segs, segs[1:]))


def test_short_turns_are_not_split():
    from app.pipeline.transcript import segment

    items = [{"kind": "word", "text": f"w{n}", "start_ms": n * 500, "end_ms": n * 500 + 450, "speaker": "S1",
              "risks": [], "source": "consensus", "provenance": []} for n in range(20)]
    assert len(segment(items)) == 1
