# Career Gate — Phase 1: Technical Audit and Performance Baseline

Branch `claude/career-gate-modernization-phase1`, taken from `main` at `6b99f54`.

This phase changes no application code. It adds the measurement the repository
was missing, establishes a baseline, and names verified root causes. Every
number below was produced by the scripts in this directory against a real
production build. Nothing is estimated; where something could not be measured
it says so.

---

## 1. Method and environment

| | |
|---|---|
| Build | `next build` (production), `next start`, Next.js 16.3.6 / React 19.3.0 |
| Database | PostgreSQL 16 + pgvector, all 45 migrations, RLS active |
| Population | `scripts/perf-seed.sql` — 2,000 clients, 56,569 child rows |
| Browser | Chromium (Playwright 1.56.1) |
| Session | staff JWT for the seeded admin, RLS enforced as in production |
| Viewports | desktop 1920×1080, tablet 820×1180, mobile 390×844 |
| CPU | 1× (host, unthrottled) and 4× throttled (mid-tier device model) |

The existing `scripts/measure.mjs` already covered server route and API
latency. It does not observe the main thread, so this phase adds
`scripts/profile-browser.mjs`, which collects Long Tasks, Total Blocking Time,
LCP/FCP/TTFB, CLS, **measured** INP from real interactions (Event Timing API,
not a proxy), and React commit counts taken from the DevTools global hook.

`scripts/perf-seed.sql` exists because `e2e/seed.sql` holds staff only — with
no caseload, no page reveals how it behaves in service. The seeder names every
row `TEST …`, addresses them at `example.invalid`, and **refuses to run against
a database holding any non-synthetic client** (verified: the guard fires).

### What this environment could not measure

- **Production itself.** This container's network policy denies `*.vercel.app`,
  so no figure here was taken from the deployed application. These are
  local-build numbers on container hardware.
- **Absolute device timings.** Container CPU is not a user's laptop. The 4×
  throttled column is the honest comparison basis, and the *ratios* between
  routes are the durable signal, not the absolute milliseconds.
- The synthetic readiness distribution concentrates in one bucket, so the
  readiness *bucket counts* below are not representative. The **timings** are,
  because the work scanned is the same either way.

---

## 2. Baseline — server

Warm, 20 samples per route, median. Full response body, not time-to-first-byte.

| Route | p50 | p95 | Payload |
|---|---|---|---|
| **`/staff` (dashboard)** | **1046 ms** | 1145 ms | 83 KB |
| **`/staff/accounting`** | **514 ms** | 552 ms | **2,639 KB** |
| `/staff/reports` | 243 ms | 341 ms | 43 KB |
| **`/staff/appointments`** | 231 ms | 270 ms | **1,840 KB** |
| **`/staff/pipeline`** | 182 ms | 243 ms | **1,758 KB** |
| `/api/staff/search?q=TEST` | 163 ms | 218 ms | 3 KB |
| `/staff/tasks` | 148 ms | 174 ms | 566 KB |
| `/staff/clients` | 147 ms | 228 ms | 85 KB |
| `/staff/client/[id]` | 77 ms | 106 ms | 96 KB |
| `/staff/client/[id]?tab=…` | 68–73 ms | 99 ms | 89–91 KB |
| `/api/staff/client-resource` (targeted) | 15 ms | 19 ms | 3 KB |
| today / week / follow-ups / archive / distribution | 14–17 ms | ≤24 ms | 27–31 KB |

A deliberately heavy client file (63 documents, 83 notes, 258 activity rows)
renders in 77–143 ms at 323 KB.

## 3. Baseline — browser

Median of 3 runs. TBT = Total Blocking Time; maxLT = longest single task.

### 1× CPU (host, unthrottled)

| Route | TBT | maxLT | LCP (desktop/tablet/mobile) | CLS | JS |
|---|---|---|---|---|---|
| **accounting** | **621–656 ms** | **671–706 ms** | 240 / 256 / 160 ms | 0 | 154 KB |
| **pipeline** | **406–542 ms** | **445–489 ms** | 232 / 196 / 148 ms | 0 | 152 KB |
| appointments | 102–127 ms | 136–146 ms | 212 / 180 / 132 ms | 0 | 155 KB |
| client workspace | 55–85 ms | 82–103 ms | 720 / 612 / 472 ms | 0 | **337 KB** |
| clients list | 0–50 ms | 0–86 ms | 236 / 228 / 136 ms | 0 | 152 KB |
| staff dashboard | 2–19 ms | 52–63 ms | 300 / **1348** / **1184** ms | 0 | 209 KB |
| reports | 0–49 ms | 0–74 ms | 284 / 200 / 136 ms | 0 | 144 KB |

### 4× CPU (mid-tier device model, heavy client)

| Route | TBT | maxLT | LCP (desktop) |
|---|---|---|---|
| **accounting** | **4357 ms** | **3845 ms** | 432 ms |
| **pipeline** | **3376 ms** | **2746 ms** | 380 ms |
| **appointments** | **1293 ms** | 802 ms | 516 ms |
| **client workspace** | **1059–1155 ms** | 425–599 ms | **1456 ms** |
| clients list | 423–459 ms | 235–254 ms | 420 ms |
| staff dashboard | 323–375 ms | 192–236 ms | 476 ms (tablet LCP **1724 ms**) |
| reports | 284–341 ms | 229–242 ms | 436 ms |

