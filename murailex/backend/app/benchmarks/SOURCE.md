# Benchmark Lab evidence (held-out splits)

Imported into `benchmark_runs` at API start (`app/benchmark_import.py`); metrics are recomputed from
the stored per-item components. Row ids derive from each file's SHA-256.

- `fleurs-ar_eg-test-held_out-*.json` — Google FLEURS `ar_eg` test set (CC-BY-4.0). Human reference
  transcriptions as published; the held-out half of a deterministic group-hash split (items of the same
  sentence never straddle splits). Hypotheses are the exact production adapters (engine fingerprint in
  `parameters`). Critical entities: numeric, rule-extracted identically from reference and hypothesis.
- `ami-test-only_words-held_out-local_diarization.json` — AMI Meeting Corpus (CC-BY-4.0) test meetings
  IS1009a, ES2004a, TS3003a, EN2002a, Mix-Headset audio; references and UEMs from
  pyannote/AMI-diarization-setup `only_words`. Clustering threshold frozen on the development split
  (IS1008a, ES2011a) before this single evaluation. Protocol in the file.
