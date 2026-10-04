"""On-device machine translation for the separate derived translation document.

OPUS-MT transformer models (Helsinki-NLP, CC-BY-4.0) converted to CTranslate2 int8 and run on
the CPU; no text leaves the machine. Each direction lives in LOCAL_MT_DIR/<src>-<tgt> with
model.bin, source.spm and target.spm. The model identity recorded with every translation
includes the SHA-256 of model.bin, so a translation can be traced to the exact weights.
"""
from __future__ import annotations

import hashlib
import os
import re
import threading
from functools import lru_cache

from ..config import get_settings
from .base import ProviderError

NAME = "local_opus_mt"
# Release of the original weights each direction was converted from (see local/run-local.sh).
RELEASES = {("ar", "en"): "opus-mt-ar-en/opus-2019-12-18", ("en", "ar"): "opus-mt-eng-ara/opus-2021-02-23"}
TARGET_TOKEN = {("en", "ar"): ">>ara<<"}  # multi-target model: sentence-initial language token
MAX_SOURCE_TOKENS = 200
_lock = threading.Lock()
_SENTENCE_END = re.compile(r"(?<=[.!?؟…])\s+")


def _dir(source: str, target: str) -> str:
    return os.path.join(get_settings().local_mt_dir, f"{source}-{target}")


def configured(source: str = "ar", target: str = "en") -> bool:
    base = get_settings().local_mt_dir
    return bool(base) and all(os.path.isfile(os.path.join(_dir(source, target), f)) for f in ("model.bin", "source.spm", "target.spm"))


@lru_cache(maxsize=4)
def _weights_sha(source: str, target: str) -> str:
    h = hashlib.sha256()
    with open(os.path.join(_dir(source, target), "model.bin"), "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def model_id(source: str, target: str) -> str:
    return f"{RELEASES[(source, target)]}@ct2-int8:{_weights_sha(source, target)[:16]}"


@lru_cache(maxsize=4)
def _load(source: str, target: str):
    import ctranslate2
    import sentencepiece as spm

    d = _dir(source, target)
    threads = max(1, (os.cpu_count() or 2) - 1)
    translator = ctranslate2.Translator(d, device="cpu", compute_type="int8", inter_threads=1, intra_threads=threads)
    return translator, spm.SentencePieceProcessor(model_file=f"{d}/source.spm"), spm.SentencePieceProcessor(model_file=f"{d}/target.spm")


def _chunks(text: str, sp) -> list[str]:
    """Split long text at sentence ends, then by token budget, so nothing is truncated."""
    out: list[str] = []
    for sentence in _SENTENCE_END.split(text.strip()):
        words = sentence.split()
        buf: list[str] = []
        for w in words:
            buf.append(w)
            if len(sp.encode(" ".join(buf), out_type=str)) >= MAX_SOURCE_TOKENS:
                out.append(" ".join(buf))
                buf = []
        if buf:
            out.append(" ".join(buf))
    return out or [""]


def translate_batch(texts: list[str], source: str, target: str) -> tuple[list[str], dict]:
    if not texts:
        return [], {}
    if (source, target) not in RELEASES or not configured(source, target):
        raise ProviderError(f"On-device translation model {source}->{target} is not installed.", retryable=False)
    with _lock:
        translator, sp_src, sp_tgt = _load(source, target)
        prefix = TARGET_TOKEN.get((source, target))
        plan: list[int] = []
        batch: list[list[str]] = []
        for text in texts:
            parts = _chunks(text, sp_src)
            plan.append(len(parts))
            for part in parts:
                batch.append(([prefix] if prefix else []) + sp_src.encode(part, out_type=str))
        results = translator.translate_batch(batch, beam_size=4, max_batch_size=16, max_decoding_length=512)
    decoded = [sp_tgt.decode(r.hypotheses[0]) for r in results]
    out: list[str] = []
    i = 0
    for n in plan:
        out.append(" ".join(decoded[i : i + n]).strip())
        i += n
    return out, {"engine": "ctranslate2", "model": model_id(source, target), "beam_size": 4, "chunks": len(batch)}
