from app.audio import sniff_mime


def test_mpeg1_layer3_with_crc_is_audio():
    # First bytes of a real 64 kb/s mono MP3 (archive.org SalamaCast/Mutanabi_SalamaCast.mp3).
    assert sniff_mime(bytes.fromhex("fffa50c093de0000")) == "audio/mpeg"


def test_mpeg25_layer3_frames_are_audio():
    assert sniff_mime(bytes.fromhex("ffe3501800000000")) == "audio/mpeg"
    assert sniff_mime(bytes.fromhex("ffe2501800000000")) == "audio/mpeg"


def test_existing_mpeg_and_adts_detection_unchanged():
    assert sniff_mime(bytes.fromhex("fffb900000000000")) == "audio/mpeg"
    assert sniff_mime(b"ID3\x04\x00\x00\x00\x00") == "audio/mpeg"
    assert sniff_mime(bytes.fromhex("fff1508000000000")) == "audio/aac"


def test_invalid_frame_headers_are_rejected():
    assert sniff_mime(bytes.fromhex("ffeb500000000000")) is None  # reserved MPEG version
    assert sniff_mime(bytes.fromhex("fffaf00000000000")) is None  # invalid bitrate index
    assert sniff_mime(bytes.fromhex("fffa5c0000000000")) is None  # reserved sample rate
    assert sniff_mime(b"<!DOCTYPE html>") is None


def test_streamed_webm_without_duration_header_gets_decoded_duration(tmp_path):
    """Regression: phone MediaRecorder recordings were stored with duration_ms = 0."""
    import os
    import subprocess

    from app import audio

    src = os.path.join(os.path.dirname(__file__), "fixtures", "sample.wav")
    webm = tmp_path / "rec.webm"
    with open(webm, "wb") as fh:  # piped output: no seekable header, like MediaRecorder
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", src, "-c:a", "libopus", "-f", "webm", "pipe:1"], stdout=fh, check=True)
    info = audio.probe(str(webm))
    assert info["duration_ms"] == 0
    wav = tmp_path / "analysis.wav"
    audio.derive_analysis_wav(str(webm), str(wav))
    fixed = audio.with_decoded_duration(info, str(wav))
    expected = audio.probe(src)["duration_ms"]
    assert abs(fixed["duration_ms"] - expected) <= 100
    assert fixed["duration_source"] == "decoded_analysis_wav"
    assert audio.with_decoded_duration({"duration_ms": 5000}, str(wav))["duration_source"] == "container"
