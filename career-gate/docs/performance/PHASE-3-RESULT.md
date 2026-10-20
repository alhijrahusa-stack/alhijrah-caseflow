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

## Worst-sample fix: tab content renders after the feedback paint

**Cause.** The tab bar already marked the chosen tab urgently and rendered the section in a
transition, but the transition could finish and commit (DOM, style, layout) before the browser's next
frame. That paint then waited for the whole section, so a click's latency included its largest commit.
`useProgressiveList` did the same with its full-list commit, queued by `setTimeout(0)` right after the
first one.

**Change.** The section switch, and each step of the progressive list (120 items at a time), now starts
from a task queued in `requestAnimationFrame`, i.e. after the frame that shows the tab highlight.

Re-measured on the same seed, both builds served side by side, 20 switches per tab, desktop, 4× CPU
(raw: `phase3/inp-tabs-after-paint.json`):

| Tab | `main` p50 / p75 / max | Package A run 1 | Package A run 2 |
|---|---|---|---|
| documents | 128 / 160 / 1,432 | 64 / 72 / 120 | 72 / 80 / 104 |
| appointments | 120 / 144 / 224 | 56 / 64 / 96 | 56 / 72 / 80 |
| work | 56 / 56 / 72 | 56 / 56 / 72 | 56 / 64 / 72 |
| activity | 168 / 184 / 248 | 56 / 64 / 80 | 56 / 64 / 88 |
| profile | 176 / 216 / 304 | 56 / 56 / 72 | 56 / 64 / 72 |

Every desktop sample in both runs is under 200 ms (worst 120 ms). The section itself is not faster to
build: time from pointer-down to the section being present is p50 280–475 ms on the branch against
317–520 ms on `main`, with single slow samples up to 1,200 ms (profile, run 2). That is content
readiness, not interaction latency, and is reported so the INP figures are not read as "the tab loads
in 70 ms".

Headless mobile (10 per tab) reads p50 232–240 ms on every tab, including `work`, which is light on
desktop: the same headless presentation floor described above. Mobile stays unverified here.

**Real-device path.** Signed-in staff pages now send INP, CLS and LCP to `/api/staff/vitals`, which
writes one `web_vital` log line (metric, value, rating, route pattern, screen class phone/tablet/desktop;
no staff or client id, nothing stored). Mobile INP is verified by opening Client 360 on a phone,
switching tabs, and reading the `web_vital` lines with `name=INP` and `screen=phone` in the deployment
logs. That requires a deployment and a person with a phone.

## Correction to the Phase 2 record

`PHASE-2-RESULT.md` reported Client 360 tab-switch INP of 168–200 ms. Those were single samples per tab
and do not hold under repeated sampling (above). That record has been annotated.

## Targets

| Target | Result |
|---|---|
| Accounting, Pipeline, Appointments payload < 300 KB | PASS (101 / 207 / 151 KB) |
| Longest task at 4× < 500 ms | PASS (largest 354 ms) |
| INP < 200 ms | Desktop PASS on every sample (worst 120 ms, two runs of 20 per tab); mobile BLOCKED — needs a real device (field beacon added) |
| CLS ≤ 0.01 | PASS (0.0000–0.0003) |
| `/staff` p50 < 500 ms | PASS (280 ms) |
