# Career Gate Go-Live Operational Closure Evidence

GO_LIVE_SHA: `fe4e21a85fc36fd45ddadb983376c185f6baef1f`
Evidence date: 2026-10-05

## Capability Declaration

- GITHUB_WRITE=yes
- GITHUB_ADMIN_READ=yes
- GITHUB_ADMIN_WRITE=no
- VERCEL_WRITE=yes
- VERCEL_ALERT_WRITE=no
- SUPABASE_WRITE=yes
- SUPABASE_BACKUP_READ=no
- SUPABASE_ALERT_WRITE=no
- BROWSER_ACTION=yes
- DB_SQL_READ=yes
- DB_SQL_WRITE=yes

## B1 — Branch Protection

Target: `main`

Verified current state:
- main SHA: `fe4e21a85fc36fd45ddadb983376c185f6baef1f`
- protected: `false`
- required status checks enforcement: `off`
- required contexts: none

Required administrative write capability is not available through the current GitHub connector.

Disposition: `handoff`

Required human action:
- Require pull request before merge.
- Require 1 approval.
- Require checks: `typecheck`, `lint`, `unit`, `integration`, `build`, `e2e`.
- Disable force push.
- Disable branch deletion.
- Re-read and retain the final branch/ruleset state.

## B2 — Access Inventory + Least Privilege

Verified:
- Repository principal `alhijrahusa-stack` has `admin` permission.

Limitation:
- The current connector does not expose a complete repository/org collaborator-membership listing endpoint for the required before/after inventory.
- GitHub administrative write is unavailable.

Disposition: `handoff`

Required human action:
- Review repository/org membership in GitHub.
- Classify each principal as admin/write/read.
- Remove only access verified as unused/unrequired.
- Retain before/after membership evidence.

## B3 — Production RBAC

Verified production staff rows include:
- `ab.almoraisy@gmail.com` → role=`staff`, active=`true`.
- `alhijrahusa@gmail.com` → role=`admin`, active=`true`.

Verified server authorization implementation at go-live SHA:
- Roles are `admin`, `manager`, `staff`.
- `verify_document`, `reject_document`, `request_reupload`, and `process_document` require manager/admin.
- `update_staff_role`, `disable_staff`, `reactivate_staff`, and `invite_staff` require admin.
- Staff client scope is restricted to assigned live clients.

Verified unauthenticated production test:
- GET `/staff/import` redirects to `/staff/login?next=%2Fstaff%2Fimport`.

Verified schema discovery:
- No production table/column matching a granular permission store was discovered via `information_schema` using `%permission%` identifiers.

Unverified because no authenticated browser session is available in the connected browser profile:
- authenticated `/staff/import` using `ab.almoraisy@gmail.com`;
- direct approval mutation returning HTTP 403 for a non-reviewer;
- staff permission grant denial;
- self-elevation denial;
- permission-mutation audit payload.

Disposition: `handoff`

## B4 — Production Data Cleanup

Synthetic source evidence:
- The committed Career Gate E2E harness generates `@test.invalid` addresses.

Exact production synthetic records discovered:

1. `bfaf0ae4-8323-4e5e-8782-c4e97c376e8c` / `CG-2026-000016`
   - `cg-prod-public-36940682270@test.invalid`
   - already archived (`deleted_at=2026-10-01 23:28:18.131584+00`)

2. `2c794a9c-0635-4a97-84cc-e85a63f1b444` / `CG-2026-000017`
   - `cg-prod-public-36940858824@test.invalid`
   - already archived (`deleted_at=2026-10-01 23:28:18.131584+00`)

3. `f9ee0fc3-61c0-4d08-b84b-eb1b937a438d` / `CG-2026-000018`
   - `test.invalid@test.invalid`
   - already archived (`deleted_at=2026-10-03 17:29:03.182215+00`)
   - `activity_log` contains `client_deleted` with `recoverable=true` and reason `TEST`.

No hard delete was performed.
No additional mutation was performed because all three exact synthetic records are already archived.

Audit evidence for records 1 and 2 was not found in `activity_log`, `audit_logs`, or `security_events` using their exact identifiers.

Disposition: `handoff` pending audit-evidence closure for records 1 and 2.

## B6 — Monitoring + Ownership

Owner: Abdullah Musaeed
Recipient: `Alhijrahusa@gmail.com`

Current tool capabilities:
- VERCEL_ALERT_WRITE=no
- SUPABASE_ALERT_WRITE=no

Disposition: `handoff`

Required human action:
- Configure Vercel deployment/runtime error alerts to `Alhijrahusa@gmail.com`.
- Configure Supabase database/auth failure alerts to `Alhijrahusa@gmail.com`.
- Trigger an official supported test alert if available and retain evidence.

## B7 — Backup + Rollback

Verified GitHub/Vercel production evidence for go-live SHA:
- SHA: `fe4e21a85fc36fd45ddadb983376c185f6baef1f`
- GitHub checks on exact SHA:
  - `acceptance` = success
  - `web` = success
  - `verify-vercel-production` = success
- Vercel commit status = success
- Vercel deployment reference: `https://vercel.com/career-gate/alhijrah-caseflow/6QZQx1k87qDGdqZQt7AkPzxd2Rdc`
- Production root smoke = success
- `/staff/login` smoke = success
- unauthenticated `/staff/import` protection = success (redirect to login)

Verified known-good candidate:
- KNOWN_GOOD_SHA=`fe4e21a85fc36fd45ddadb983376c185f6baef1f`
- KNOWN_GOOD_VERCEL_DEPLOYMENT=`6QZQx1k87qDGdqZQt7AkPzxd2Rdc`

Backup/PITR metadata cannot be read with current Supabase connector capabilities.

Disposition: `handoff`

Required human action:
- Verify latest Supabase backup timestamp.
- Verify PITR enabled.
- Verify retention >= 30 days.
- Record exact values.

Rollback procedure:
1. Identify the verified known-good Vercel deployment.
2. Verify its corresponding Git SHA.
3. Invoke the platform-supported rollback/redeploy mechanism.
4. Verify production root health.
5. Verify `/staff/login`.
6. Verify `/staff/import` access control.
7. Record the rollback event.

## B9 — Go-Live Freeze

Required human confirmation has not been supplied in this execution.

Disposition: `handoff`

Required human output:
- FREEZE_CONFIRMED=yes
- FREEZE_TIMESTAMP
- OWNER=Abdullah Musaeed
- HYPERCARE_START
- HYPERCARE_END

Freeze policy:
- no new development cycle;
- PR only;
- no direct main push;
- hotfix requires tech-lead approval;
- hypercare changes limited to verified operational fixes;
- hotfix requires evidence and rollback target.

Unfreeze requires all hypercare exit criteria plus GO_LIVE_OWNER and TECH_LEAD approval; elapsed time alone is insufficient.
