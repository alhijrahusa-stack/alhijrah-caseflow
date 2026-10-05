# Career Gate — Operational Go-Live Closure State

Status: GO_LIVE_PARTIAL
Recorded: 2026-10-05
Repository: alhijrahusa-stack/alhijrah-caseflow

## Verified Production Identity

- Career Gate verified baseline SHA: `2dcb89d0e0b7ef0b88fd544d85859a2c34d28679`
- Current main SHA at discovery: `2528a2bb333ff1cb8a0e19d39b7ccec0a4195b4b`
- Current deployed SHA at discovery: `2528a2bb333ff1cb8a0e19d39b7ccec0a4195b4b`
- Production deployment: `dpl_5sJLCKY2AAjuHaKPy2HjC4mCLLux`
- Production deployment state: `READY`
- Active Production alias: `alhijrah-caseflow.vercel.app`
- Post-baseline repository changes discovered at execution: `murailex/` only
- Career Gate runtime diff after verified baseline: `NONE`
- Go-Live SHA assignment: `2528a2bb333ff1cb8a0e19d39b7ccec0a4195b4b`

Existing Career Gate Production E2E/RBAC/data-integrity/visual verification evidence is preserved because no Career Gate runtime-affecting diff was discovered after the verified baseline.

## Capability Declaration

- GITHUB_WRITE=yes
- GITHUB_ADMIN_READ=no (branch-protection administration endpoint inaccessible through current integration)
- GITHUB_ADMIN_WRITE=no
- VERCEL_WRITE=yes
- VERCEL_ALERT_WRITE=no through current connector capability
- SUPABASE_WRITE=yes
- SUPABASE_BACKUP_READ=no through current connector capability
- SUPABASE_ALERT_WRITE=no through current connector capability
- BROWSER_ACTION=yes
- DB_SQL_READ=yes
- DB_SQL_WRITE=yes

DB SQL write capability is not authorization for direct Production cleanup and was not used for B4 mutation.

## B1 — Main Protection

State: `handoff`

Discovery:
- `main` reported unprotected at execution discovery.
- No repository rulesets were returned through the accessible ruleset read.
- Current integration cannot access the administration-only branch-protection endpoint or apply branch-protection/ruleset writes.

Required human action:
Configure main so merges require a pull request, at least one approval, applicable Career Gate CI checks, no force push, no branch deletion, and no unreviewed direct main push. Preserve stronger existing controls if present.

Current Career Gate workflow evidence includes `Career Gate CI` and `Career Gate Staff Upgrade Acceptance`; actual required status-check context names must be confirmed in GitHub when configuring the rule.

## B2 — Access Inventory / Least Privilege

State: `handoff`

The current GitHub integration can verify a known principal's permission but cannot enumerate the complete repository/organization membership required for a complete least-privilege inventory.

Known spot checks during execution:
- `alhijrahusa-stack`: admin
- `claude`: read

These spot checks are not a complete inventory and must not be treated as one.

Required human action:
Review all repository/organization principals, classify ADMIN/WRITE/READ/UNKNOWN, remove or downgrade only evidence-supported unnecessary access, and document every retained UNKNOWN with reason, named owner, explicit temporary-retention approval, and review date.

## B3 — Production RBAC

State: `done`

Preserved verified evidence:
- AUTHENTICATED_PRODUCTION_E2E=PASS
- PRODUCTION_RBAC_VERIFY=PASS
- PRODUCTION_DATA_INTEGRITY_VERIFY=PASS
- PRODUCTION_VISUAL_VERIFY=PASS

B3 was not rerun because no Career Gate runtime-affecting change was discovered.

## B4 — Synthetic Production Data Cleanup

State: `handoff`

Authoritatively identified synthetic E2E clients:
- `fee2cb65-5f50-4fa2-9307-a6fd30e46112` / CG-2026-000021
- `539938ec-3a4b-414b-95c1-f009397095c1` / CG-2026-000023
- `7d7c5b37-b6a0-4076-a267-6ee86d7eb84a` / CG-2026-000025

