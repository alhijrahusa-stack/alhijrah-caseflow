# MURAILEX — Forensic Audio Intelligence

Forensic verbatim transcription for Arabic/English recordings. **The original audio recording is the controlling source.**

## Layout

- `backend/` — FastAPI, SQLAlchemy, Alembic, PostgreSQL, S3-compatible storage, FFmpeg, durable Postgres job queue (`python -m app.worker`).
- `frontend/` — Next.js 16 / React 19 / TypeScript / Tailwind 4 / shadcn-style UI / WaveSurfer 8, installable PWA, Arabic RTL and English LTR.
- `docker-compose.yml` + `deploy/Caddyfile` — production stack (HTTPS via Caddy, API, 2 workers, web, PostgreSQL 17, MinIO with versioning, Object Lock and KMS SSE).
- `.github/workflows/murailex.yml` — lint, typecheck, backend tests, frontend tests, browser E2E, production build, GHCR images.

## Evidence rules enforced in code

- Original bytes are stored once (S3 multipart, versioned, Object Lock when configured); SHA-256 is computed from the stored object at upload and re-verified before processing and before every evidence package.
- FFmpeg only ever writes derived copies (`derived/…`), each hashed and audited.
- Database triggers make `audit_events` append-only, original evidence metadata immutable, locked revisions immutable, completed provider runs/exports immutable, and forbid deletes.
- Audit events are SHA-256 hash-chained (`GET /api/audit/verify`).
- No generative model touches the source transcript. Consensus is deterministic (time-constrained token alignment); unresolved evidence stays visible as a dispute and must be resolved by a person: accept a candidate, type exactly what is heard, or mark `[غير مسموع]`, `[اسم غير واضح]`, `[رقم غير واضح]`, `[تداخل]`.
- Speakers are `[المتحدث N]`; a real name requires explicit human verification.
- Translation is a separate, timestamp-aligned derived document created only from a locked revision. It uses Google Cloud Translation NMT on the production stack and on-device OPUS-MT in local mode.
- Exports (TXT/DOCX/PDF/JSON/Evidence Package ZIP with `manifest.json` and `SHA256SUMS.txt`) are generated only from locked revisions.

## Engines

| Role | Provider | Model |
| --- | --- | --- |
| Primary ASR | AssemblyAI | `universal-3-5-pro` |
| Primary ASR | Google Speech-to-Text V2 BatchRecognize | `chirp_3`, `ar-YE` (configurable) |
| Diarization | pyannoteAI | `precision-2` |
| Verification (disputed regions ±3 s) | OpenAI | `gpt-4o-transcribe-diarize` |
| Verification (disputed regions ±3 s) | Deepgram | `nova-3`, `ar` |

A provider without credentials reports **NOT CONFIGURED** (Settings → Advanced). With no primary engine configured a recording stops at `provider_not_configured`; nothing is fabricated.

## Run locally (single machine + phone on the same private LAN)

```bash
murailex/local/run-local.sh          # first run installs, initialises and builds
murailex/local/run-local.sh stop
```

The launcher prints:

- **Laptop:** `https://localhost:8443`
- **Phone:** `https://<laptop-LAN-IP>:8443`, from the same Wi-Fi.
- **One-time phone trust:** open `http://<laptop-LAN-IP>:8080/murailex-local-ca.crt` on the phone and install it as a trusted certificate.
  - iOS: Settings → General → VPN & Device Management → install, then Settings → General → About → Certificate Trust Settings → enable.
  - Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate.
  - Without this, the browser shows a certificate warning. Phones only allow the microphone on HTTPS pages.
- **Login:** the admin email is printed. The password is generated on first run and stored only in `murailex/.local-data/secrets.env` (mode 600). Neither is committed.

Details:

- **Network exposure:** only the HTTPS gateway (8443) and the certificate-download page (8080) listen on the LAN. API, web server and PostgreSQL bind to 127.0.0.1. Allow 8443/8080 through the laptop's firewall for the phone to connect. Set `MURAILEX_LAN_IP` if the wrong interface is detected.
- **Requirements:** Linux (or WSL2 with port forwarding), Python 3.11+, Node.js 22+, PostgreSQL 15+ server binaries, `ffmpeg`, `openssl`, and `fonts-noto-core` / `fonts-dejavu-core` for PDF export. The first transcription downloads the Whisper models (about 4.5 GB).
- **ASR:** `ENVIRONMENT=local` routes every Arabic locale to on-device faster-whisper `large-v3` (int8, CPU) as the primary engine. faster-whisper `medium` verifies disputed regions.
  - Decoding has no VAD, no no-speech skipping and no prompt, so no part of the recording is silently dropped.
  - Audio never leaves the machine.
  - The worker runs at lower CPU priority and leaves one core free so the UI stays responsive during transcription.
- **Speakers:** on-device diarization assigns anonymous labels (see below); naming a speaker is a human act. If the diarization models are absent, speakers stay `[متحدث غير محدد]`.
- **Readiness:** local routing is labelled **NOT BENCHMARKED**. On a fresh install, upload a recording. When processing is blocked, an admin presses **Run engine self-test** on that recording, then **Retry processing**. This is a real self-test, run once per dialect route.
- **Storage:** evidence is stored write-once under `murailex/.local-data/objects`. PostgreSQL lives in `murailex/.local-data/pg`, and the TLS material in `murailex/.local-data/tls`. All of it survives restarts.

