import pytest

from app.benchmark import (
    BenchmarkItem,
    aggregate_scores,
    critical_entity_accuracy,
    extract_numeric_entities,
    rtf,
    score_transcript,
    validate_corpus,
)

SHA_A = "a" * 64
SHA_B = "b" * 64


def item(item_id: str, split: str, sha: str, *, human: bool = True) -> BenchmarkItem:
    return BenchmarkItem(
        item_id=item_id,
        split=split,
        audio_sha256=sha,
        locale="ar-YE",
        ground_truth="أنا هنا",
        ground_truth_revision="gt-r1",
        ground_truth_reviewer="human-reviewer",
        human_ground_truth=human,
    )


def test_raw_and_normalized_metrics_are_separate():
    scores = score_transcript("مرحباً، بك", "مرحبا بك")
    assert scores["raw_cer"]["rate"] > 0
    assert scores["normalized_wer"]["rate"] == 0
    assert scores["normalization_scope"] == "measurement_only"


def test_known_wer_counts():
    scores = score_transcript("one two three", "one four three five")
    assert scores["raw_wer"]["substitutions"] == 1
    assert scores["raw_wer"]["insertions"] == 1
    assert scores["raw_wer"]["deletions"] == 0
    assert scores["raw_wer"]["rate"] == pytest.approx(2 / 3)


def test_corpus_requires_human_ground_truth_and_both_splits():
    validate_corpus([item("dev", "development", SHA_A), item("eval", "held_out", SHA_B)])
    with pytest.raises(ValueError, match="human ground truth"):
        validate_corpus(
            [
                item("dev", "development", SHA_A, human=False),
                item("eval", "held_out", SHA_B),
            ]
        )
    with pytest.raises(ValueError, match="Both development and held_out"):
        validate_corpus([item("dev", "development", SHA_A)])


def test_corpus_rejects_cross_split_audio_leakage():
    with pytest.raises(ValueError, match="Data leakage"):
        validate_corpus(
            [item("dev", "development", SHA_A), item("eval", "held_out", SHA_A)]
        )


def test_critical_entity_accuracy_is_exact_and_typed():
    result = critical_entity_accuracy(
        [{"type": "money", "text": "$500"}, {"type": "name", "text": "سالم"}],
        [{"type": "money", "text": "$500"}, {"type": "name", "text": "سليم"}],
    )
    assert result["accuracy"] == 0.5
    assert result["by_type"]["money"]["accuracy"] == 1.0
    assert result["by_type"]["name"]["accuracy"] == 0.0
    # A different name is not a fuzzy match either.
    assert result["by_type"]["name"]["fuzzy_accuracy"] == 0.0


def test_fuzzy_entity_matching_is_separate_and_conservative():
    ref = [
        {"item_id": "a", "type": "name", "text": "أحمد"},
        {"item_id": "a", "type": "number", "text": "1,967"},
        {"item_id": "a", "type": "number", "text": "10"},
        {"item_id": "b", "type": "number", "text": "35"},
    ]
    hyp = [
        {"item_id": "a", "type": "name", "text": "احمد"},
        {"item_id": "a", "type": "number", "text": "١٩٦٧"},
        {"item_id": "a", "type": "number", "text": "11"},
        {"item_id": "c", "type": "number", "text": "35"},  # other item: never matched
    ]
    result = critical_entity_accuracy(ref, hyp)
    assert result["accuracy"] == 0.0
    assert result["fuzzy"]["matched"] == 2  # alef variant + digit/separator fold; 10≠11, 35 wrong item
    assert result["by_type"]["number"]["fuzzy_matched"] == 1


def test_numeric_entity_extraction_folds_digits_only():
    assert extract_numeric_entities("عام 1967 و ١٠ عملاء و 3.5 مليون") == [
        {"type": "number", "text": "1967"},
        {"type": "number", "text": "10"},
        {"type": "number", "text": "3.5"},
    ]
    assert extract_numeric_entities("عشرة عملاء") == []


def test_rtf_requires_explicit_measurement_class():
    result = rtf(30, 60, "cloud_service")
    assert result["rtf"] == 0.5
    assert result["x_realtime"] == 2.0
    with pytest.raises(ValueError):
        rtf(30, 60, "inference")


def test_aggregate_is_micro_average():
    a = score_transcript("a b", "a x")
    b = score_transcript("a b c d", "a b c d")
    result = aggregate_scores([a, b])
    assert result["raw_wer"]["errors"] == 1
    assert result["raw_wer"]["reference_units"] == 6
    assert result["raw_wer"]["rate"] == pytest.approx(1 / 6)


def test_der_components_and_optimal_mapping():
    from app.benchmark import diarization_error_rate

    ref = [(0.0, 10.0, "A"), (10.0, 20.0, "B")]
    perfect = diarization_error_rate(ref, [(0.0, 10.0, "x"), (10.0, 20.0, "y")], (0.0, 20.0))
    assert perfect["der"] == 0.0  # labels are arbitrary; mapping is optimal
    one = diarization_error_rate(ref, [(0.0, 20.0, "x")], (0.0, 20.0))
    assert one["confusion_s"] == 10.0 and one["der"] == pytest.approx(0.5)
    gap = diarization_error_rate(ref, [(0.0, 5.0, "x"), (10.0, 20.0, "y"), (20.0, 25.0, "y")], (0.0, 20.0))
    assert gap["missed_s"] == 5.0 and gap["false_alarm_s"] == 0.0  # outside the UEM is not scored
    overlap = diarization_error_rate([(0.0, 10.0, "A"), (5.0, 10.0, "B")], [(0.0, 10.0, "x")], (0.0, 10.0))
    assert overlap["missed_s"] == 5.0 and overlap["der"] == pytest.approx(5 / 15)


def test_der_mapping_is_optimal_not_greedy():
    from app.benchmark import _best_mapping

    # greedy would pair (A,x)=5 first and leave B with y=1 (total 6); optimal is A-y + B-x = 8
    overlap = {("A", "x"): 5, ("A", "y"): 4, ("B", "x"): 4, ("B", "y"): 1}
    assert _best_mapping(overlap, ["A", "B"], ["x", "y"]) == {"x": "B", "y": "A"}
    many = {(f"R{i}", f"H{i}"): 10 for i in range(12)}
    assert _best_mapping(many, [f"R{i}" for i in range(12)], [f"H{i}" for i in range(12)]) == {f"H{i}": f"R{i}" for i in range(12)}
