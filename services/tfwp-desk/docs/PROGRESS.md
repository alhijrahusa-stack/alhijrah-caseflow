# Progress

## Phase 0 — Isolation plan (2026-11-09)

Changed:
- Added `docs/BUILD_SPEC.md` (owner spec, verbatim) and `docs/prototype/alhijrah_tfwp_system.html` (owner prototype, verbatim).
- Added `docs/ISOLATION_PLAN.md` and `docs/INTEGRATION_REQUESTS.md`.
- No code. No file outside `services/tfwp-desk/` changed.

Tested (baseline, before any TFWP work):
- Root `npm test`: 248/248 pass.
- `career-gate` `npx vitest run`: 670/670 pass.

Pending:
- Owner approval of `ISOLATION_PLAN.md` §5 (Supabase project, R2 bucket, Railway/subdomain, Q1–Q8).
- SQL suites, Playwright suites, Career Gate typecheck/lint/integration: to be run before and after Phase 1.

Phase 0 status: **waiting for owner approval** (acceptance gate of §11).
