#!/usr/bin/env python3
"""Run MURAILEX ASR quality scoring against authorized human ground truth.

Input JSON schema:
{
  "dataset_version": "...",
  "commit_sha": "...",
  "provider": "...",
  "model": "...",
  "locale": "ar-YE",
  "split": "development" | "held_out",
  "parameters": {},
  "environment": {},
  "audio_hours": 1.25,
  "items": [
    {
      "item_id": "...",
      "audio_sha256": "64 hex",
      "ground_truth": "...",
      "hypothesis": "...",
      "ground_truth_revision": "...",
      "ground_truth_reviewer": "...",
      "human_ground_truth": true,
      "critical_reference": [{"type":"money","text":"$500"}],
      "critical_hypothesis": [{"type":"money","text":"$500"}]
    }
  ]
}

This script scores one split at a time. It never generates ground truth. --persist writes the
measured result to benchmark_runs only after migrations have created the forensic schema.
"""
from __future__ import annotations

import argparse
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text

from app.benchmark import aggregate_scores, critical_entity_accuracy, score_transcript


def _persist(result: dict, payload: dict) -> str:
    from app.db import session_factory

    run_id = str(uuid.uuid4())
    metrics = result["metrics"]
    entity = result["critical_entity_accuracy"]
    with session_factory()() as db:
        db.execute(
            text(
                """
                INSERT INTO benchmark_runs (
                    id, dataset_version, split, commit_sha, provider, model, locale,
                    parameters, sample_count, audio_hours, raw_wer, normalized_wer,
                    raw_cer, normalized_cer, critical_entity_accuracy, der, der_protocol,
                    service_rtf, inference_rtf, end_to_end_rtf, environment,
                    ground_truth_status, executed_at
                ) VALUES (
                    CAST(:id AS uuid), :dataset_version, :split, :commit_sha, :provider, :model, :locale,
                    CAST(:parameters AS jsonb), :sample_count, :audio_hours, :raw_wer, :normalized_wer,
                    :raw_cer, :normalized_cer, CAST(:critical_entity_accuracy AS jsonb), NULL, NULL,
                    NULL, NULL, NULL, CAST(:environment AS jsonb), 'HUMAN VERIFIED', CAST(:executed_at AS timestamptz)
                )
                """
            ),
            {
                "id": run_id,
                "dataset_version": result["dataset_version"],
                "split": result["split"],
                "commit_sha": result["commit_sha"],
                "provider": result["provider"],
                "model": result["model"],
                "locale": result["locale"],
                "parameters": json.dumps(payload.get("parameters") or {}, ensure_ascii=False, sort_keys=True),
                "sample_count": result["sample_count"],
                "audio_hours": payload.get("audio_hours"),
                "raw_wer": metrics["raw_wer"]["rate"],
                "normalized_wer": metrics["normalized_wer"]["rate"],
                "raw_cer": metrics["raw_cer"]["rate"],
                "normalized_cer": metrics["normalized_cer"]["rate"],
                "critical_entity_accuracy": json.dumps(entity if isinstance(entity, dict) else None, ensure_ascii=False, sort_keys=True),
                "environment": json.dumps(payload.get("environment") or {}, ensure_ascii=False, sort_keys=True),
                "executed_at": result["executed_at"],
            },
        )
        db.commit()
    return run_id


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--persist", action="store_true")
    args = parser.parse_args()

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    split = payload.get("split")
    if split not in {"development", "held_out"}:
        raise SystemExit("split must be development or held_out")
    required_meta = ("dataset_version", "commit_sha", "provider", "model", "locale")
    missing_meta = [key for key in required_meta if not str(payload.get(key) or "").strip()]
    if missing_meta:
        raise SystemExit("missing benchmark metadata: " + ", ".join(missing_meta))

    rows = payload.get("items") or []
    if not rows:
        raise SystemExit("benchmark contains no items")
    scores = []
    critical_reference = []
    critical_hypothesis = []
    seen_audio: set[str] = set()
    for row in rows:
        if row.get("human_ground_truth") is not True:
            raise SystemExit(f"{row.get('item_id')}: human_ground_truth must be true")
        if not str(row.get("ground_truth_reviewer") or "").strip():
            raise SystemExit(f"{row.get('item_id')}: ground_truth_reviewer is required")
        if not str(row.get("ground_truth_revision") or "").strip():
            raise SystemExit(f"{row.get('item_id')}: ground_truth_revision is required")
        digest = str(row.get("audio_sha256") or "")
        if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
            raise SystemExit(f"{row.get('item_id')}: invalid audio_sha256")
        if digest in seen_audio:
            raise SystemExit(f"duplicate audio_sha256 in split: {digest}")
        seen_audio.add(digest)
        scores.append(score_transcript(str(row.get("ground_truth") or ""), str(row.get("hypothesis") or "")))
        critical_reference.extend(row.get("critical_reference") or [])
        critical_hypothesis.extend(row.get("critical_hypothesis") or [])

    result = {
        "dataset_version": payload["dataset_version"],
        "split": split,
        "commit_sha": payload["commit_sha"],
        "provider": payload["provider"],
        "model": payload["model"],
        "locale": payload["locale"],
        "executed_at": datetime.now(timezone.utc).isoformat(),
        "sample_count": len(rows),
        "ground_truth_status": "HUMAN VERIFIED",
        "metrics": aggregate_scores(scores),
        "critical_entity_accuracy": (
            critical_entity_accuracy(critical_reference, critical_hypothesis)
            if critical_reference
            else "NOT MEASURED"
        ),
    }
    if args.persist:
        result["benchmark_run_id"] = _persist(result, payload)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
