# CASEFLOW TFWP Desk — Phase 0 Isolation Plan

Status: **DRAFT — awaiting owner approval. No code has been written.**
Date: 2026-11-09
Source spec: `services/tfwp-desk/docs/BUILD_SPEC.md` (verbatim copy of the owner's spec, SHA-256 `0435179c…7ccdc`).
Prototype: `services/tfwp-desk/docs/prototype/alhijrah_tfwp_system.html` (owner-supplied, SHA-256 `5e57087a…eedf391`).

Everything below was read from the repository at commit `1f58220`. Items that could not be checked from the
repository (live Railway, Supabase, Cloudflare and Vercel settings) are marked **NOT VERIFIED**.

---

## 1. Inventory of existing systems (read-only)

### 1.1 Services in the repository

| # | System | Location | Runtime | Where it runs (per repo files) |
|---|---|---|---|---|
| A | **Alhijrah Caseflow** (root app) | `src/`, `api/`, `supabase/`, `test/`, `e2e/` | Node 22 ESM, plain HTML + `src/public/app.js` | Railway (`railway.toml`, root `Dockerfile` copies `src/` only), URL in repo: `alhijrah-caseflow-production-716b.up.railway.app`. Also a root `vercel.json` routing everything to `api/index.js` |
| B | **Career Gate** | `career-gate/` | Next.js 16, TypeScript, Tailwind | Vercel, Root Directory `career-gate` (`career-gate/README.md`), URL in repo: `alhijrah-caseflow.vercel.app` |
| C | **MURAILEX** | `murailex/` | FastAPI + Next.js, Docker Compose | Self-hosted compose stack (own Postgres 17 + MinIO). Its README references `.github/workflows/murailex.yml`, which does **not** exist at the repo root, so it has no active CI here |

No `services/` directory existed before this phase.

### 1.2 Databases and schemas

| System | Database | Schemas used | Tables |
|---|---|---|---|
| A | Supabase Postgres (project **NOT VERIFIED**) | `public` only; no `auth.*` references in `supabase/schema.sql` or its 20 migrations | 58 tables, incl. `clients`, `cases`, `documents`, `tasks`, `appointments`, `audit_events`, `case_events`, `case_notes`, `app_users`, `roles`, `teams`, … |
| B | Supabase Postgres (project **NOT VERIFIED**) | `public`, `career_gate_private`; references `auth.users` (FK from `public.staff.auth_user_id`), `auth.uid()`, `storage.buckets`, `vault.secrets`, `realtime.messages`; extension `vector` | 61 tables, incl. `clients`, `documents`, `document_access_log`, `notes`, `jobs`, `tasks`, `appointments`, `security_events`, `rate_limits`, … |
| C | Own Postgres 17 container | Alembic-managed | not relevant to Supabase |

Finding: A and B both create `public.clients`, `public.documents`, `public.document_extractions`, `public.tasks`
and `public.appointments` with different shapes. They therefore cannot share one `public` schema; they are on
separate Supabase projects (or one of them is not deployed). Which project is which is **NOT VERIFIED**.

Name collisions with this spec: `clients`, `cases`, `documents`, `document_access_log`, `notes`, `jobs`
already exist in `public` in A and/or B. All TFWP objects will be created and referenced **schema-qualified as
`tfwp.*`**, every TFWP function will set `search_path = tfwp, pg_temp`, and no migration will rely on the
default `search_path`.

No schema named `tfwp` and no `TFWP_` string exists anywhere in the repository.

### 1.3 Auth

- A: Supabase Auth via server API (`/api/v1/auth/login`), own `app_users` / `roles` model, HttpOnly SameSite=Strict cookies.
- B: Supabase Auth email OTP for staff; `public.staff.auth_user_id → auth.users`; role claims via `20261025021641_trusted_profile_role_claims.sql`.
- No auth hook (`custom_access_token` / auth hook) is defined in repo migrations. Live project hooks: **NOT VERIFIED**.

### 1.4 Storage

| System | Store | Bucket / prefixes |
|---|---|---|
| A | Cloudflare R2 | bucket from `R2_BUCKET` (example value `alhijrah-caseflow-documents`); prefixes `cases/…`, `branding/…` |
| B | Supabase Storage | private bucket `documents` (prefixes incl. `smart-import/…`) |
| C | MinIO | `murailex-evidence` |

### 1.5 Environment variables in use (names only)

- A: `AI_PROVIDER`, `AI_PROVIDER_API_KEY`, `AI_PROVIDER_MODEL`, `AI_PROVIDER_URL`, `APP_BASE_URL`, `CORS_ORIGINS`, `INTERNAL_API_KEY`, `LOGIN_THROTTLE_SECRET`, `OWNER_EMAIL`, `PORT`, `R2_ACCESS_KEY_ID`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_SECRET_ACCESS_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRICT_READY`, `SOURCE_VERSION`, `RAILWAY_*`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- B: `DATABASE_URL`, `DATABASE_POOL_MAX`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_*`, `CRON_SECRET`, `GATE_JOB_CREDENTIALS_KEY_V1`, `GOOGLE_GEMINI_API_KEY`, `OPENAI_*`, `RESEND_*`, `TWILIO_*`, `WHATSAPP_*`, `CAREER_GATE_*`, model-id variables, perf/test variables.
- C: its own `.env` (`DATABASE_URL`, `S3_*`, provider keys, …).
- No variable starts with `TFWP_`. No Anthropic variable exists.

### 1.6 Routes

- A (Railway): `/health`, `/ready`, `/brand/logo`, `/api/v1/*` (auth, cases, clients, documents, portal, imports, forms, billing, reports, …) and the SPA at `/`.
- B (Vercel): pages `/apply`, `/intake/[token]`, `/status`, `/status/[ref]`, `/staff/*`; APIs `/api/intake`, `/api/status/*`, `/api/staff/*`, `/api/documents/*`, `/api/cron/maintenance`, `/api/webhooks/{meta,resend,twilio}`, …
- TFWP Desk will expose `/portal`, `/desk`, `/api/*`, `/health`, `/ready` **only on its own hostname**. Nothing is mounted into A or B.

### 1.7 CI workflows (`.github/workflows/`)

| Workflow | Trigger | Affected by `services/tfwp-desk/**`? |
|---|---|---|
| `p0-p1-verification.yml` | push/PR, path filter on `src/`, `api/`, `supabase/`, `test/`, `e2e/`, `scripts/`, root manifests | No (path not listed) |
| `career-gate.yml`, `career-gate-staff-upgrade.yml` | push/PR, `career-gate/**` | No |
| `database-backup.yml` | schedule / manual | No |
| `vercel-live-check.yml` | **every push to `main`**, no path filter | Runs, but only curls the live Career Gate site; outcome unaffected by new files |

### 1.8 Baseline test run (before any TFWP work)

| Suite | Command | Result |
|---|---|---|
| A unit + API | `npm test` (root) | **248 / 248 pass** |
| B unit | `npx vitest run` (`career-gate/`) | **670 / 670 pass** |
| A SQL suites (`test/sql/*.sql`), A Playwright, B typecheck/lint/integration/Playwright, C | — | **Not run in Phase 0** (need Postgres 17 with Supabase roles, browsers, or Python stack). They will be run before and after Phase 1 |

Root tests read only fixed paths; none scan the whole repository, so new files under `services/` are not picked up.

---

## 2. Decisions proposed for approval

### D1 — Supabase project: **separate project (spec default). Recommended.**

Reasons from the repo:
1. B keeps a FK from `public.staff` to `auth.users`; any TFWP client or staff account created in that project would appear in the same `auth.users` and could be matched by B's logic.
2. Live auth hooks, SMTP settings, sign-up settings and MFA settings of the existing projects are **NOT VERIFIED**; TFWP requires sign-ups disabled and TOTP MFA enabled, which are project-wide switches.
3. TFWP needs `pgcrypto` and an RLS role model that is independent of A's `app_users` and B's `staff`.

Settings for the new project (owner action in the Supabase dashboard):
- Name e.g. `alhijrah-tfwp-desk`; region close to the Railway region.
- Auth: **disable public sign-ups**; enable Email OTP; enable **TOTP MFA**; set Site URL / redirect URLs to the TFWP hostname only.
- Client accounts are created server-side (admin API) at intake submit, then signed in by email OTP; staff accounts are created only by a manager through `/api/staff` (invite).
- Extension `pgcrypto` enabled in the `extensions` schema (Supabase default). The TFWP migrations will not create extensions; they will fail fast if `pgcrypto` is missing.
- Production email: Supabase's built-in mailer is rate-limited and not intended for production. A custom SMTP provider is an external service → **needs owner approval (see D7)**. Until then, development and tests use test mode only (no real emails).

Fallback (only with written owner approval): same project as A or B, with the `tfwp` schema; this plan would then add an auth-collision review and is **not** recommended.

### D2 — Storage: **new private R2 bucket `tfwp-docs`. Recommended.**

- New bucket, no public access, no custom public domain, no `r2.dev` URL.
- New **bucket-scoped** R2 API token (Object Read & Write on `tfwp-docs` only), so TFWP credentials cannot reach A's bucket.
- Bucket CORS: `PUT`/`GET` from the TFWP origin only (needed for browser uploads via signed URLs).
- Key layout: `cases/<case_uuid>/<document_uuid>.<ext>`; no names or PII in keys.
- Upload flow: server issues a 5-minute signed PUT with signed `Content-Type` and `Content-Length` (≤ 10 MB); after upload the server `HEAD`s and streams the object to compute SHA-256 and confirm type, then writes `tfwp.documents`; every signed URL is written to `tfwp.document_access_log`.

### D3 — Database objects

- Everything in schema `tfwp`; migrations only in `services/tfwp-desk/supabase/migrations/`.
- No `ALTER`/`DROP`/`GRANT`/`REVOKE` outside `tfwp`; no triggers or policies on `auth.*` or on any non-`tfwp` table.
- `tfwp.profiles.user_id` references `auth.users(id)` (a FK from a `tfwp` table, which creates no object in `auth`).
- `anon` gets no privileges on `tfwp`. `authenticated` gets only what the RLS policies need. The schema is **not** added to the Data API exposed schemas; the browser never talks to Postgres.

### D4 — How the server applies RLS

Server-side requests run as the caller, not as `service_role`: one transaction per request on a direct Postgres
connection, `set local role authenticated` plus `set_config('request.jwt.claims', <verified JWT claims>, true)`,
so `auth.uid()` and every RLS policy apply (same pattern Career Gate uses). `service_role` is used only for:
admin user creation, NOC/LMIA reference imports, and the retention/delete-on-request job. This adds the npm
driver `postgres` (a library, not a service).

### D5 — Deployment

- New **Railway service** `tfwp-desk` (new Railway project recommended, or a new service in the existing project — owner choice), Root Directory `services/tfwp-desk`, its own Dockerfile and `railway.toml` inside that directory, **Watch Paths `services/tfwp-desk/**`**, health check `/ready`.
- Environments: `staging` first, then `production` after owner approval (Phase 6).
- Hostname: a new subdomain, e.g. `tfwp.<owner-domain>` — adding a DNS record is an owner action (spec §12 forbids me from touching DNS).

### D6 — Environment variables (all new, all `TFWP_`)

`TFWP_NODE_ENV`, `TFWP_PORT` (Railway's injected `PORT` will be read as fallback only), `TFWP_BASE_URL`,
`TFWP_SUPABASE_URL`, `TFWP_SUPABASE_ANON_KEY`, `TFWP_SUPABASE_SERVICE_ROLE_KEY`, `TFWP_SUPABASE_JWT_SECRET`
(or JWKS URL), `TFWP_DATABASE_URL`, `TFWP_R2_ACCOUNT_ID`, `TFWP_R2_ACCESS_KEY_ID`, `TFWP_R2_SECRET_ACCESS_KEY`,
`TFWP_R2_BUCKET` (=`tfwp-docs`), `TFWP_PII_KEY`, `TFWP_CSRF_SECRET`, `TFWP_ANTHROPIC_API_KEY`,
`TFWP_ANTHROPIC_MODEL`, `TFWP_RETENTION_DAYS`, `TFWP_CONSENT_VERSION`.
No existing variable is read or reused. Values are never committed; `.env.example` inside the service lists names only.

### D7 — External services

Only Supabase (new project), Cloudflare R2 (new bucket) and the Anthropic API. A production SMTP provider for
OTP emails is **not** included and needs a separate approval. WhatsApp OTP stays out of scope.

---

## 3. Spec issues that need an owner answer

| # | Spec location | Issue | Proposed resolution |
|---|---|---|---|
| Q1 | §1.7 | Spec says branch `feature/tfwp-desk`; this session is bound to branch `ccr-8100bfff-rkujuk` and may not push elsewhere without permission. | Keep working on `ccr-8100bfff-rkujuk`, or authorise creating/pushing `feature/tfwp-desk`. |
| Q2 | §4 role enum, §6 RLS | Prototype has a **follow-up** department owning `approved`, `job_search`, `offer`, `lmia`; the role enum has no `followup` role and §6 gives those statuses to nobody but `manager`. | Add role `followup` with access to cases in `approved`, `job_search`, `offer`, `lmia` and their `postings`. |
| Q3 | §6.9 | "audit_log rows written by triggers on every table" would write one row per row on NOC/LMIA imports (tens of thousands). | Row-level audit on all case/client tables; statement-level summary row for `noc_units` and `employers` imports. |
| Q4 | §4 `passport_number_enc` | pgcrypto with a key sent from the app puts the key in SQL statements, which can appear in Postgres logs. | Keep pgcrypto as specified, passing the key only as a bound parameter and never logging statements; or switch to app-side AES-256-GCM (same column). Owner choice; default = spec (pgcrypto). |
| Q5 | §3 `matchNOC`, §4 `employers` | NOC 2021 V1.0 CSVs (Statistics Canada) and the ESDC Positive LMIA Employers List must be obtained. §10 forbids automating ESDC. | Owner (or staff) downloads the files manually; a committed import script loads a local file and records its SHA-256 and source URL. |
| Q6 | §5 | With sign-ups disabled, `signInWithOtp` cannot create users. | Server creates the client auth user at intake submit (service role), then sends the OTP. |
| Q7 | §10 retention | Delete-on-request / retention job needs a scheduler. | A Railway cron service inside the same new Railway project, running a script from `services/tfwp-desk`. |
| Q8 | §9 | Prototype loads IBM Plex Sans Arabic from Google Fonts and jsPDF/pdf.js/mammoth from CDNs. A strict CSP forbids third-party scripts. | Self-host the font files inside the service; drop client-side CDN libraries (PDF generation and text extraction move server-side per §2). |

---

## 4. Integration requests

Recorded in `services/tfwp-desk/docs/INTEGRATION_REQUESTS.md`. None requires changing a file outside
`services/tfwp-desk/` for Phases 1–5. Two items concern live platform settings that cannot be verified from the repo.

---

## 5. Owner approvals needed before Phase 1

1. D1 separate Supabase project (and its settings) — or written approval for the existing project.
2. D2 new R2 bucket `tfwp-docs` with a bucket-scoped token.
3. D5 Railway placement (new project vs. new service) and the subdomain.
4. Answers to Q1–Q8.
