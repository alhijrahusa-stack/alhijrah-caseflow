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
