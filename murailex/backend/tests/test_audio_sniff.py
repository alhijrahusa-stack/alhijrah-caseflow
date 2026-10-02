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
