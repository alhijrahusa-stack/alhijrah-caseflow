"""Import committed Benchmark Lab results (app/benchmarks/*.json) into benchmark_runs.

Each file is the stored evidence of one held-out run: for ASR the full scorer input (human
reference + exact hypothesis per item, engine parameters including the engine fingerprint);
for diarization the per-item DER components. Metrics are recomputed here from those stored
components, so a persisted row is reproducible from the committed file. The row id is derived
from the file's SHA-256, so imports are idempotent and the id is stable across deployments.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from .benchmark import DER_PROTOCOL, aggregate_scores, corpus_id, critical_entity_accuracy, score_transcript
from .forensic_models import BenchmarkRun

log = logging.getLogger("murailex.benchmarks")
BENCH_DIR = os.path.join(os.path.dirname(__file__), "benchmarks")


def run_id_for(data: bytes) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, "murailex-benchmark:" + hashlib.sha256(data).hexdigest())


def _asr_row(rid: uuid.UUID, p: dict[str, Any]) -> BenchmarkRun:
    items = p["items"]
    if not items or any(i.get("human_ground_truth") is not True for i in items):
        raise ValueError("ASR benchmark items must all carry human ground truth")
    pinned = p.get("corpus_id")
    measured = corpus_id(items)
    if pinned and pinned != measured:
        raise ValueError(f"held-out corpus identity mismatch: pinned {pinned}, measured {measured}")
    metrics = aggregate_scores([score_transcript(i["ground_truth"], i["hypothesis"]) for i in items])
    ref = [e for i in items for e in i.get("critical_reference") or []]
    hyp = [e for i in items for e in i.get("critical_hypothesis") or []]
    return BenchmarkRun(
        id=rid, dataset_version=p["dataset_version"], split=p["split"], commit_sha=p["commit_sha"],
        provider=p["provider"], model=p["model"], locale=p["locale"], parameters=p["parameters"],
        sample_count=len(items), audio_hours=p.get("audio_hours"),
        raw_wer=metrics["raw_wer"]["rate"], normalized_wer=metrics["normalized_wer"]["rate"],
        raw_cer=metrics["raw_cer"]["rate"], normalized_cer=metrics["normalized_cer"]["rate"],
        critical_entity_accuracy=critical_entity_accuracy(ref, hyp) if ref else None,
        inference_rtf={"value": (p.get("environment") or {}).get("inference_rtf"), "scope": (p.get("environment") or {}).get("rtf_scope")},
        environment={**(p.get("environment") or {}), "corpus_id": measured}, ground_truth_status="HUMAN VERIFIED",
        executed_at=datetime.fromisoformat(p["executed_at"]) if p.get("executed_at") else datetime.now(timezone.utc),
    )


def _der_row(rid: uuid.UUID, p: dict[str, Any]) -> BenchmarkRun:
    items = p["items"]
    tot = {k: sum(float(i[k]) for i in items) for k in ("reference_speech_s", "missed_s", "false_alarm_s", "confusion_s")}
    der = (tot["missed_s"] + tot["false_alarm_s"] + tot["confusion_s"]) / tot["reference_speech_s"]
    params = p["parameters"]
    return BenchmarkRun(
        id=rid, dataset_version=p["dataset_version"], split=p["split"], commit_sha=p.get("commit_sha", "unknown"),
        provider=p["provider"], model=params.get("embedding_model", "diarization"), locale=p.get("locale", "multi"),
        parameters=params, sample_count=len(items), audio_hours=sum(float(i["audio_seconds"]) for i in items) / 3600,
        der=der, der_protocol={"protocol": DER_PROTOCOL, "operating_mode": p.get("operating_mode"), "totals_s": tot},
        inference_rtf={"value": p.get("inference_rtf")}, environment={"peak_rss_mb": p.get("peak_rss_mb")},
        ground_truth_status="HUMAN VERIFIED", executed_at=datetime.now(timezone.utc),
    )


def import_benchmarks(db: Session) -> list[str]:
    imported: list[str] = []
    if not os.path.isdir(BENCH_DIR):
        return imported
    for name in sorted(os.listdir(BENCH_DIR)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(BENCH_DIR, name), "rb") as fh:
            data = fh.read()
        rid = run_id_for(data)
        if db.get(BenchmarkRun, rid) is not None:
            continue
        payload = json.loads(data)
        row = _der_row(rid, payload) if payload.get("kind") == "der" else _asr_row(rid, payload)
        db.add(row)
        imported.append(f"{name}:{rid}")
    db.commit()
    if imported:
        log.info("imported benchmark runs: %s", imported)
    return imported
