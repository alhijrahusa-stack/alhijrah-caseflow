# FINAL_ACCEPTANCE — ALHIJRAH Canada Desk v2.2 (Gate 6)

- Repository commit: `Gate 6 audit-fix commit (the commit that contains this file; parent c812c1f)`; environment: local Miniflare (Workers/D1/R2/Durable Objects/KV) and Chromium via Playwright behind a local self-signed HTTPS server.
- **No deployment, no production migration, no production resource change.** Closing this plan is not a release authorization.
- Status totals: BLOCKED 8, NOT_RUN 2, PARTIAL 20, PASS_LOCAL 30. No criterion is marked PASS without staging/production evidence.
- Raw results: `delivery/gate6/RESULTS.txt` (commands, exit codes, outputs). Load: LOCAL Miniflare evidence only (not Cloudflare staging): 900 s, 100 sockets/20 rooms, 5 msg/s: commit p95 57 ms, fan-out p95 72 ms, rapid enqueue p95 142 ms (target ≤800), rapid result max 206 ms (target ≤5000), sender distribution client 1120 : staff 3360 (D1 1120:3360, ratio 1:3), HTTP read p95 108 ms, committed 4480/4480, lost 0, leaked 0. Restore: backup 675 ms (79 tables, 75 rows, 2 R2 objects), restore 2507 ms, RTO (restore→first authorized read) 3856 ms, drill RPO 761 ms (= age of the backup at failure), re-erasure 2, outbox→AMBIGUOUS 2, rollback PASS (previous build at 44fd112).