On accounting and pipeline at 4×, React reported **0 commits** inside the
observation window: hydration had not completed while the main thread was held.

### Measured INP

Worst interactions, by measured Event Timing duration.

| CPU | Route | Interaction | INP |
|---|---|---|---|
| 4× | accounting | nav → clients | **272 ms** |
| 4× | pipeline | nav → clients | **264 ms** |
| 4× | client workspace (tablet) | tab → documents | **256 ms** |
| 4× | clients list | nav → clients | **208 ms** |
| 1× | pipeline | nav → clients | **280 ms** |
| 1× | accounting | nav → clients | **208 ms** |
| 1× | client workspace | tab → any | 16–104 ms |

**CLS is already 0.00 on every route and viewport** (single exception: 0.01 on
tablet appointments). The directive's CLS < 0.1 target is met today and the work
below must not regress it. INP < 200 ms is **not** met on four route/interaction
pairs.

---

## 4. Verified root causes, ranked

### F1 — The dashboard scans `client_readiness` four times (~600 ms, confirmed)

`lib/operational-dashboard.ts` computes `ready_count`, `nearly_ready_count`,
`blocked_count` and `missing_requirements` as four independent subqueries, each
joining the `client_readiness` view — a view that aggregates `requirements`
grouped per client.

`EXPLAIN ANALYZE` of the complete dashboard query attributes **800 ms of its
1012 ms** to those four InitPlans (248 + 186 + 185 + 182 ms).

Measured, three repeats, identical output in both forms
(`0 / 0 / 1819 / 3638`):

| Form | Time |
|---|---|
| Four separate scans (today) | 771 / 794 / 905 ms |
| One scan, filtered aggregates | 199 / 277 / 229 ms |

**~600 ms recoverable from one query rewrite, with no schema change and no
change in output.** Highest value, lowest risk finding in this audit.

### F2 — Three routes render every row, unpaginated (up to 3.8 s of blocked main thread)

`accountingData()` returns one row per client account for all 2,000 clients,
each carrying an embedded `transactions` JSONB array; `AccountingBoard`,
`PipelineBoard` and the appointments table are `"use client"` components that
receive the entire dataset as props and filter it in the browser via `useMemo`.

The whole dataset is therefore serialised into the RSC payload, parsed, and
hydrated: 2,639 KB / 1,758 KB / 1,840 KB, producing the 3845 ms and 2746 ms
single tasks at 4× CPU.

`/staff/clients` already paginates at `PAGE_SIZE = 25` and costs 147 ms at
85 KB — the pattern to follow exists in the codebase.

Server-side filtering and pagination preserves every current capability: the
filters keep working, they stop requiring the full table in the browser first.

### F3 — Appointments renders every row twice

`app/staff/(app)/appointments/page.tsx` emits `MobileAppointmentCards` **and**
a desktop `<table>` for the same rows, the first hidden by CSS
(`hidden … lg:block`). Both are in the HTML on every viewport, so every client
pays for both, and `AppointmentNotificationPanel` is additionally mounted per
confirmed row. One responsive structure removes roughly half the payload and
DOM without changing what either layout shows.

### F4 — A client-workspace tab switch costs a full server render

`components/staff/ClientFile.tsx` keeps the active tab in the URL and switches
it with `router.replace()`. The page is `force-dynamic`, so each switch is a
round trip costing 68–73 ms and 89–91 KB — re-running all 18 client-file slices
plus four more queries — **for data already in the browser**. All tab bodies
render from the same in-memory `data` object.

A second consequence: `useTargetedPayloads` lists `seed` in its effect
dependencies, so every server re-render tears down and re-establishes the
realtime subscription. With tab switches triggering server renders, routine tab
use churns the subscription.

### F5 — `router.refresh()` survives at 14 unsanctioned call sites

The repository already has a targeted-update architecture
(`useTargetedMutation`, `useTargetedPayloads`, the coalescing entity-scoped
`update-bus`) — it is well built and should be preserved. Three modules call
`router.refresh()` **by design**, as the recovery fallback:
`realtime/useTargetedMutation.ts`, `RealtimeRefresher.tsx`, `forms/useAction.ts`.
Those are correct and stay.

Outside them, 14 call sites in 10 files still refresh the whole route. On a
`force-dynamic` page each one re-renders everything — on accounting, all
2.6 MB. The targeted endpoint that replaces them answers in 15 ms at 3 KB.

In scope for this work (staff surfaces):

- `gate-job-account/GateJobAccountCard.tsx` (3)
- `staff/TeamSettings.tsx` (2)
- `staff/AssignmentsPanel.tsx`, `staff/ClientCommandTable.tsx`,
  `staff/ClientLocationShiftCard.tsx`, `staff/DistributionPanel.tsx` (1 each)

