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
- Translation (Google Cloud Translation NMT) is a separate, timestamp-aligned derived document created only from a locked revision.
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
- **Speakers:** there is no on-device diarization. Speakers stay `[متحدث غير محدد]` until a person assigns them.
- **Readiness:** local routing is labelled **NOT BENCHMARKED**. On a fresh install, upload a recording. When processing is blocked, an admin presses **Run engine self-test** on that recording, then **Retry processing**. This is a real self-test, run once per dialect route.
- **Storage:** evidence is stored write-once under `murailex/.local-data/objects`. PostgreSQL lives in `murailex/.local-data/pg`, and the TLS material in `murailex/.local-data/tls`. All of it survives restarts.

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