All three linked clients are currently soft-archived/recoverable using the existing authorized application archive path; no hard delete was performed.

Associated exact import-case IDs:
- `348c45b9-5da4-4da3-b574-0ee71fbdadab`
- `867a5fc1-221a-44ce-8d74-25319d8c271e`
- `ad854383-be3a-4b0f-93c0-11c9a72dd816`

Post-action authoritative SQL verification showed the three `client_import_cases.archived_at` values still null. Therefore the import-case soft-archive portion is NOT claimed complete even though the clients are archived. Direct table SQL mutation is prohibited by the closure policy.

Required human/authorized application action:
Use an existing server-authorized/audited Smart Import archive path that sets `client_import_cases.archived_at`/`archived_by` for these exact three synthetic case IDs, then verify the final state. If the product intentionally retains approved import cases as non-archived audit records, document that authoritative behavior and approve the cleanup exception rather than mutating the database directly.

## B5 — Real Employee UAT

State: `handoff`

Human-only. Abdullah Musaeed must personally complete 8/8 in Production using isolated clearly synthetic UAT data without developer intervention:
Login → Import → Review → Verify → Approve → Queue → Open Client → Re-attach.

Automated E2E evidence does not substitute for this usability gate.

## B6 — Monitoring + Incident Ownership

State: `handoff`

Owners are defined, but the current connector set does not expose the alert-write controls required to prove configuration of all deployment/runtime/database/auth alerts.

Required human action:
Configure platform-native Vercel deployment/runtime alerts and Supabase database/auth alerts to `Alhijrahusa@gmail.com`; use official non-destructive test alerts where supported and retain configuration/delivery evidence.

## B7 — Backup + Rollback Readiness

State: `handoff`

Final policy requires PITR and retention of at least 30 days with no fallback. Current Supabase connector capability does not expose backup/PITR metadata, so B7 cannot be honestly verified from the available integration.

Known rollback candidate evidence remains available for the previously verified Career Gate baseline Production deployment, but B7 cannot close until backup/PITR metadata is verified.

Required human action:
In Supabase, verify PITR is enabled and retention is at least 30 days; record latest backup, backup timestamp, PITR state, and retention. Preserve non-secret evidence.

## B8 — Staff + Admin SOP

State: `drafted_pending_human_approval`

Fresh final drafts created on branch:
`go-live/operational-closure-20261005-final`

Files:
- `docs/STAFF_SOP.md`
- `docs/ADMIN_SOP.md`

Required approvals:
- Staff SOP: Abdullah Musaeed + Salah Abdulhakim
- Admin SOP: Abdullah Musaeed

B8 is not published until human approvals, PR approval/merge, and canonical main-path verification are complete.

## B9A — Go-Live Freeze

State: `handoff`

Blocked by B1 and B7. No freeze timestamp or confirmation has been invented.

B9A can become ready only after B1=done, B7=verified, verified rollback target exists, and the owner explicitly activates the freeze with an actual timestamp.

## B9B — Hypercare

State: `not_started`

Hypercare starts only after released employees begin real Production work.

## Security Advisory Observed During Closure

Supabase's current table advisor reports Row Level Security disabled on `public.spatial_ref_sys`. No remediation was auto-applied because enabling RLS without an explicit policy decision can change access behavior and is outside this operational-closure mutation scope. This advisory must remain visible for an authorized security decision; it is not represented here as a clean/global security pass.

## Current Decision

- GO_LIVE_SHA=`2528a2bb333ff1cb8a0e19d39b7ccec0a4195b4b`
- GO_LIVE_STATUS=`GO_LIVE_PARTIAL`
- EMPLOYEE_HANDOFF=`NOT_STARTED`
- LIVE_OPERATIONS=`NOT_STARTED`
- HYPERCARE=`NOT_STARTED`
- FIRST_DAY_ACCEPTANCE=`NOT_STARTED`

No employee is released for real client work until all blocking Go-Live gates are completed.
