from app.api.exports import _safe, _title_for_filename


def test_arabic_titles_survive_in_download_filenames():
    assert _title_for_filename("المتنبي — SalamaCast (archive.org CC0)") == "المتنبي_SalamaCast_archive.org_CC0"
    assert _title_for_filename("مُقابلة ٢٠٢٦") == "مُقابلة_٢٠٢٦"  # diacritics and Arabic-Indic digits kept


def test_download_filenames_never_carry_paths_or_control_characters():
    assert _title_for_filename("../../etc/passwd") == "etc_passwd"
    assert _title_for_filename("a\x00b\r\nc") == "a_b_c"
    assert _title_for_filename("///") == "recording"
    assert len(_title_for_filename("ا" * 500)) == 80


def test_storage_key_form_stays_ascii():
    assert _safe("المتنبي.txt") == "_.txt"


def test_export_validation_rejects_corrupt_outputs():
    import io
    import json
    import zipfile

    from app.api.exports import validate_export_bytes

    assert validate_export_bytes("pdf", b"%PDF-1.4\n...truncated") == "not a complete PDF document"
    assert validate_export_bytes("pdf", b"%PDF-1.4\n1 0 obj\n%%EOF\n").startswith("PDF does not parse")
    from reportlab.pdfgen import canvas

    def pdf(*lines: str) -> bytes:
        out = io.BytesIO()
        c = canvas.Canvas(out)
        for i, line in enumerate(lines):
            c.drawString(40, 800 - 14 * i, line)
        c.save()
        return out.getvalue()

    sha = "ab" * 32
    good = pdf("Page 1", "Transcript SHA-256", sha[:40], sha[40:])  # hash wrapped across lines
    assert validate_export_bytes("pdf", good, (sha,)) is None
    assert validate_export_bytes("pdf", pdf("Transcript", sha), (sha,)) == "PDF has no page numbering in its text layer"
    assert "lacks expected hash" in validate_export_bytes("pdf", good, ("cd" * 32,))
    assert validate_export_bytes("json", b"{bad") == "invalid JSON"
    assert validate_export_bytes("json", json.dumps({"a": 1}).encode()) is None
    assert validate_export_bytes("txt", b"\xff\xfe\xfa") == "TXT is not valid UTF-8"
    assert validate_export_bytes("docx", b"PK\x03\x04garbage") == "not a valid ZIP container"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("pkg/manifest.json", "{}")
    assert validate_export_bytes("zip", buf.getvalue()) == "evidence package is not signed"
    assert validate_export_bytes("txt", b"") == "empty output"
