# Career Gate

ALHIJRAH SERVICES LLC — employment operations platform. Next.js 16 (App Router), TypeScript, Tailwind, Supabase (Postgres + Auth + private Storage + Realtime), pgvector, Vercel.

Office: Alhijrahusa@gmail.com · 313-339-3566 · WhatsApp 313-919-4292

Principle: **the software records facts; it does not create them.** Anything without credentials reports `NOT_CONFIGURED`. No message is marked sent without a provider id, no document is verified without a human reviewer, and no assessment answer is chosen by software.

## Areas

| Area | Routes |
| --- | --- |
| Public intake | `/apply`: Michigan → City → Site → Job → Primary → Backup → Pay → Personal → Amazon history → Employment → Availability → Documents → Review/Authorization/Signature |
| Public status | `/status`: reference, phone or email, then a 6-digit code, then a 30-minute HttpOnly session, then `/status/[ref]` |
| Staff | `/staff/login` (Supabase Auth email code), `/staff`, `/staff/clients`, `/staff/client/[id]`, `/staff/new-client`, `/staff/appointments`, `/staff/tasks`, `/staff/follow-ups`, `/staff/audit-alerts`, `/staff/reports`, `/staff/settings/team`, `/staff/settings/availability` |
| APIs | `POST /api/intake` (requires `Idempotency-Key`), `POST /api/status/lookup`, `POST /api/status/verify`, `GET /api/status/[ref]`, `POST /api/staff/action`, `GET /api/documents/[id]`, `GET/POST /api/audit/alerts[/id]`, `GET /api/cron/maintenance`, webhooks for Twilio, Meta and Resend |

## Security model

- **Staff auth:** Supabase Auth email OTP. Access and refresh tokens are held in HttpOnly cookies. Middleware verifies the JWT (HS256 secret or project JWKS) and refreshes it when it expires.
- **RBAC:** `admin`, `manager` and `staff` roles (see `lib/authz.ts`). Staff see and work only on clients assigned to them. Every denial returns 403 and writes a `security_events` row.
- **RLS:** staff reads and writes run in a transaction as the `authenticated` role, with the verified JWT subject, so the policies in `002_operations_platform.sql` apply to every statement. `anon` has no table access. Server-only tables (OTP, sessions, rate limits, idempotency, jobs) have no policies.
- **Storage:** private bucket `documents`, under generated paths. Each original is stored with its SHA-256. Access is by 10-minute signed URL, and every view is logged.
- **Status access:** lookup gives the same response and similar timing whether or not anything matches. Codes are stored as HMAC-SHA256 with `STATUS_OTP_PEPPER`, expire after 5 minutes, and lock after 3 wrong attempts for 15 minutes. Only the session token's hash is stored.
- **Rate limits (policy, persistent in Postgres):**
  - intake: 1 accepted per 5 minutes and 5 attempts per hour, per IP
  - status lookup: 5 per 15 minutes and 20 per hour, per IP
  - OTP: 5 sends per hour per contact
  - staff: 100 actions per minute and 1000 per hour
  - login: 5 failed per 15 minutes
  - uploads: 10 per hour per client
- **Headers:** CSP, `frame-ancestors 'none'`, nosniff, Referrer-Policy and Permissions-Policy. State-changing API calls must come from the same origin.

## Workflow rules

- Statuses are the 15 listed in `lib/domain.ts`. The **state machine** (`status_transitions`) is enforced by a database trigger and mirrored on the server. Admins may override with a mandatory reason, which is logged as `status_overridden`.
- **Scheduling** is deterministic, in America/Detroit: office availability minus appointments and blocked time gives the next 3 slots. The slot is rechecked inside the booking transaction, and a Postgres exclusion constraint prevents double booking per resource.
- **Audit rules** (`lib/audit.ts`) raise `audit_alerts`; they never change data. Ignoring an alert needs a reason.
- **Assessments** record only answers the client confirmed. Standard items start as `UNRESOLVED — NEEDS CLIENT CONFIRMATION`. Reference texts are stored separately and are never used as answers.

## Intelligence layer

| Component | Behaviour | Without credentials |
| --- | --- | --- |
| Document intelligence | Decode + quality → Gemini fast model → Zod → reconciliation → escalation model when needed → human review | `NOT_CONFIGURED`; document goes to `needs_review`; nothing is downloaded or sent |
| Intake agent | Deterministic missing/inconsistent items; the model may only reword the draft | Template draft; marked NOT_CONFIGURED |
| Semantic search | Redacted notes/tasks/contacts → `text-embedding-3-small` (1536) → pgvector HNSW; RLS on results | Search shows NOT_CONFIGURED; embedding jobs end `not_configured` |
| Notifications | Only for consented, configured channels; sent only with a provider id; delivery via signed webhooks | Recorded as `not_configured` |
| Realtime | Staff pages subscribe with the staff JWT (RLS applies); the public page uses session-gated polling | Header shows NOT_CONFIGURED |

Model IDs live only in env (`lib/providers/config.ts`). Admins can run a live availability check on the Team page.

Background work uses the `jobs` table: SKIP LOCKED claims, a 120-second visibility timeout, exponential backoff and a dead state after `max_attempts`. Jobs run right after the request (`after()`) and in the daily Vercel Cron. Supabase Queues/pgmq is not used.

## Catalog

`data/job-catalog.json` is the only source of site, job, shift, schedule, pay and availability text. It is currently **empty**. Until it is filled:

- the public form says no openings are listed and still accepts requests;
- preferences cannot be added.

Every preference stores a snapshot and the catalog content version.

## Deploy

1. Supabase:
   - apply `supabase/migrations/001_initial_schema.sql`, then `002_operations_platform.sql`;
   - confirm the `documents` bucket is private;
   - enable the email OTP provider under Auth.
2. Vercel:
   - set Root Directory to `career-gate`;
   - add the variables from `.env.example`;
   - deploy (the daily cron comes from `vercel.json`).
3. Sign in at `/staff/login` with `CAREER_GATE_ADMIN_EMAIL`. That account becomes admin. Add real staff emails on the Team page.

## Checks

```bash
npm run typecheck && npm run lint && npm test   # unit
./tests/run-integration.sh                      # PostgreSQL 16 + pgvector, both migrations, 36 invariant tests
./e2e/run.sh                                    # full build + Playwright (test catalog fixture)
CATALOG=real ./e2e/run.sh                       # same with the committed catalog
PERF=1 ./e2e/run.sh                             # adds p50/p95 latency measurement (scripts/measure.mjs)
```

Locally, staff sessions use Supabase-format JWTs signed with a test secret, so JWT verification, RBAC and RLS are exercised for real. Supabase Storage is replaced by `e2e/storage-double.mjs`. The Supabase login round trip, code delivery, AI providers and Realtime need the live services.
