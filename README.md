# Alhijrah Caseflow

Production backend for Alhijrah Caseflow.

## Runtime topology

- Railway: Node.js API/runtime
- Supabase PostgreSQL: case, document metadata, and event data
- Cloudflare R2: private document/object storage
- Cloudflare: DNS, edge security and delivery

## Runtime endpoints

- `GET /` — runtime identity
- `GET /health` — liveness
- `GET /ready` — integration readiness
- `GET /api/v1/cases` — list cases
- `POST /api/v1/cases` — create a case
- `GET /api/v1/cases/:id` — retrieve a case
- `PATCH /api/v1/cases/:id` — update a case
- `POST /api/v1/documents/presign` — create a 15-minute private R2 upload URL
- `POST /api/v1/documents/download-url` — create a 5-minute private R2 download URL
- `DELETE /api/v1/documents` — delete an R2 object

All `/api/*` routes require `X-API-Key` matching the Railway secret `INTERNAL_API_KEY`.

## Railway variables

Required for full readiness:

- `INTERNAL_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `R2_ACCOUNT_ID` or `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

Optional:

- `SUPABASE_ANON_KEY`
- `DATABASE_URL`
- `CORS_ORIGINS`
- `APP_BASE_URL`
- `REDIS_URL`

Never commit production credentials.

## Supabase

Run `supabase/schema.sql` once in the Supabase SQL editor. It creates:

- `cases`
- `documents`
- `case_events`

RLS is enabled and direct `anon` / `authenticated` access is revoked. The backend uses the server-only Supabase service-role key.

## Security baseline

- Server-only database credentials
- Private R2 object storage
- Short-lived presigned URLs
- Timing-safe internal API-key verification
- Request size limit
- CORS allowlist support
- No-store API responses
- HSTS, CSP, frame, referrer, and MIME hardening headers
- No production secrets or customer documents in Git