### Long-form processing (up to 2 hours, configurable)

- **Limit:** `MAX_RECORDING_DURATION_SECONDS` (default 7200) is enforced once, at ingestion. Longer recordings are rejected with the measured length and the limit.
- **Windows:** audio is decoded in windows of about 10 min. Each boundary is placed at a pause within ±90 s of the target point when one exists, and every window carries 15 s of overlap on each side. Merging is deterministic: each word belongs to the window whose own interval contains its midpoint.
- **Checkpoints:** every window is checkpointed (input SHA-256 + exact engine fingerprint). A worker crash, machine restart or browser close resumes from the last checkpoint and never restarts from minute zero.
- **Fairness:** after each new window a long job yields if other work is waiting, so one 2-hour recording cannot monopolise the worker.
- **Progress:** the processing card shows the real decoded position ("window 3/12 · decoded 0:30:00 of 1:59:59"). No estimated percentages are shown.

### Engine validation (automatic)

- Each route is identified by an engine fingerprint: engine and CTranslate2 versions, model snapshot revision, device, compute type and decode/windowing configuration.
- At worker start, every route whose fingerprint has no passing real self-test is tested automatically on a bundled CC0 real-speech canary (`local/canary`).
- Uploads made meanwhile wait for validation instead of failing.
- A route that has passed is not re-tested until its fingerprint changes.

### Verification and evidence

- **Independent verifier:** a second, independent engine (`medium`) decodes the full recording. Every primary word is aligned against it deterministically: `CONFIRMED` (same comparison key) or `LOW_CONFIDENCE` (not confirmed). Text is never changed.
- **Verification Confidence (`murailex.vc/1`):** confirmed words / primary words. It is an inter-engine agreement rate, not accuracy against ground truth.
- **Disputes:** critical-risk regions (numbers, money, dates, names, negations, overlap…) still become disputes for human review.
- **Audio quality (`murailex.aq/1`):** CLEAN / ACCEPTABLE / NOISY / HEAVY_NOISE / LOW_VOLUME / CLIPPED / TELEPHONE / COMPRESSED / DEGRADED, each with its measured reason. Quality never stops a job and never changes the route without benchmark evidence.
- **Signing:** evidence packages carry `manifest.sig` (Ed25519 over `manifest.json`) and `public-key.pem`. Verify with `openssl pkeyutl -verify -pubin -inkey public-key.pem -rawin -in manifest.json -sigfile manifest.sig`.
- **Export validation:** every export is structurally validated, written, read back and re-hashed before it is recorded.
- **Benchmark Lab:** `scripts/bench_local_asr.py` decodes a human-transcribed corpus with the exact production adapter. It splits items by group into development and held-out sets, and records RTF and peak RAM for `scripts/run_benchmark.py` to score.

### On-device diarization and translation

- **Diarization:** sherpa-onnx runs pyannote segmentation-3.0 (MIT) and WeSpeaker ResNet34 VoxCeleb embeddings (CC-BY-4.0) on the CPU.
  - The launcher installs the models, pinned by SHA-256.
  - The route is fingerprinted and self-tested exactly like ASR.
  - It is required once installed. Without it, speakers stay unattributed and are never inferred.
  - An expected speaker count given at intake fixes the number of clusters.
- **DER:** `scripts/bench_local_diarization.py` scores the production adapter against human RTTM within the UEM. The protocol is NIST DER: 10 ms frames, overlap scored, no collar, optimal mapping.
- **Translation:** OPUS-MT ar→en and en→ar (CC-BY-4.0) runs through CTranslate2 int8.
  - The launcher downloads the original releases, pinned by SHA-256, and converts them.
  - Every translation records the release and the model hash.
  - Long segments are chunked, never truncated.
  - A translation is a derived reference document, not evidence. In local mode, text never leaves the machine.

### Accounts, sessions and cases

- **Two-factor authentication:** TOTP (RFC 6238), enrolled in Settings → Security.
  - Secrets are encrypted at rest. Codes are single-use per 30 s step.
  - Enrolment signs out every session that lacks the second factor.
- **Sessions:** Settings lists active sessions (device, IP, last seen). You can sign out one session or all others. A password change signs out the others.
- **Cases:** recordings can be filed in an owner-scoped case, either from the recording page or by filtering the list. Filing is audited and never touches a recording, transcript or hash.
- **Contracts:** every request body is strict: no type coercion, unknown fields rejected. Evidence-critical responses (recording, revision, upload session, export) are validated in the browser with Zod.

## Run (production stack)

```bash
cp .env.example .env   # fill in secrets and provider keys
docker compose up -d --build
```

## Verify locally

```bash
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/ruff check app tests && .venv/bin/mypy app && .venv/bin/pytest -q      # needs PostgreSQL + ffmpeg
cd ../frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build
npx playwright test    # starts the real API + worker + S3 emulator; ASR responses from test fixtures
```

Test fixtures (`backend/tests/fixtures`, `app/providers/fixture.py`) are refused by the provider registry unless `ENVIRONMENT=test`.
