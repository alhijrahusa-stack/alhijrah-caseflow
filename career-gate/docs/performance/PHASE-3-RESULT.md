# Career Gate — Package A: Measured Result

Before: `main` at `c6aa84f`. After: branch `claude/career-gate-enterprise-upgrade-0uvs0j`.
Same container, same freshly seeded database (`scripts/perf-seed.sql`, 2,000 clients), same Chromium,
both builds served by `next start`. Raw data: `phase3/`.

Not measured: production. This container cannot reach `*.vercel.app`.

## Server (warm, n=15, full response body)

| Route | p50 before | p50 after | Payload before | Payload after |
|---|---|---|---|---|
| `/staff/pipeline` | 128 ms | 140 ms | 794 KB | 207 KB |
| `/api/staff/pipeline?view=locations` (new, on demand) | — | 89 ms | — | 15 KB |
| `/api/staff/pipeline?stage=…&offset=20` (new, on demand) | — | 18 ms | — | 13 KB |
| `/staff/accounting` | 141 ms | 140 ms | 101 KB | 101 KB |
| `/staff/appointments` | 35 ms | 29 ms | 151 KB | 151 KB |
| `/staff` | 280 ms | 280 ms | 86 KB | 86 KB |

Pipeline server time is within noise of `main`; the 12 ms difference is the second, preference-joined
read that keeps the location totals exact.

## CLS (layout-shift attribution, 390×844, 4× CPU)

Root cause on `main`: the header telemetry chip widens when its live status and the web font arrive
(217 → 247 px) and pushes the Alerts link onto a new row (y 243 → 307).

| Route (mobile) | Before | After |
|---|---|---|
| accounting | 0.0176 | 0.0000 |
| pipeline | 0.0176 | 0.0000 |
| clients | 0.0175 | 0.0000 |
| `/staff` | 0.0184 | 0.0003 |

The profiler (n=5) agrees: mobile CLS 0.02 → 0 on all seven routes.

## Main thread (4× CPU, median of 5)

| Route · viewport | TBT before → after | Longest task before → after |
|---|---|---|
| pipeline · desktop | 702 → 588 ms | 396 → 342 ms |
| pipeline · tablet | 585 → 485 ms | 335 → 298 ms |
| pipeline · mobile | 681 → 473 ms | 454 → 324 ms |

Every route's longest task is below 500 ms (largest: client workspace mobile, 354 ms).

## Client 360 tab-switch INP — repeated sampling

The profiler records one interaction per route, so its INP column is a single sample. This was
re-measured with 20 tab switches per tab (desktop, 4× CPU):

| Tab | `main` p50 / p75 / max | Branch p50 / p75 / max |
|---|---|---|
| documents | 136 / 168 / 264 | 80 / 80 / 96 |
| appointments | 104 / 120 / 184 | 104 / 112 / 168 |
| work | 56 / 56 / 72 | 56 / 64 / 72 |
| activity | 152 / 192 / 280 | 136 / 168 / 272 |
| profile | 176 / 232 / 432 | 168 / 184 / 232 |

p75 is below 200 ms on every tab; single worst samples on activity and profile still exceed 200 ms.

**Mobile INP is not reported as a result.** In this container, re-clicking an already-selected tab — a
click whose main-thread work totals ~115 ms in a Chrome trace — reports 700+ ms, because headless
Chromium does not present a frame promptly when nothing visible changes. Mobile readings here measure
that artifact as much as the application. One mobile result is still attributable: the Activity tab's
progressive list cut its p50 from 456 to 240 ms. Mobile INP needs measurement on a real device.

## Correction to the Phase 2 record

`PHASE-2-RESULT.md` reported Client 360 tab-switch INP of 168–200 ms. Those were single samples per tab
and do not hold under repeated sampling (above). That record has been annotated.

## Targets

| Target | Result |
|---|---|
| Accounting, Pipeline, Appointments payload < 300 KB | PASS (101 / 207 / 151 KB) |
| Longest task at 4× < 500 ms | PASS (largest 354 ms) |
| INP < 200 ms | PASS at p75 on desktop; FAIL for single worst samples (activity 272, profile 232); mobile BLOCKED — needs a real device |
| CLS ≤ 0.01 | PASS (0.0000–0.0003) |
| `/staff` p50 < 500 ms | PASS (280 ms) |
