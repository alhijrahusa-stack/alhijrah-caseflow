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

## Run

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
