# Career Gate — Execution Order

Base: `main` @ `61b5ef4` (PR #124). State verified from the repository on 2026-10-19.
Scope: `career-gate/**` and its two CI workflows only. Root app (`src/`), `murailex/`, `api/` are out of scope.

This document replaces the "Supreme Engineering Execution Protocol" as the working order. The protocol's
intent is kept; its repetition and its technology wish-list are replaced by verified gaps, each with one
package, one acceptance test and one piece of evidence.

## Status — 2026-10-20

| Gap | State | Evidence |
|---|---|---|
| G1 accounting, G2 pipeline, G4 realtime churn | Closed | `docs/performance/PHASE-2-RESULT.md` |
| G3 appointments dual render | Open, low value: appointments is paged at 25 since PR #120 (151 KB) | — |
| G5 refresh sites | Closed: location/shift save and bulk assignment publish targeted mutations; bulk assignment is optimistic with rollback | `ClientLocationShiftCard.tsx`, `ClientCommandTable.tsx` |
| G6 Client 360 freeze | Tab-switch INP 480–608 → 168–200 ms via transition; component split still open | PHASE-2 result |
| G7–G9 duplicate integrity | Closed, except the `staff_manual` phone-only guard, which awaits the owner's decision | `lib/http.ts`, `DuplicateNotice.tsx`, `identity_review_shared_email` rule |
| G10 tamper-evident audit, G11 tracing | Open | — |
| G12 dead code | Closed | removed files |
| G13 tokens | Rose-gold accent layer added on existing glass surfaces; full token consolidation open | `executive-refinement.css` |
| G14 re-measurement | Closed | PHASE-2 result |
| G15 human gates | Open | `docs/go-live/OPERATIONAL_CLOSURE_STATE.md` |

---

## 1. Rules (apply to every package)

1. **Delta only.** Start from the verified state below. Do not rebuild anything listed as closed.
2. **One package = one branch = one PR.** Branch from current `main`. No stacking on merged branches.
3. **Invariant:** ONE CLIENT → ONE ACCOUNT → ONE WORKFLOW → ONE NEXT ACTION. A change that adds a parallel path to any of these is rejected.
4. **Measured claims only.** No speed/accuracy claim without before/after numbers from `scripts/measure.mjs` or `scripts/profile-browser.mjs`, same seed, same viewport, same CPU rate as `docs/performance/baseline/`.
5. **RLS is never weakened.** Do not retry with `service_role` to make a query pass. F7 in the baseline (predicate short-circuit, 4.5× slower) is not to be retried.
6. **Migrations are additive, numbered after `044`, idempotent, and never edited after merge.**
7. **Protected surfaces:** public status portal (`StatusLookup`, `StatusPoller`, `ClientAppointmentActions`), `SignOutButton`, auth/middleware, `vercel.json`, env vars. Touch only if the package names them.
8. **PR #76 (client intake complete flow) and PR #77 (realtime targeted updates) are merged.** Do not reopen, re-implement or cite them as pending.
9. **Done = merged + Vercel production check green on the merge SHA + live route check.** "Deployment ready" is not done.

### Gate format (fill in the PR description for every package)

```
BASE_SHA:        <main sha at branch time>
SCOPE:           <files/dirs>
BASELINE:        <measured numbers or failing test>
CHANGE:          <one paragraph>
ACCEPTANCE:      <pass conditions, copied from this document>
PROTECTED:       <what must not change>
TESTS:           typecheck · lint · unit · integration · e2e (named specs) · perf (if claimed)
EVIDENCE:        <numbers, test names, screenshots>
DEPLOYED_SHA:    <filled after merge>
LIVE_CHECK:      <route + HTTP status + marker>
```

### Commands (run from `career-gate/`)

```sh
npm ci
npm run typecheck && npm run lint && npm test          # fast gate, every commit
./tests/run-integration.sh                             # PG16 + pgvector + all migrations
./e2e/run.sh e2e/<spec>.spec.ts                        # targeted e2e during work
./e2e/run.sh && CATALOG=real ./e2e/run.sh              # full gate before PR
psql "$DATABASE_URL" -f scripts/perf-seed.sql          # perf population (synthetic-only guard)
node scripts/measure.mjs                               # server p50/p95
CPU_THROTTLE=4 node scripts/profile-browser.mjs        # TBT, maxLT, LCP, CLS, INP
```

---

## 2. Verified state — closed, do not redo

| Item | Evidence |
|---|---|
| Perf instrumentation + baseline (F1–F8) | `docs/performance/PHASE-1-BASELINE.md`, PR #117 |
| F1 dashboard readiness single-pass aggregate; F8 health queries | PR #119 |
| F2 appointments server pagination; deferred notifications | PR #120 |
| F4 Client 360 tab switch local, no server round trip | PR #121 |
| Realtime entity-scoped targeted updates; `router.refresh()` demoted to recovery | PR #77 |
| Client intake one-time links + complete flow | PR #76, migration `036` |
| Duplicate rules: exact case ref blocks; shared email alone ≠ duplicate; corroborated identity (2 of name/DOB/phone) blocks; advisory lock per email | migrations `042`–`044`, `lib/public-intake-duplicate.ts`, `lib/applicant-identity.ts` |
| Duplicate notice + WhatsApp button on Client Intake Link form | `components/public/ClientIntakeForm.tsx:784`, number from `lib/office.ts` |
| Idempotency keys on intake/application | `lib/idempotency.ts`, `app/api/application/route.ts` |
| Transactional outbox (confirmation emails) | migrations `016`, `017` |
| Durable jobs (SKIP LOCKED, backoff, dead state) | `lib/jobs.ts` |
| Semantic search (pgvector HNSW, RLS on results) | `lib/semantic.ts` |
| Document intelligence: fast model → Zod → reconcile → escalation → human review; MRZ; bounded OCR | `lib/doc-intel.ts`, `lib/mrz.ts`, PR #100 |
| Append-only `activity_log` and `notes` (trigger) | migration `001` |
| SECURITY DEFINER privilege floor | migrations `018`, `022`, `026`, `029`, `037` |
| Granular staff permissions (B3) | migration `027`, `lib/b3-rbac.test.ts`, `lib/staff-permissions.ts` |

---

## 3. Verified gaps — the work

Every gap below was confirmed in code on `61b5ef4`. File and line references are the evidence.

| # | Gap | Evidence |
|---|---|---|
| G1 | Accounting renders every client account with embedded transactions (2,639 KB, 3,845 ms task at 4× CPU) | `app/staff/(app)/accounting/page.tsx:15` calls `accountingData()` with no page/limit |
| G2 | Pipeline loads up to 1,000 clients and filters in the browser (1,758 KB) | `lib/operational-pipeline.ts:23` `limit 1000` |
| G3 | Appointments still emits mobile cards **and** desktop table for the same rows | `app/staff/(app)/appointments/page.tsx:39` |
| G4 | Realtime subscription re-established on every server re-render | `components/staff/realtime/useTargetedUpdate.ts:75` — `seed` in effect deps |
| G5 | Two client-resource mutations still full-refresh the route | `ClientLocationShiftCard.tsx:26`, `ClientCommandTable.tsx:35` |
| G6 | Client workspace is one 329-line client component, 337 KB JS, 1,059–1,155 ms TBT at 4× | `components/staff/ClientFile.tsx` |
| G7 | Staff-side duplicate error tells the user it matched on **phone** | `lib/http.ts:36` |
| G8 | `/apply` wizard has no duplicate notice / WhatsApp action; it shows the generic error | `components/intake/IntakeWizard.tsx` (no `duplicate` handling) |
| G9 | Shared email with unresolved identity is allowed with a client-side warning only; staff are never asked to verify | `shared_email_warning` is returned to the browser only (`app/api/public/client-intake/[token]/route.ts:120`); no `audit_alerts` row |
| G10 | Audit trail is append-only but not tamper-evident (no hash chain) | `activity_log` has trigger only (`001_initial_schema.sql:346`) |
| G11 | Trace IDs are random UUIDs; incoming W3C `traceparent` is ignored; no span export | `lib/obs.ts` `traceIdFrom()` |
| G12 | Dead UI code: `StaffDashboard.tsx` (405 lines) has no importer; 5 staff stylesheets are imported nowhere | `grep` — `executive-tactile-v2`, `executive-upgrade`, `interaction-layer-fix`, `operational-core-ui`, `recent-clients-titanium` |
| G13 | Live Staff UI carries 5 layered stylesheets with overlapping tokens; no single rose-gold/glass token source | `app/staff/(app)/layout.tsx:15-19` |
| G14 | Phase-6 acceptance re-measurement against the Phase-1 baseline has not been run | no `docs/performance/PHASE-6-*.md` |
| G15 | Go-live human gates open | `docs/go-live/OPERATIONAL_CLOSURE_STATE.md` |

---

## 4. Packages — in execution order

Order is by measured value per unit of risk. P1–P4 are independent and may run in parallel branches;
P5 depends on P1; P6 depends on P1–P5 being merged.

### P1 — Staff performance (G1, G2, G3, G4)

- **Scope:** `lib/operations.ts` (`accountingData`), `lib/operational-pipeline.ts`, `app/staff/(app)/{accounting,pipeline,appointments}/page.tsx`, `components/staff/{AccountingBoard,PipelineBoard,MobileAppointmentCards}.tsx`, `components/staff/realtime/useTargetedUpdate.ts`.
- **Change:**
  1. Accounting and pipeline: move filters to `searchParams`, filter + paginate in SQL (`PAGE_SIZE = 25`, keyset on `updated_at, id`), return totals in the same query. Follow the `/staff/clients` and PR #120 pattern. Transactions load per account on expand via the existing `client-resource` endpoint, not embedded.
  2. Appointments: one responsive structure (cards that become rows at `lg`), rendered once.
  3. `useTargetedUpdate`: key the subscription on `clientId` + resource set only; hold `seed` in a ref so a new server seed patches state without resubscribing.
- **Acceptance:**
  - accounting, pipeline, appointments payload < 300 KB each (baseline 2,639 / 1,758 / 1,840 KB).
  - maxLT at 4× CPU < 500 ms on those three routes (baseline 3,845 / 2,746 / 802 ms).
  - Every existing filter returns the same rows as before (integration test compares old vs new query output on `perf-seed`).
  - Realtime: one subscription per surface across 5 consecutive server re-renders (unit test on the hook).
  - CLS ≤ 0.01 on all routes.
- **Tests:** `accounting-ui.spec.ts`, `operations-os.spec.ts`, `staff-appointment-alerts.spec.ts`, `realtime-targeted-updates.spec.ts`, new integration test for paginated queries.

### P2 — Targeted mutations and workspace split (G5, G6)

- **Scope:** `ClientLocationShiftCard.tsx`, `ClientCommandTable.tsx`, `ClientFile.tsx` (+ new files under `components/staff/client-file/`).
- **Change:**
  1. Replace the two `router.refresh()` calls with `useTargetedMutation`, declaring the resources each mutation touches in `lib/realtime-resources.ts`. Leave Distribution, Assignments, TeamSettings, GateJobAccountCard and SignOut on recovery — PR #77 documented why.
  2. Split `ClientFile` into hero, tab bar, command deck, panels and tab bodies; memoise `statusEvents`, `orderedQuick`, `tabs`; lazy-load inactive tab bodies with `next/dynamic`.
- **Acceptance:** zero `router.refresh()` outside the documented recovery set (`grep` test in unit suite); workspace JS < 250 KB and TBT at 4× < 600 ms (baseline 337 KB / 1,059 ms); INP < 200 ms on tab switch (baseline 256 ms); no visible behaviour change in `staff.spec.ts`, `smart-ui.spec.ts`.

### P3 — Identity and case integrity (G7, G8, G9)

- **Scope:** `lib/http.ts`, `components/intake/IntakeWizard.tsx`, `components/public/intake-copy.ts`, `app/api/intake/route.ts`, `app/api/public/client-intake/[token]/route.ts`, `lib/audit.ts`, new migration `045_identity_review_alert.sql`.
- **Change:**
  1. `dbErrorResponse` duplicate message: "An existing file matches this applicant" — no mention of phone, no ref, no owner, no stage.
  2. `/apply`: on `duplicate_client` / `case_number_exists`, show the same glass notice and WhatsApp button already used on the Client Intake Link form. Extract that notice into one shared component; both forms use it. Number comes only from `OFFICE.whatsapp`.
  3. Shared email + unresolved identity: submission proceeds and creates its own client and case number (current behaviour, kept); in the same transaction insert one `audit_alerts` row, rule `identity_review_shared_email`, carrying both client ids and no PII in `evidence`. Staff resolve it in `/staff/audit-alerts` (existing flow). No new queue.
- **Acceptance (integration + e2e):**
  - same ref → 409, original case unchanged;
  - same email + same name + same DOB → blocked;
  - same email + different name and DOB → new client, new case number, one `identity_review_shared_email` alert;
  - 10 parallel submissions of one identity with distinct idempotency keys → exactly 1 client (existing advisory lock proven, not assumed);
  - same idempotency key replayed → same case number;
  - no response body on a blocked path contains another applicant's ref, name, email, stage or owner;
  - WhatsApp link resolves to `https://wa.me/13139194292` on both forms, mobile and desktop.
- **Owner decision required (do not change silently):** the `staff_manual` guard in `044` still blocks on email + phone alone. The protocol says phone is not an identity key. Changing it alters an established staff protection. Raise it in the PR; implement only on the owner's answer.

### P4 — Tamper-evident audit and tracing (G10, G11)

- **Scope:** migration `046_activity_log_hash_chain.sql`, `lib/obs.ts`, `middleware.ts` (header pass-through only), integration test.
- **Change:**
  1. Add nullable `prev_hash`, `row_hash` to `activity_log`; a `BEFORE INSERT` trigger computes `row_hash = sha256(prev_hash || canonical row)` under `pg_advisory_xact_lock` on a fixed key; add `cg_verify_activity_chain(from_id)` (SECURITY INVOKER, admin-only grant). Existing rows stay unhashed; the chain starts at migration time and is documented as such.
  2. `traceIdFrom()` accepts W3C `traceparent` and returns its trace-id; every log line carries `trace_id` and `span_id`. Exporting spans to a collector needs a destination the owner must provide — that part is a human gate, not dropped.
- **Acceptance:** chain verifies on 10,000 seeded inserts; an `UPDATE` bypassing the trigger (as superuser in test) is detected by the verifier; insert overhead measured and reported (p50 before/after on `activity_log` insert); a request with `traceparent` logs the same trace-id end to end.

### P5 — Executive Glass UI, Staff Dashboard (G12, G13)

- **Scope:** `app/staff/**/*.css`, `app/staff/(app)/layout.tsx`, `components/staff/OperationalDashboard.tsx`, `components/staff/CommandPalette.tsx`, `components/staff/NextActionCard.tsx`, `tailwind.config.ts`. Delete `StaffDashboard.tsx` and the 5 unreferenced stylesheets.
- **Change:**
  1. One token file (`app/staff/tokens.css`): surface levels 0–3, glass blur/opacity per level, rose-gold accent (border, focus ring, active state), type scale, spacing, motion durations with `prefers-reduced-motion`. The 5 live stylesheets consume tokens; overlapping rules removed.
  2. Dashboard PODs = the existing `OperationalDashboard` sections, each one bordered glass unit with its own loading state (`Suspense`) and an action that routes to the filtered list it summarises. No decorative tile without a destination.
  3. Command sheet = existing `CommandPalette` + `NextActionCard`: show the client's one next action first.
  4. Progress path: pipeline stage shown as one SVG path whose filled length equals the client's actual stage index. No animation without a state change behind it.
- **Acceptance:** axe-core: 0 serious/critical on `/staff`, `/staff/clients`, `/staff/client/[id]`; text contrast ≥ 4.5:1; every button in those routes has a handler or `href` (e2e crawl asserts it); CSS shipped for `/staff` smaller than before (bytes reported); CLS ≤ 0.01; screenshots at 390, 820, 1920 px attached to the PR; all existing e2e pass.

### P6 — Phase-6 re-measurement (G14)

- Re-run both scripts unchanged against the Phase-1 seed and viewports. Write `docs/performance/PHASE-6-RESULT.md` with baseline vs result per route. Any target missed is reported as missed, with the cause.
- **Targets (from Phase 1):** `/staff` p50 < 500 ms; three heavy routes < 300 KB; maxLT at 4× < 500 ms on every route; INP < 200 ms on all four failing pairs; CLS ≤ 0.01; no route regresses.

### P7 — Go-live closure (G15) — human actions

These cannot be done from the repository. Each needs the named person and is recorded in `OPERATIONAL_CLOSURE_STATE.md` only when directly verified.

| Gate | Who | Action |
|---|---|---|
| `main` protection | GitHub admin | Require PR, 1 approval, both Career Gate CI checks; block force-push and deletion |
| Migrations `040`–`046` applied in production | Supabase admin | Apply in order via the migration chain; record applied timestamps. `040` status is unverified since PR #77 |
| PITR ≥ 30 days | Supabase admin | Confirm in dashboard |
| Monitoring + alert destinations; OTel collector endpoint | Owner | Name source, owner, destination |
| Human UAT 8/8 | One authorised employee | Run the 8 steps in the closure doc on synthetic data |
| Stale open PRs (#3, #8, #13, #16, #20, #25, #28, #29, #34, #38, #43, #49, #52, #53, #56, #78, #81, #93, #101, #108) | Owner | Close as superseded or name the one to finish. B3 (#53) appears landed via `027`; confirm before closing |

---

## 5. Deploy and live proof (every package)

1. PR → both workflows green (`career-gate.yml`, `career-gate-staff-upgrade.yml`).
2. Merge to `main`. Vercel deploys from `main` (root `career-gate`).
3. `vercel-live-check.yml` must pass on the merge SHA (`/` and `/staff/login`, title markers, no env-error page).
4. Record `DEPLOYED_SHA` and the live route checks in the PR.
5. Authenticated staff checks on production are performed by an authorised employee; the sandbox network denies `*.vercel.app`, so the agent cannot sign in to production itself.
6. Rollback: Vercel "Promote previous deployment"; migrations are additive and need no down-migration for a code rollback.

---

## 6. Technology map — where each requested capability lives

Present means verified in code. Delta means a package above closes it.

| Capability | Status | Location / package |
|---|---|---|
| Document intelligence, multimodal, model routing + fallback, confidence, HITL | Present | `lib/doc-intel.ts`, `lib/providers/`, `lib/reconcile.ts` |
| Hybrid AI + deterministic validation, explainable rules | Present | Zod schemas, `lib/audit.ts` rules with `explanation`, `lib/next-action.ts` |
| Event-driven targeted UI updates | Present | PR #77 graph + bus |
| Transactional outbox, durable jobs, idempotency | Present | `016`/`017`, `lib/jobs.ts`, `lib/idempotency.ts` |
| CQRS read models | Present | `015_operations_data_view.sql`, `lib/accounting-ledger-read.ts` |
| Vector search | Present | `lib/semantic.ts` |
| RLS, tenant/assignment isolation, privilege floor | Present | migrations; `client-isolation` and `b3-rbac` tests |
| Streaming / Suspense | Partial | `loading.tsx` exists; per-POD Suspense in P5 |
| Server pagination everywhere heavy | Delta | P1 |
| Tamper-evident audit | Delta | P4 |
| W3C tracing / OpenTelemetry | Delta | P4 (code) + P7 (collector destination) |
| Feedback-driven extraction improvement | Not verified in code | Inspect `doc-intel` review corrections before claiming; add as a package only if absent |
| Controlled deploy + rollback | Present | Vercel from `main` + live-check workflow; protection is P7 |
