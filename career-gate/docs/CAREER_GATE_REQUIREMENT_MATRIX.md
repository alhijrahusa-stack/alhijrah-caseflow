# Career Gate Requirement Preservation Matrix

This matrix is the pre-merge scope lock for the Career Gate master execution directive.
A requirement remains visible until its exit gate is proven. `IMPLEMENTED` means code exists on the current branch; `VERIFIED` means the required test/runtime evidence has passed; `PARTIAL` means a required portion or live gate is still outstanding; `MISSING` and `FAILED` are literal.

| ID | Original requirement | Implementation location | Status | Test / evidence | Exit gate |
|---|---|---|---|---|---|
| CG-01 | Regula Document Reader 9.9 primary | `lib/providers/regula.ts`, `document-intelligence.ts` | PARTIAL | Provider contract unit tests added; licensed production endpoint not configured | Real authorized document through production Regula 9.9 |
| CG-02 | Microblink BlinkID Verify 4000.4.0 conditional fallback only | `lib/providers/microblink.ts`, `document-intelligence.ts` | PARTIAL | Contract, endpoint and consent tests added; production endpoint/auth absent | Force a legitimate primary failure and prove fallback |
| CG-03 | Tamper/authenticity, quality, metadata without fabricated results | Regula/Microblink adapters; extraction metadata | PARTIAL | Native provider states preserved; unsupported/not-performed retained | Licensed live capabilities and test document evidence |
| CG-04 | Field provenance, probabilities, page/region/provider/version | `document-intelligence-types.ts`, `smart-client-mobile.ts` | IMPLEMENTED | Unit/provider contract + persistence path | CI green + live provider record |
| CG-05 | ICAO TD1/TD2/TD3 and check digits | `lib/document-validation/mrz.ts`, Regula adapter | IMPLEMENTED | `mrz.test.ts`; Regula MRZ values bind to checksum review state | Current CI green + live MRZ document |
| CG-06 | Barcode/visual/cross-source validation | Regula native validation/cross-source fields | PARTIAL | Native results mapped; no licensed live barcode sample yet | Real supported document with barcode/visual comparison |
| CG-07 | Multi-page / front-back association | Regula FullAuth with double-page processing; current document case grouping | PARTIAL | Provider path accepts PDF/images and case grouping | Real two-side/multi-page acceptance test |
| CG-08 | Safe preprocessing and pre-upload quality | Existing upload validation + Regula quality results | PARTIAL | Type/size validation; provider quality mapped | Client-side blur/glare/corner preflight + live quality test |
| CG-09 | Secure processing cache / duplicate provider-call protection | Existing idempotency/source hashes/system jobs | PARTIAL | Submission idempotency exists | Provider-result cache scoped to document+provider+version with isolation test |
| CG-10 | Human-reviewed recovery and correction feedback | manual evidence precedence, review workflow, activity/audit | IMPLEMENTED | Existing Smart Review integration tests | Current CI green |
| CG-11 | Conflict detection and explainable review | `mergeEvidence()`, provider evidence, review fields | IMPLEMENTED | Conflicts/review states persisted | Current CI green + browser acceptance |
| CG-12 | Internal suggestion engine / trusted-source suggestions | Existing Smart workflow only | PARTIAL | No new unsupported suggestion source introduced | Explicit source+reason suggestions with acceptance tests |
| CG-13 | Country-specific document profiles | Provider document databases | PARTIAL | Country is preserved from provider | Licensed coverage tests for target countries |
| CG-14 | Model/provider versioning | provider version persisted in jobs/evidence/metadata | IMPLEMENTED | Regula 9.9 / Microblink 4000.4.0 labels | Current CI green + live provider evidence |
| CG-15 | Privacy/security/compliance | private storage, server-side calls, RLS, audit, no provider secrets in client | IMPLEMENTED | Existing security suite + provider server-only modules | Current CI/security gate green |
| CG-16 | Public Intake upload → extract → autofill → review → submit | Public intake route/form/extract route | PARTIAL | Existing PR #76 E2E plus provider-review additions | Current E2E green + real production document |
| CG-17 | Stable Case Number across Smart → Client | `public_ref` lifecycle and approval reuses ref | IMPLEMENTED | Existing PR #76 lifecycle tests | Current regression green |
| CG-18 | Duplicate prevention incl. shared email/phone exception and concurrency | public duplicate service, canonical client service, Smart preview, migrations 042/043 | PARTIAL | shared email/phone and same-applicant tests; migration 043 branch-only | Current integration green + apply migration 043 + concurrency proof |
| CG-19 | Staff review/approval/client conversion/downstream sync | existing import review/approval/canonical client path | IMPLEMENTED | Existing PR #76 integration/E2E | Current regression and production test |
| CG-20 | Executive Career Gate identity | public shell, Smart Client form, official brand asset | IMPLEMENTED | Visual code change present | Browser visual regression + live production screenshots |
| CG-21 | Architectural Glassmorphism / POD hierarchy | Public and staff surfaces | IMPLEMENTED | Layered glass surfaces and functional PODs | Browser visual regression |
| CG-22 | State-driven Bezier progress | `components/shared/BezierProgress.tsx`, public + staff forms | IMPLEMENTED | State derives from actual process state | E2E state-transition assertions |
| CG-23 | Intelligent Command Sheet | Smart Client sticky contextual command sheet | IMPLEMENTED | One context-appropriate primary action | Browser acceptance / no dead action |
| CG-24 | Responsive/accessibility/reduced motion | existing responsive form + reduced-motion classes + semantic controls | PARTIAL | existing accessibility/E2E baseline | Current axe/keyboard/mobile regression |
| CG-25 | Realtime Migration 040 | Supabase production | VERIFIED | Migration applied; `client_import_cases` verified in `supabase_realtime`; RLS verified | Closed |
| CG-26 | Staff OTP | existing staff auth flow | PARTIAL | Code/previous CI only | Real production OTP login |
| CG-27 | Staff API | `GET /api/staff/client-resource` existing | PARTIAL | prior CI only | Authorized production request |
| CG-28 | Realtime DB event → authorized UI update | existing targeted realtime implementation | PARTIAL | publication fixed; runtime event not yet observed in authenticated production UI | Real event reception + unauthorized isolation |
| CG-29 | Typecheck/Lint/Unit/Integration/Build/E2E/Staff Acceptance | GitHub Actions | PARTIAL | New PR #78 runs pending after targeted fixes | All checks green on final head |
| CG-30 | Merge/deploy/live runtime/provider evidence/rollback | PR #78 + Vercel | PARTIAL | Current production stays on main `34529ae...`; PR #78 intentionally unmerged | All gates green, licensed providers configured, merge, deploy SHA-match, live E2E |

## Non-negotiable blockers before final production closure

1. Configure a licensed Regula Document Reader 9.9 Web Service endpoint (`REGULA_DOCUMENT_READER_URL`) and any required server authorization.
2. Configure a licensed Microblink BlinkID Verify 4000.4.0 endpoint (`MICROBLINK_VERIFY_URL`) and authorization when required. Cloud mode cannot be enabled until explicit end-user consent is implemented and approved.
3. Pass final PR #78 CI/Acceptance on the exact head.
4. Apply migration 043 only after the code/test gate passes and before release verification.
5. Perform authorized production document extraction, Staff OTP/API, realtime event-to-UI, browser/visual/mobile/accessibility verification.
6. Merge only after the pre-merge provider gate and remaining required gates pass; then verify deployment SHA and live production behavior.
