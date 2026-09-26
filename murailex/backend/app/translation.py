"""Separate derived translation document aligned to source timestamps.

The source forensic transcript is read, never written. Uncertainty markers and speaker
labels are rendered with a fixed deterministic mapping rather than machine-translated.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from . import audit
from .canonical import canonical_json, sha256_hex
from .models import TranscriptRevision, Translation
from .pipeline import transcript as tx
from .pipeline.text import MARKER_TRANSLATIONS
from .providers import translate as gt

MODES = {
    "ar_en": ("ar", "en"),
    "en_ar": ("en", "ar"),
    "bilingual": ("ar", "en"),
}


def _pieces(seg: dict) -> list[tuple[str, str]]:
    """Split a segment into ("text", s) and ("marker", s) runs, preserving order."""
    out: list[tuple[str, str]] = []
    buf: list[str] = []
    for it in seg["items"]:
        if it["kind"] == "marker" or it["text"] in MARKER_TRANSLATIONS:
            if buf:
                out.append(("text", " ".join(buf)))
                buf = []
            out.append(("marker", it["text"]))
        else:
            buf.append(it["text"])
    if buf:
        out.append(("text", " ".join(buf)))
    return out


def run_translation(db: Session, tr: Translation) -> None:
    if tr.status == "succeeded":
        return
    rev = db.get(TranscriptRevision, tr.source_revision_id)
    assert rev is not None and rev.status == "locked"
    tr.status = "running"
    db.commit()
    plan = []
    texts: list[str] = []
    for seg in rev.content["segments"]:
        pieces = _pieces(seg)
        for kind, s in pieces:
            if kind == "text":
                texts.append(s)
        plan.append((seg, pieces))
    translated: list[str] = []
    raw_batches = []
    for i in range(0, len(texts), 100):
        out, raw = gt.translate_batch(texts[i : i + 100], tr.source_language, tr.target_language)
        translated.extend(out)
        raw_batches.append(raw)
    it = iter(translated)
    segments = []
    for seg, pieces in plan:
        rendered = []
        for kind, s in pieces:
            if kind == "text":
                rendered.append(next(it))
            else:
                rendered.append(MARKER_TRANSLATIONS[s] if tr.target_language == "en" else s)
        sid = seg["speaker"]
        label = f"[Speaker {sid[1:]}]" if (sid and tr.target_language == "en") else tx.speaker_label(sid)
        segments.append({
            "segment_id": seg["id"], "start_ms": seg["start_ms"], "end_ms": seg["end_ms"], "speaker": sid,
            "speaker_label": label, "source_text": tx.segment_text(seg), "translation": " ".join(rendered),
        })
    tr.segments = segments
    tr.sha256 = sha256_hex(canonical_json({"source_revision_sha256": rev.sha256, "mode": tr.mode, "segments": segments}))
    tr.completed_at = datetime.now(timezone.utc)
    tr.status = "succeeded"
    audit.record(db, "translation_completed", actor_label="system", recording_id=tr.recording_id,
                 details={"translation_id": str(tr.id), "source_revision_id": str(rev.id), "mode": tr.mode,
                          "provider": tr.provider, "model": tr.model, "sha256": tr.sha256, "segments": len(segments)})
    db.commit()
