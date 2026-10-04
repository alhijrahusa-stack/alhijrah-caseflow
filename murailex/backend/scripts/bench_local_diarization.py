#!/usr/bin/env python3
"""Benchmark Lab: DER of the on-device diarization route against human RTTM annotations.

Runs the exact production adapter (same engine fingerprint) on each recording and scores it
with app.benchmark.diarization_error_rate inside the reference UEM. Never edits references.

    python scripts/bench_local_diarization.py --dataset-version ami-test-only_words \\
        --item ES2004a=/data/ES2004a.wav,/data/ES2004a.rttm,/data/ES2004a.uem --out der.json
"""
from __future__ import annotations

import argparse
import json
import os
import resource
import sys
import time

os.environ.setdefault("ENVIRONMENT", "local")

from app.benchmark import DER_PROTOCOL, diarization_error_rate  # noqa: E402
from app.providers.local_diarization import LocalDiarization  # noqa: E402


def read_rttm(path: str, file_id: str) -> list[tuple[float, float, str]]:
    turns = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            f = line.split()
            if len(f) >= 8 and f[0] == "SPEAKER" and f[1] == file_id:
                start, dur = float(f[3]), float(f[4])
                turns.append((start, start + dur, f[7]))
    return turns


def read_uem(path: str, file_id: str) -> tuple[float, float]:
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            f = line.split()
            if len(f) >= 4 and f[0] == file_id:
                return float(f[2]), float(f[3])
    raise SystemExit(f"no UEM line for {file_id}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset-version", required=True)
    ap.add_argument("--item", action="append", required=True, help="ID=wav,rttm,uem")
    ap.add_argument("--out", required=True)
    ap.add_argument("--split", default="held_out", choices=["development", "held_out"])
    ap.add_argument(
        "--expected-speakers", action="store_true",
        help="pass the reference speaker count as the intake 'expected speakers' (labelled operating mode)",
    )
    args = ap.parse_args()
    adapter = LocalDiarization()
    rows, totals = [], {"reference_speech_s": 0.0, "missed_s": 0.0, "false_alarm_s": 0.0, "confusion_s": 0.0}
    audio_s = infer_s = 0.0
    for spec in args.item:
        file_id, paths = spec.split("=", 1)
        wav, rttm, uem_path = paths.split(",")
        reference = read_rttm(rttm, file_id)
        expected = len({t[2] for t in reference}) if args.expected_speakers else None
        t0 = time.monotonic()
        raw = adapter.transcribe(wav, {"expected_speakers": expected})
        spent = time.monotonic() - t0
        hyp = [(t["start"] / 1000, t["end"] / 1000, t["speaker"]) for t in raw["turns"]]
        score = diarization_error_rate(reference, hyp, read_uem(uem_path, file_id))
        audio_s += raw["audio_seconds"]
        infer_s += spent
        for k in totals:
            totals[k] += score[k]
        rows.append({"item_id": file_id, **score, "audio_seconds": raw["audio_seconds"], "inference_seconds": round(spent, 2)})
        print(json.dumps(rows[-1]), file=sys.stderr, flush=True)
    der = (totals["missed_s"] + totals["false_alarm_s"] + totals["confusion_s"]) / totals["reference_speech_s"]
    out = {
        "kind": "der",
        "split": args.split,
        "commit_sha": os.environ.get("MURAILEX_COMMIT", "unknown"),
        "dataset_version": args.dataset_version,
        "protocol": DER_PROTOCOL,
        "provider": adapter.name,
        "parameters": adapter.info().parameters,
        "items": rows,
        "aggregate": {**{k: round(v, 2) for k, v in totals.items()}, "der": der},
        "inference_rtf": round(infer_s / audio_s, 4),
        "peak_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
        "operating_mode": "expected speaker count supplied at intake" if args.expected_speakers else "blind (speaker count estimated)",
        "ground_truth": "human RTTM annotations (AMI corpus, pyannote AMI-diarization-setup only_words)",
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print(json.dumps({k: out[k] for k in ("aggregate", "inference_rtf", "peak_rss_mb")}))


if __name__ == "__main__":
    main()
