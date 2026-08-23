# Alhijrah Caseflow

Production deployment baseline for Alhijrah Caseflow.

## Runtime topology

- Railway: API/runtime and background services
- Supabase PostgreSQL: relational case data
- Cloudflare R2: private document/object storage
- Cloudflare: DNS, edge security and delivery

## Railway

The service starts with `npm start` and exposes:

- `GET /` — runtime identity
- `GET /health` — deployment health/configuration check

Railway secrets must be configured in the Railway dashboard. Never commit `.env` or production credentials.

Required initially:

- `DATABASE_URL`

R2/queue integration variables are listed in `.env.example` and should be added only as Railway secrets.

## Security baseline

- No production secrets in Git
- No customer documents in the repository
- Private object storage
- No-store API responses
- Security response headers
- Runtime configuration health check without exposing secret values

## Status

Deployment scaffold is ready. Full Caseflow application modules are added independently from infrastructure credentials.
