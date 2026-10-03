import os

from app import audio_quality as aq


def test_clean_speech_is_clean():
    out = aq.classify({"RMS level dB": -20.0, "RMS trough dB": -60.0, "Peak level dB": -3.0, "Number of samples": 1e6, "Peak count": 2}, {"sample_rate": 44100, "bit_rate": 128000, "codec": "mp3"})
    assert out["overall"] == "CLEAN" and out["reasons"] == {}


def test_problems_are_labelled_with_measured_reasons():
    out = aq.classify(
        {"RMS level dB": -40.0, "RMS trough dB": -45.0, "Peak level dB": 0.0, "Number of samples": 1e6, "Peak count": 5000},
        {"sample_rate": 8000, "bit_rate": 12000, "codec": "amr_nb"},
    )
    assert out["overall"] == "DEGRADED"
    assert set(out["labels"]) == {"LOW_VOLUME", "CLIPPED", "TELEPHONE", "COMPRESSED", "HEAVY_NOISE"}
    assert "8000 Hz" in out["reasons"]["TELEPHONE"] and "dBFS" in out["reasons"]["LOW_VOLUME"]
    assert out["route_adaptation"].startswith("none")


def test_noisy_band_and_digital_silence_floor():
    out = aq.classify({"RMS level dB": -25.0, "RMS trough dB": -40.0, "Peak level dB": -6.0, "Number of samples": 1e6, "Peak count": 1}, {"sample_rate": 16000, "bit_rate": 256000, "codec": "pcm_s16le"})
    assert out["overall"] == "NOISY"
    silent = aq.classify({"RMS level dB": -20.0, "RMS trough dB": float("-inf"), "Peak level dB": -6.0, "Number of samples": 1e6, "Peak count": 1}, {})
    assert silent["metrics"]["noise_floor_dbfs_est"] == -96.0 and silent["overall"] == "CLEAN"


def test_measure_reads_real_ffmpeg_statistics():
    sample = os.path.join(os.path.dirname(__file__), "fixtures", "sample.wav")
    stats = aq.measure(sample)
    assert stats["Number of samples"] > 0 and "RMS level dB" in stats and "RMS trough dB" in stats