| AC | Status | Evidence | Note / remaining gap |
|---|---|---|---|
| AC-01 | PASS_LOCAL | tests/*-api.mjs + auth/intake/legal/portal-security scripts; tests/v22/portal.test.mjs | intake-api/portal drafts: partial/empty saves, 400/422 on syntax; actual D1 NOT_RUN |
| AC-02 | PARTIAL | tests/v22/access.test.mjs; tests/v22/security.test.mjs; tests/v22/portal.test.mjs | four roles, case scope, spoof/revoked/cross-case deny without existence leak PASS_LOCAL; JWT issuer/aud/alg/key rotation belong to the hosting identity provider (identity headers) — BLOCKED: not verifiable locally |
| AC-03 | PARTIAL | tests/v22/database.test.mjs | SQLite reference + Miniflare D1 negative probes PASS_LOCAL; actual Cloudflare D1 NOT_RUN |
| AC-04 | PASS_LOCAL | tests/v22/engines.test.mjs; tests/*.test.mjs (129) | malformed nested rules/dates/language never throw or fabricate |
| AC-05 | PASS_LOCAL | tests/v22/database.test.mjs; tests/*-api.mjs + auth/intake/legal/portal-security scripts | single head per key/subject, canonical writer lib/facts.ts, static no-dual-write |
| AC-06 | PASS_LOCAL | tests/v22/engines.test.mjs | one applicable payload per date; invalid date/url/hash/overlap rejected |
| AC-07 | PASS_LOCAL | tests/v22/engines.test.mjs | one MANAGER authors+seals in one action; direct SEALED insert and STAFF seal refused; CAS activation |
| AC-08 | PASS_LOCAL | tests/v22/engines.test.mjs | missing event date → CONTEXT_INCOMPLETE; historic replay uses exact release |
| AC-09 | PARTIAL | tests/v22/engines.test.mjs; tests/v22/registry-coexistence.test.mjs | Toronto approval-date routing PASS_LOCAL on TEST_ONLY fixtures; approved legal fixtures BLOCKED (legal pack not approved) |
| AC-10 | BLOCKED | — | official CRS tables and independently reviewed GM fixtures are not approved/SHA-pinned; only TEST_ONLY bundles exist, which cannot yield COMPLETE in production |
| AC-11 | PASS_LOCAL | tests/v22/engines.test.mjs | normalization trace incl. wage tier only from sealed dataset |
| AC-12 | PASS_LOCAL | tests/v22/engines.test.mjs; tests/*.test.mjs (129) | 600-profile differential, caps, MAX route, corruption → RULE_UNAVAILABLE |
| AC-13 | PASS_LOCAL | tests/v22/engines.test.mjs | ALL/ANY/UNKNOWN algebra; Gate 3 mutations caught |
| AC-14 | BLOCKED | — | program models need sourced legal requirements approval (FSW67/FST/CEC/AIP/RCIP/FCIP/PNP streams) |
| AC-15 | PARTIAL | tests/v22/engines.test.mjs | NOC adapter contract and forged code/quote rejection PASS_LOCAL; human review record BLOCKED |
| AC-16 | PARTIAL | tests/v22/engines.test.mjs; tests/v22/automation.test.mjs | no rubric ⇒ RANK_UNAVAILABLE PASS_LOCAL; numeric rank BLOCKED (I10: no approved ranking policy) |
| AC-17 | PARTIAL | tests/v22/engines.test.mjs | 100 concurrent identical requests converge, same key/other body 409 — PASS_LOCAL on Miniflare D1; actual D1 NOT_RUN |
| AC-18 | PARTIAL | tests/v22/engines.test.mjs; tests/v22/billing.test.mjs; tests/v22/automation.test.mjs | stale publication blocked; failed batches leave no pointer/audit/outbox half-write — PASS_LOCAL; actual D1+R2 NOT_RUN |
| AC-19 | PASS_LOCAL | tests/v22/automation.test.mjs; tests/v22/security.test.mjs | only an explicit client service request creates the event+task; idempotent |
| AC-20 | PARTIAL | tests/v22/automation.test.mjs; tests/v22/outbox-cas.test.mjs; tests/v22/restore.test.mjs | lease/fence (CAS proven with forced interleaving), AMBIGUOUS same-key resend, DLQ, restored rows not resent — PASS_LOCAL with a provider test double; real provider sandbox NOT_RUN |
| AC-21 | PARTIAL | tests/v22/automation.test.mjs; tests/v22/access.test.mjs | 0/30/90, catch-up, dedup, consent withdrawal PASS_LOCAL; leap-year/renewal-revision clock matrix NOT_RUN |
| AC-22 | PARTIAL | tests/v22/chat.test.mjs; tests/v22/security.test.mjs | opt-in consent, identifier masking, outages → human handoff PASS_LOCAL with an LLM test double; vendor approval/allowlist policy BLOCKED |
| AC-23 | PASS_LOCAL | tests/v22/automation.test.mjs | separate employers/vacancies, https source + checked date, encrypted private contacts, RANK_UNAVAILABLE |
| AC-24 | PARTIAL | tests/v22/billing.test.mjs; tests/v22/security.test.mjs; tests/v22/operations.e2e.spec.ts | AR/EN PDFs from the same server data, no private fields in JSON/HTML/PDF/logs PASS_LOCAL; schema-wide AR/EN projection review NOT_RUN |
| AC-25 | BLOCKED | build + tsc evidence only | no CI pipeline, staging Worker, real bindings or health evidence in this environment; local build/tsc pass |
| AC-26 | BLOCKED | tests/v22/restore.test.mjs | BLOCKED: access/erasure/hold/backup re-erasure implemented and tested locally; approved retention/lawful-use/vendor/key policy missing (PRIVACY_POLICY_APPROVED=false; immutable records reported RETAINED_PENDING_POLICY) |
| AC-27 | NOT_RUN | tests/v22/load.mjs | staging load NOT_RUN; local measurement only: LOCAL Miniflare evidence only (not Cloudflare staging): 900 s, 100 sockets/20 rooms, 5 msg/s: commit p95 57 ms, fan-out p95 72 ms, rapid enqueue p95 142 ms (target ≤800), rapid result max 206 ms (target ≤5000), sender distribution client 1120 : staff 3360 (D1 1120:3360, ratio 1:3), HTTP read p95 108 ms, committed 4480/4480, lost 0, leaked 0 |
| AC-28 | BLOCKED | tests/v22/restore.test.mjs | isolated restore with keys fingerprint, verification, re-erasure, no resend, capability disable, rollback to 44fd112 PASS_LOCAL: backup 675 ms (79 tables, 75 rows, 2 R2 objects), restore 2507 ms, RTO (restore→first authorized read) 3856 ms, drill RPO 761 ms (= age of the backup at failure), re-erasure 2, outbox→AMBIGUOUS 2, rollback PASS (previous build at 44fd112); BLOCKED: accepted RPO/RTO targets not specified by the owner and the drill ran on local Miniflare, not an isolated Cloudflare environment |
| AC-29 | PARTIAL | tests/v22/portal.test.mjs; tests/v22/portal.e2e.spec.ts; tests/v22/operations.e2e.spec.ts | integrated journey registration→OTP→draft→path→signature→submit→chat→handoff→rapid→invoice→payments→PDF→notice→lookup PASS_LOCAL; staging browser UAT NOT_RUN |
| AC-30 | BLOCKED | execution/FINAL_ACCEPTANCE.md | dossier prepared; owner release review and authorized release decision pending |
| AC-31 | PASS_LOCAL | tests/v22/chat.test.mjs; tests/v22/load.mjs | one message per sender/clientMessageId, contiguous sequences under concurrency, ACK after durable batch, changed hash 409 |
| AC-32 | PASS_LOCAL | tests/v22/chat.test.mjs; tests/v22/security.test.mjs | same session/role/case policy for socket/history/media; cookie only; Origin enforced; revocation on every inbound/fan-out; idle close by DO alarm ≤30 s; no staff identity to clients |
| AC-33 | PARTIAL | tests/v22/chat.test.mjs; tests/v22/load.mjs | replay after reconnect/network loss, HTTP fallback, dedup PASS_LOCAL; real DO eviction on Cloudflare NOT_RUN |
| AC-34 | PASS_LOCAL | tests/v22/chat.test.mjs | one claim winner; human state and new client input fence the assistant; late output discarded |
| AC-35 | BLOCKED | tests/v22/chat.test.mjs; tests/v22/automation.test.mjs | same evidence/scan/auth pipeline and no playback until CLEAN PASS_LOCAL (scanner test double); media duration adapter, real scanner and transcription provider missing (I07/I15) |
| AC-36 | PARTIAL | tests/v22/chat.test.mjs; tests/v22/security.test.mjs | consented provider, authorized read-only context, injection cannot change state/roles/facts PASS_LOCAL; human review of grounding BLOCKED |
| AC-37 | PASS_LOCAL | tests/v22/chat.test.mjs; tests/v22/engines.test.mjs; tests/v22/portal.test.mjs | same engine/history with RAPID_SCREENING; verified pointer untouched; no FINAL |
| AC-38 | PASS_LOCAL | tests/v22/chat.test.mjs; tests/v22/automation.test.mjs | monotonic bounded receipts, consented content-free notices, one per unread window, consent revocation cancels |
| AC-39 | NOT_RUN | tests/v22/load.mjs | Cloudflare staging NOT_RUN; local measurement: LOCAL Miniflare evidence only (not Cloudflare staging): 900 s, 100 sockets/20 rooms, 5 msg/s: commit p95 57 ms, fan-out p95 72 ms, rapid enqueue p95 142 ms (target ≤800), rapid result max 206 ms (target ≤5000), sender distribution client 1120 : staff 3360 (D1 1120:3360, ratio 1:3), HTTP read p95 108 ms, committed 4480/4480, lost 0, leaked 0 |
| AC-40 | PARTIAL | tests/v22/operations.e2e.spec.ts; tests/v22/chat.test.mjs | client/staff shared chat, handoff, assistant (test double), consents in Chromium PASS_LOCAL; clean attachment playback BLOCKED (no scanner); staging UAT NOT_RUN |
| AC-41 | PASS_LOCAL | tests/v22/portal.test.mjs; tests/v22/portal.e2e.spec.ts | two entry cards, account after OTP only, intent routing |
| AC-42 | PASS_LOCAL | tests/v22/portal.test.mjs | account password vs case-only legacy password |
| AC-43 | PASS_LOCAL | tests/v22/portal.e2e.spec.ts | path selector focus/back/unsure |
| AC-44 | PASS_LOCAL | tests/v22/portal.test.mjs; tests/v22/portal.e2e.spec.ts | server drafts CAS+idempotency, offline queue, two-tab conflict |
| AC-45 | PARTIAL | tests/v22/portal.e2e.spec.ts; tests/v22/portal.test.mjs | single pad, resize/DPR, fixed hash PASS_LOCAL in Chromium emulation; real pen/touch devices NOT_RUN |
| AC-46 | PASS_LOCAL | tests/v22/portal.test.mjs | owner-bound signature verified server-side and bound atomically; no STALE/re-sign |
| AC-47 | PASS_LOCAL | tests/v22/portal.test.mjs; tests/v22/portal.e2e.spec.ts | indicator only for full/account session over HTTPS |
| AC-48 | PASS_LOCAL | tests/v22/portal.test.mjs | identical 202, registered contact only, no destination accepted |
| AC-49 | PASS_LOCAL | tests/v22/portal.test.mjs | 5-min case_status scope, minimal answer, no escalation |
| AC-50 | PARTIAL | tests/v22/portal.e2e.spec.ts; tests/v22/portal.test.mjs; tests/*-api.mjs + auth/intake/legal/portal-security scripts | RTL/LTR at 360/768/1440, flows and regressions PASS_LOCAL; staging E2E/UAT/performance NOT_RUN |
| AC-51 | PASS_LOCAL | tests/v22/billing.test.mjs; tests/v22/operations.e2e.spec.ts | catalog/custom/free items, discount, explicit currency, server integer cents |
| AC-52 | PARTIAL | tests/v22/billing.test.mjs | partial CASH atomic — PASS_LOCAL on Miniflare D1; actual D1 NOT_RUN |
| AC-53 | PASS_LOCAL | tests/v22/billing.test.mjs; tests/v22/security.test.mjs | ZELLE full with private R2 receipt; no cross-case/public access |
| AC-54 | PARTIAL | tests/v22/billing.test.mjs | repeated key replays, changed payload 409, lost ACK reconciled — PASS_LOCAL; actual D1 NOT_RUN |
| AC-55 | PASS_LOCAL | tests/v22/billing.test.mjs; tests/v22/security.test.mjs | REFER locks until one MANAGER approves without changing amounts |
| AC-56 | PARTIAL | tests/v22/billing.test.mjs; tests/v22/automation.test.mjs; tests/v22/portal.test.mjs | notice once with remaining/currency/deadline via the outbox, AR/EN PDFs from the server snapshot PASS_LOCAL; provider sandbox NOT_RUN |
| AC-57 | PASS_LOCAL | tests/v22/billing.test.mjs; tests/v22/security.test.mjs; tests/v22/operations.e2e.spec.ts | no view_financials ⇒ 403 and hidden cards; client sees own projection only |
| AC-58 | PASS_LOCAL | tests/v22/access.test.mjs | four roles, atomic Toggles/audit/epoch, stale KV cannot restore access |
| AC-59 | PASS_LOCAL | tests/v22/access.test.mjs | Toronto midnight expiry without cron/KV, no MANAGER authority, crossing transaction rolls back |
| AC-60 | BLOCKED | tests/v22/automation.test.mjs; tests/v22/chat.test.mjs | integrity scan (scanner double), shared-engine recompute, dedup, append-only history, truthful job states PASS_LOCAL; typed extraction adapter and real scanner missing (I07/I15) |

## Blockers that stay open

- Legal: approved official rule packs and reviewed fixtures (AC-09/10/14/15/36).
- Providers: malware scanner, typed extractor, media duration, speech-to-text (I07/I15 → AC-35/60); email provider sandbox (AC-20/56); approved LLM vendor/allowlist (AC-22).
- Policy: retention/lawful-use/vendor/key policy (AC-26 BLOCKED); accepted RPO/RTO targets and an isolated Cloudflare restore (AC-28 BLOCKED); ranking rubric (I10 → AC-16).
- Load evidence (AC-27/AC-39) comes from LOCAL Miniflare (one process); it is not a staging measurement and both stay NOT_RUN.
- Environment: Cloudflare staging/CI with real bindings (AC-25/27/29/33/39/40/50) and actual D1 runs for D1-specific criteria.
- Owner release review (AC-30).