Explicitly **out of scope**: `components/StatusLookup.tsx`,
`components/StatusPoller.tsx` and `components/ClientAppointmentActions.tsx`
belong to the public client status portal, which is a protected surface and is
not touched by this modernization. `staff/SignOutButton.tsx` refreshes across an
authentication transition, where a full refresh is the correct behaviour.

### F6 — The client workspace is one 328-line component shipping 337 KB

`ClientFile.tsx` holds the hero, tab bar, command deck, nine action panels and
all six tab bodies in a single `"use client"` component with one `useState`,
and recomputes `statusEvents` (filter → map → reverse), `orderedQuick` (sort)
and the `tabs` array unmemoised on every render — including every realtime
patch. It is the heaviest JS route in the application (337 KB vs 144–209 KB) and
carries 1059–1155 ms TBT at 4×.

### F7 — RLS predicate cost is real but is not the lever it appears to be

`pg_stat_statements` records `cg_can_access_client(cid)` at **57,332 calls per
dashboard load**, 563 ms of the query's time — it joins `clients` *and* `staff`
per row, where the `_row` variant hits `staff` only and measures 2× cheaper per
call.

**A candidate fix was tested and rejected.** Short-circuiting on
`cg_staff_role()` made the dashboard **4.5× worse** (1.04 s → 4.5 s): the flat
`exists` function is planner-inlinable, and wrapping it in `CASE` with nested
`SET search_path` functions defeats inlining, turning a planned join into a real
per-row function call. The original was restored verbatim and verified by
checksum and by timings returning to 1.04 s.

Recorded so it is not attempted again. Any future work here must reduce *how
many rows the predicate is applied to*, not try to make the predicate cheaper —
and must be measured before it is believed. RLS is not to be weakened.

A related correction: an early reading suggested the aggregate ran 22× slower
without RLS. That was a cold-plan artifact. On repeat the figures are 98–130 ms
with RLS and 58–97 ms without. **Not reported as a finding.**

### F8 — Minor, confirmed

- `systemHealth()` issues three sequential `await`s where `Promise.all` would
  serve; ~3 round trips per admin dashboard load.
- `withStaff()` adds two round trips (`set_config`, `set local role`) per
  transaction, and the client page opens five separate transactions.
- The client page calls `JSON.parse(JSON.stringify(…))` four times per render.
- `vitest.config.ts` includes `lib/**`, `components/**` and `tests/unit/**` —
  verified; no suite is dormant.

### Preserve as-is (audited, found sound)

The realtime `update-bus` (coalescing, entity-scoped, explicit recovery
signal); `ExecutiveTelemetry` (30 s interval, visibility-gated, AbortController
+ timeout); `ExecutiveTactileFX` (passive listener, opt-in audio); the
dashboard's single CTE aggregate in place of N+1; `/staff/clients` pagination;
the 85 existing indexes; CLS at 0.00.

---

## 5. Prioritised plan

Ordered by measured value per unit of risk.

| # | Work | Evidence | Expected | Risk |
|---|---|---|---|---|
| 1 | Single-pass readiness aggregation (F1) | 771→199 ms measured | ~600 ms off dashboard | Low — one query, output proven identical |
| 2 | Server-side pagination + filtering for accounting, pipeline, appointments (F2) | 2.6 MB / 3845 ms task | Removes the two worst main-thread blocks | Medium — must preserve every filter |
| 3 | Single responsive appointments structure (F3) | rows emitted twice | ~50% of that route's payload | Low |
| 4 | Client-side tab state in the workspace (F4) | 68–73 ms + 90 KB per switch | Tab switches become instant | Low — data already client-side |
| 5 | Split `ClientFile` by responsibility, memoise derived values (F6) | 337 KB, 1059 ms TBT | Cuts workspace TBT and JS | Medium — largest refactor; behaviour must not move |
| 6 | Retire the 9 in-scope staff `router.refresh()` sites onto the targeted path (F5) | 15 ms / 3 KB vs full route | Removes full re-renders after mutations | Medium — per-site correctness |
| 7 | Fix `useTargetedPayloads` dependency churn (F4) | resubscribe per server render | Stops subscription churn | Low |
| 8 | F8 items | 3 round trips, 5 transactions | Tens of ms | Low |

Phase 3 covers 1 and 8; Phase 2 covers 4, 5 and 3; Phase 3/4 covers 2, 6 and 7.

### Acceptance criteria for Phase 6

Re-run both scripts unchanged, same seed, same viewports, same CPU rates, and
compare against `docs/performance/baseline/`:

- INP < 200 ms on all four pairs currently over it (272 / 264 / 256 / 208 ms).
- CLS stays ≤ 0.01. **It is already 0.00; holding it is the requirement.**
- `/staff` server p50 under 500 ms (from 1046 ms).
- accounting, pipeline, appointments payloads under 300 KB (from 2,639 / 1,758 / 1,840 KB).
- maxLT at 4× under 500 ms on every route (from 3845 ms).
- No regression on any route currently under target.

## 6. Reproducing

```sh
e2e/run.sh                     # Postgres + migrations + build + next start
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/perf-seed.sql
node scripts/measure.mjs                            # server
CPU_THROTTLE=4 node scripts/profile-browser.mjs     # browser
```
