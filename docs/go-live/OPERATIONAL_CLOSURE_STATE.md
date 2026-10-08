# Career Gate — Go-Live Closure State

Baseline main SHA: `c5a715f9923dbb1b270ac91ba78c05638fdb3ffa`

## Closed / directly verified
- PRODUCTION_DEPLOYMENT=READY
- SECURITY_PRIVILEGE_FLOOR_037=APPLIED
- ANON_GET_CANDIDATE_CONTACT_EXECUTE=REVOKED
- ANON_UNLOCK_CANDIDATE_CONTACT_EXECUTE=REVOKED
- AUTHENTICATED_EXECUTE_FOR_BOTH=PRESERVED
- SERVICE_ROLE_EXECUTE_FOR_BOTH=PRESERVED
- STAFF_AUTH_LINKAGE=6_OF_6_ACTIVE_ACCOUNTS_PRESENT_CONFIRMED_NOT_BANNED
- ADMIN_ROLE_CHECK=VERIFIED
- STAFF_ROLE_CHECK=VERIFIED
- STAFF_PRIVILEGED_ACCOUNT_UPDATE=BLOCKED_BY_RLS
- STAFF_PRIVILEGED_COMMISSION_UPDATE=BLOCKED_BY_RLS
- Career-005 assigned live clients=0; this is an operational state, not an access defect.

## Human/admin gates
- MAIN_PROTECTION=HUMAN_ADMIN_ACTION_REQUIRED
  - Current GitHub main reports protected=false.
  - Required: PR before merge; at least 1 approval; current CI/status checks; disallow force pushes; disallow branch deletion.
  - Production changes remain PR-only until this is closed.

- PITR_30_DAY_VERIFICATION=HUMAN_SUPABASE_ADMIN_REQUIRED
  - Confirm PITR enabled and retention >=30 days in Supabase Dashboard.
  - No fallback or inferred PASS.

- MONITORING=HUMAN_VERIFICATION_REQUIRED
  - Verify existing production deployment/runtime, database, auth/security, and critical application alert sources.
  - Record exact source, owner, destination, enabled/disabled state.

## Notifications
Three exact historical notification rows are currently `not_configured`:
- `03e3b398-721e-471e-b5af-cb9adfd98d72` — email / staff_message
- `6f19dd92-8625-48f4-b853-752cd2643afd` — email / staff_message
- `145260f9-750e-4741-8240-87eb96e8b797` — email / staff_message

Current repository code does not reference the `staff_message` template. Current submission notification code uses `submission_received`.
- HISTORICAL_STAFF_MESSAGE_ROWS=NON_BLOCKING_LEGACY_RECORDS
- ENV_CONFIGURATION=NOT_VERIFIED because Vercel environment metadata access returned 403.
- PROVIDER_READINESS=NOT_VERIFIED
- No second notification system may be created.

## Synthetic import cases
The following cases are explicitly identifiable as test/synthetic data and remain unarchived:
- `348c45b9-5da4-4da3-b574-0ee71fbdadab` — Production E2E Verification 20261004
- `867a5fc1-221a-44ce-8d74-25319d8c271e` — PRODUCTION E2E TEST 20261004 1933
- `ad854383-be3a-4b0f-93c0-11c9a72dd816` — CLIENT SYNTHETIC TEST DATA / Ahmed Test Person (Synthetic)

- SYNTHETIC_CLEANUP=DEFERRED_SAFE
- No direct SQL cleanup.
- No hard delete.
- Preserve until a supported archive/cleanup workflow is confirmed.

## Roles
Current active role state:
- ADMIN=5
- STAFF=1
- MANAGER=0

No role changes are authorized by this closure document.
MANAGER_COUNT=0 is a known operational state, not a code defect.

## Human UAT
- HUMAN_UAT=READY_FOR_REAL_HUMAN
- PASS requires one actual authorized employee to complete 8/8 in Production using synthetic/training data:
  1. Login to Production
  2. Open assigned authorized workspace
  3. Start client intake/import
  4. Review client data
  5. Correct one field
  6. Approve/save through allowed workflow
  7. Open resulting Client
  8. Confirm authorized daily work succeeds and privileged unauthorized actions are blocked
- No real payment during UAT.

## Final release rule
`GO_LIVE_READY=true` only when all required gates are directly verified:
- MAIN_PROTECTION=VERIFIED_PROTECTED
- PITR_RETENTION>=30_DAYS_VERIFIED
- MONITORING_REQUIRED_ALERTS=VERIFIED
- REQUIRED_NOTIFICATIONS=CONFIGURED_OR_PROVEN_NON_BLOCKING
- SOP=CURRENT_AND_PUBLISHED
- HUMAN_UAT=8/8_REAL_HUMAN
- EMPLOYEE_ACCESS=VERIFIED
- PRODUCTION_DEPLOYMENT=READY
- CORE_WORKFLOWS=PRODUCTION_VERIFIED

Do not infer or invent PASS.
