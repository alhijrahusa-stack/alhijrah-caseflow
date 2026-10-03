#!/usr/bin/env python3
"""Benchmark Lab runner for the on-device ASR route (ENVIRONMENT=local).

Decodes every item of a human-transcribed corpus with the exact production adapter
(same engine fingerprint and decode configuration as live processing), measures real
resource use, assigns each item deterministically to the development or held-out split, and
writes scorer input files for scripts/run_benchmark.py. It never creates or edits ground truth.

Corpus manifest (TSV, UTF-8, header required): item_id, audio_path, ground_truth[, tags]

    python scripts/bench_local_asr.py --manifest corpus.tsv --dataset-version fleurs-ar_eg-test \\
        --out-dir bench/ --limit 120
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import resource
import sys
import time
from pathlib import Path

os.environ.setdefault("ENVIRONMENT", "local")

from app.benchmark import ENTITY_EXTRACTION_VERSION, extract_numeric_entities  # noqa: E402
from app.providers import registry  # noqa: E402
from app.providers.local_whisper import LocalWhisper, hardware_profile  # noqa: E402


def split_of(item_id: str) -> str:
    """Deterministic 50/50 split; the held-out half is never used to tune anything."""
    group = item_id.split("/", 1)[0]  # items sharing a group (e.g. the same sentence) never straddle splits
    return "held_out" if int(hashlib.sha256(group.encode()).hexdigest(), 16) % 2 else "development"


def file_sha(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def duration_s(path: str) -> float:
    import subprocess

    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def run(adapter: LocalWhisper, rows: list[dict[str, str]], locale: str) -> tuple[list[dict], dict]:
    items = []
    audio_total = decode_total = 0.0
    for i, row in enumerate(rows, 1):
        path = row["audio_path"]
        dur = duration_s(path)
        t0 = time.monotonic()
        raw = adapter.transcribe(path, {"language_locale": locale})
        spent = time.monotonic() - t0
        norm = adapter.normalize(raw)
        hyp = " ".join(t["text"] for t in norm["tokens"])
        audio_total += dur
        decode_total += spent
        items.append(
            {
                "item_id": row["item_id"],
                "audio_sha256": file_sha(path),
                "ground_truth": row["ground_truth"],
                "hypothesis": hyp,
                "ground_truth_revision": "corpus-release",
                "ground_truth_reviewer": "corpus publisher (human transcription)",
                "human_ground_truth": True,
                # Numeric entities are extracted by the same rule from the human reference and
                # the hypothesis; the reference text itself is never edited.
                "critical_reference": [{"item_id": row["item_id"], **e} for e in extract_numeric_entities(row["ground_truth"])],
                "critical_hypothesis": [{"item_id": row["item_id"], **e} for e in extract_numeric_entities(hyp)],
                "critical_extraction": ENTITY_EXTRACTION_VERSION,
                "split": split_of(row["item_id"]),
                "duration_s": round(dur, 3),
                "decode_s": round(spent, 3),
            }
        )
        print(f"[{adapter.name}] {i}/{len(rows)} {row['item_id']} {dur:.1f}s audio in {spent:.1f}s", file=sys.stderr, flush=True)
    peak_rss_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    return items, {
        "audio_seconds": round(audio_total, 3),
        "decode_seconds": round(decode_total, 3),
        "inference_rtf": round(decode_total / audio_total, 4) if audio_total else None,
        "peak_rss_mb": round(peak_rss_mb, 1),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--dataset-version", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--locale", default="ar")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument(
        "--numeric-first", action="store_true",
        help="select every item whose reference contains digits before the others (entity coverage)",
    )
    ap.add_argument("--commit-sha", default=os.environ.get("MURAILEX_COMMIT", "unknown"))
    args = ap.parse_args()

    with open(args.manifest, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh, delimiter="\t"))
    rows.sort(key=lambda r: r["item_id"])
    if args.numeric_first:
        rows.sort(key=lambda r: 0 if extract_numeric_entities(r["ground_truth"]) else 1)
    if args.limit:
        rows = rows[: args.limit]
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    for adapter in (registry.local_primary(), registry.local_verifier()):
        items, perf = run(adapter, rows, args.locale)
        info = adapter.info({"language_locale": args.locale})
        for split in ("development", "held_out"):
            chosen = [x for x in items if x["split"] == split]
            payload = {
                "dataset_version": args.dataset_version,
                "commit_sha": args.commit_sha,
                "provider": adapter.name,
                "model": info.model,
                "locale": args.locale,
                "split": split,
                "parameters": info.parameters,
                "environment": {**hardware_profile(), **perf},
                "audio_hours": round(sum(x["duration_s"] for x in chosen) / 3600, 4),
                "items": chosen,
            }
            path = out / f"{adapter.name}-{split}.json"
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
            print(json.dumps({"written": str(path), "items": len(chosen), **perf}), flush=True)


if __name__ == "__main__":
    main()
