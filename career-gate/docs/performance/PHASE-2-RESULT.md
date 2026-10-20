# Career Gate — Phase 2: Measured Result

Before: `main` at `61b5ef4`. After: this branch (the profile's `commit` field
reads `4418265`; it was taken on that commit plus the Client 360 tab and
Reports changes committed directly after it).

Same container, same database, same seed (`scripts/perf-seed.sql`: 2,000
clients), same Chromium, both builds served by `next start` against the same
PostgreSQL. Migration `045` was applied to that database for both runs, so the
dashboard comparison is conservative: `main` also benefited from the index.

Raw data: `phase2/browser-cpu4x-main-61b5ef4.json`, `phase2/browser-cpu4x-branch.json`.

What this does not measure: production itself. This container cannot reach
`*.vercel.app`; every figure here is a local production build.

## Server (warm, n=15, full response body)

| Route | p50 before | p50 after | Payload before | Payload after |
|---|---|---|---|---|
| `/staff/accounting` | 408 ms | 142 ms | 2,643 KB | 101 KB |
| `/staff/pipeline` | 161 ms | 124 ms | 1,765 KB | 794 KB |
| `/staff/tasks` | 129 ms | 79 ms | 569 KB | 123 KB |
| `/staff` (dashboard) | 400 ms | 274 ms | 85 KB | 86 KB |
| `/staff/reports` | 197 ms | 169 ms | 46 KB | 90 KB |

Reports now computes period KPIs, a funnel, a 12-week trend, staff performance
and stalled files, which is why its payload grew; its two read groups run as
parallel RLS-scoped transactions.

## Browser, 4× CPU throttle (median of 3)

TBT = total blocking time; maxLT = longest single main-thread task.

| Route · viewport | TBT before → after | maxLT before → after |
|---|---|---|
| accounting · desktop | 3,361 → 370 ms | 2,967 → 208 ms |
| accounting · tablet | 3,268 → 296 ms | 2,932 → 173 ms |
| accounting · mobile | 3,237 → 346 ms | 2,901 → 254 ms |
| pipeline · desktop | 2,664 → 711 ms | 2,144 → 405 ms |
| pipeline · tablet | 2,574 → 629 ms | 2,113 → 452 ms |
| pipeline · mobile | 2,650 → 669 ms | 2,099 → 443 ms |

Other routes moved within run-to-run noise at n=3 (±100 ms TBT) and are not
claimed as improved or regressed.

## Interaction to Next Paint (worst measured interaction per route)

| Route · viewport | Before | After |
|---|---|---|
| client workspace · desktop (tab switch) | 480 ms | 200 ms |
| client workspace · tablet (tab switch) | 544 ms | 168 ms |
| client workspace · mobile (tab switch) | 608 ms | 176 ms |
| pipeline · desktop (nav) | 344 ms | 176 ms |
| accounting · desktop (nav) | 264 ms | 192 ms |

Every measured interaction is now at or under 200 ms.

## CLS

0.00 on desktop and tablet for every route. On mobile, pipeline and accounting
read 0.02 (from 0.00), equal to the 0.02 the other mobile routes already
measured on `main`. Below the 0.1 threshold; recorded rather than hidden.

## Targets from Phase 1

| Target | Result |
|---|---|
| `/staff` p50 < 500 ms | Met (274 ms) |
| accounting, pipeline, appointments < 300 KB | accounting 101 KB, appointments 151 KB met; **pipeline 794 KB not met** — the board and location dispatcher still receive every active client so their counts stay exact; cards now mount in batches, which is what removed the main-thread block |
| maxLT at 4× < 500 ms on every route | Met (largest: pipeline tablet 452 ms) |
| INP < 200 ms on the failing pairs | Met on all but one: desktop Client 360 tab switch measured exactly 200 ms (from 480 ms) |
| CLS ≤ 0.01 | Met on desktop/tablet; mobile 0.02 as above |
