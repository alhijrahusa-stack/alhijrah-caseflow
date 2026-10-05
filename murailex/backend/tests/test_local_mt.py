"""On-device translation (OPUS-MT via CTranslate2). The real-model checks run when
MURAILEX_TEST_MT_DIR points at the converted models (local/run-local.sh installs them)."""
from __future__ import annotations

import os
import re

import pytest

from app.config import get_settings
from app.providers import local_mt

MT_DIR = os.environ.get("MURAILEX_TEST_MT_DIR", "")
needs_models = pytest.mark.skipif(not (MT_DIR and os.path.isdir(MT_DIR)), reason="MURAILEX_TEST_MT_DIR not set")


@pytest.fixture()
def mt_dir(monkeypatch):
    monkeypatch.setattr(get_settings(), "local_mt_dir", MT_DIR)
    yield MT_DIR


def test_not_configured_without_models(monkeypatch):
    monkeypatch.setattr(get_settings(), "local_mt_dir", "")
    assert local_mt.configured("ar", "en") is False
    with pytest.raises(local_mt.ProviderError):
        local_mt.translate_batch(["نص"], "ar", "en")


@needs_models
def test_real_translation_both_directions_and_long_input(mt_dir):
    out, meta = local_mt.translate_batch(
        ["لم يحدد رقمًا للتخفيضات، قائلًا إنها ستعتمد على الناتج الاقتصادي للصين."], "ar", "en"
    )
    assert "China" in out[0]
    assert meta["model"].startswith("opus-mt-ar-en/opus-2019-12-18@ct2-int8:")
    ar, _ = local_mt.translate_batch(["The hearing was adjourned until next Monday."], "en", "ar")
    assert re.search(r"[؀-ۿ]", ar[0])
    # a long segment is chunked, never truncated: every sentence yields output
    long_text = " ".join(["ذهبت إلى المحكمة صباح يوم الاثنين."] * 60)
    (translated,), meta = local_mt.translate_batch([long_text], "ar", "en")
    assert meta["chunks"] > 1
    assert translated.lower().count("court") >= 30


@needs_models
def test_model_files_are_readable_by_an_unprivileged_service(mt_dir):
    """The OPUS-MT release archives carry 0640 root-owned files. The service runs as an
    unprivileged user, so every file it loads must be world-readable."""
    import os
    import stat

    for direction in ("ar-en", "en-ar"):
        for name in ("model.bin", "source.spm", "target.spm"):
            path = os.path.join(mt_dir, direction, name)
            if not os.path.exists(path):
                continue
            mode = stat.S_IMODE(os.stat(path).st_mode)
            assert mode & stat.S_IROTH, f"{direction}/{name} is not world-readable ({oct(mode)})"
