# Production Deployment Steps

**Release Branch:** `release/security-audit-2026-09-18`
**Base:** `main` @ `37d1c23` (contains verified RC `f9679d4`)
**Security Fixes:** 8 files, 25 insertions / 19 deletions

---

## Pre-Deployment Checklist

- [ ] All migrations applied (see below)
- [ ] All environment variables set (see below)
- [ ] `verify_production.sh` passes against staging first
- [ ] PR merged to `main`
- [ ] Railway auto-deploys from `main` push (or manual trigger)

---

## Migrations

### Migration Files (ordered)

1. `supabase/schema.sql` — baseline schema (applied first)
2. `supabase/migrations/20260824030000_core_platform.sql`
3. `supabase/migrations/20260824040000_authorization_model.sql`
4. `supabase/migrations/20260824050000_category_access_grants.sql`
5. `supabase/migrations/20260827010000_phase1_platform.sql`
6. `supabase/migrations/20260828010000_bulk_import_center.sql`
7. `supabase/migrations/20260829010000_staff_forms_platform.sql`
8. `supabase/migrations/20260830120000_p0_p1_security_hardening.sql`
9. `supabase/migrations/20260830130000_user_database_authorization_floor.sql`
10. `supabase/migrations/20260830140000_immutable_document_versioning.sql`
11. `supabase/migrations/20260830150000_durable_background_processing.sql`
12. `supabase/migrations/20260830160000_persistent_document_intelligence.sql`
13. `supabase/migrations/20260830170000_verified_canonical_commit_layer.sql`
14. `supabase/migrations/20260830180000_deterministic_form_engine.sql`
15. `supabase/migrations/20260830190000_hybrid_discovery_review_integrity.sql`
16. `supabase/migrations/20260901112500_deterministic_case_review.sql`
17. `supabase/migrations/20260901120000_agency_request_evidence_matrix.sql`
18. `supabase/migrations/20260901130000_dual_case_portals.sql`
19. `supabase/migrations/20260903120000_functional_convergence.sql`
20. `supabase/migrations/20260904130000_document_review_authorization.sql`
21. `supabase/migrations/20260904140000_atomic_document_review_convergence.sql`

### Production Migration State: UNVERIFIED

Production migration state cannot be queried from this environment. To determine which migrations are pending:

```bash
# Connect to the production Supabase database and check applied migrations:
psql "$PRODUCTION_DATABASE_URL" -c "SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;"

# Compare the output against the migration filenames above.
# Only run migrations not yet in supabase_migrations.schema_migrations.

# To apply a single pending migration:
psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 -X -f supabase/migrations/<filename>.sql
```

**Never re-run a migration that has already been applied.**

---

## Environment Variables Required

### Core (required)

| Variable | Purpose |
|----------|---------|
| `PORT` | Server listen port (default: 3000) |
| `APP_BASE_URL` | Public-facing URL of the application |
| `CORS_ORIGINS` | Allowed CORS origins |
| `INTERNAL_API_KEY` | Internal API authentication key |
| `OWNER_EMAIL` | Application owner's email address |
| `LOGIN_THROTTLE_SECRET` | HMAC secret for login rate limiting |

### Supabase (required)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |

### Cloudflare R2 Storage (required)

| Variable | Purpose |
|----------|---------|
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET` | R2 bucket name |
| `R2_ENDPOINT` | R2 endpoint (auto-derived from R2_ACCOUNT_ID if omitted) |

### Email (optional but recommended)

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Resend API key for transactional email |
| `RESEND_FROM_EMAIL` | Sender email address |

### AI Review (optional)

| Variable | Purpose |
|----------|---------|
| `AI_PROVIDER` | AI provider name |
| `AI_PROVIDER_URL` | AI provider endpoint URL |
| `AI_PROVIDER_MODEL` | AI model identifier |
| `AI_PROVIDER_API_KEY` | AI provider API key |

### Railway (auto-injected by platform)

| Variable | Purpose |
|----------|---------|
| `RAILWAY_ENVIRONMENT` | Railway environment name |
| `RAILWAY_PROJECT_ID` | Railway project ID |
| `RAILWAY_GIT_COMMIT_SHA` | Deployed commit SHA |

---

## Deployment Path

### Platform: Railway

- **Config:** `railway.toml` — Dockerfile build, start via `npm start` (`node src/server.js`)
- **Health check:** `GET /ready` (60s timeout)
- **Restart policy:** ON_FAILURE, max 5 retries
- **Deploy trigger:** Push to `main` branch triggers auto-deploy via Railway's GitHub integration
- **Production URL:** `https://alhijrah-caseflow-production-716b.up.railway.app`

### CI: GitHub Actions

- **Workflow:** `.github/workflows/p0-p1-verification.yml`
- **Triggers:** push to `main`/`p0-p1-hardening`, PRs to `main`, manual
- **Steps:** PostgreSQL 17 service, full migration chain, database adversarial suites, npm ci, npm test, Playwright E2E, production deployment verification (main branch only)

### Deploy Sequence

1. Merge PR to `main`
2. GitHub Actions CI runs automatically
3. Railway detects `main` push and builds Docker image
4. Railway deploys new container with health check on `/ready`
5. CI workflow (on `main` push) runs production verification step — polls `/ready` for SHA match

### Rollback

1. **Railway dashboard:** Redeploy the previous successful deployment from Railway's deployment history
2. **Git-level:** The rollback branch `rollback/production-pre-release-2026-09-18-d09b4192` exists at the pre-release state

---

## Post-Deploy Verification

```bash
PROD_HOST=https://alhijrah-caseflow-production-716b.up.railway.app bash verify_production.sh
```
