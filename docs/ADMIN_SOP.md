# Career Gate — Admin SOP

Status: Draft — Pending Human Approval
Approver: Abdullah Musaeed
Environment: Production

## 1. Staff Account Administration
1. Use Career Gate administrative controls for staff lifecycle actions.
2. Confirm the exact target identity before any change.
3. Keep only active required accounts enabled.
4. Disable access when no longer required.
5. Do not create shared staff accounts.
6. Do not alter authentication/session infrastructure to solve ordinary user-management issues.

## 2. Roles and Permission Model
Current verified Production model:
- roles: `admin`, `manager`, `staff`
- permission model: role + granular staff permissions
- permission modes: `full`, `custom`

Operational rules:
- `full` grants the verified full staff permission set;
- `custom` grants only selected verified permissions;
- admin/manager may manage staff permissions only through authorized server-side controls;
- staff may not grant permissions or elevate their own role;
- permission mutations require server authorization and audit evidence.

Do not invent unverified roles or permission names.

## 3. Grant / Revoke Permissions
Before any permission change:
1. confirm target staff identity;
2. confirm requested business need;
3. confirm actor is authorized;
4. select `full` or `custom` deliberately;
5. for `custom`, grant only required permissions;
6. verify final effective permissions server-side;
7. verify audit evidence.

Required audit fields where the system records permission changes:
- actor
- target
- previous permissions
- new permissions
- timestamp

## 4. Audit Requirements
For sensitive administrative actions retain evidence of actor, actor role, target type/id, action, reason where required, previous/new state where available, timestamp, and trace/reference where available.

Never place passwords, OTPs, tokens, cookies, service-role keys, private credentials, or private document contents in audit evidence.

## 5. Archive Policy
Archive/soft-delete is the normal removal path.

Rules:
- preserve data and operational history;
- use only authorized server-side/archive controls;
- archive only with a valid reason and exact target identity;
- verify archive state and audit trail;
- restore only through authorized controls.

During Go-Live cleanup, direct-table SQL mutation and hard delete are prohibited.

## 6. Permanent Delete — Exceptional Path
Permanent delete is not a normal operational workflow.

Before any permanent delete:
1. verify admin/manager authority in Production;
2. enter/confirm the explicit target identifier;
3. complete required first and second confirmations;
4. check legal, financial, dependency, and retention consequences;
5. retain required audit evidence;
6. confirm irreversibility.

Never use permanent delete for routine synthetic-record cleanup.

## 7. Restore
1. confirm the target is archived rather than permanently deleted;
2. confirm exact identity;
3. use only the supported restore mechanism;
4. verify the record returns to the correct state;
5. verify history remains intact;
6. retain restore audit evidence.

## 8. Monitoring
Monitoring owner: Abdullah Musaeed
Alert recipient: `Alhijrahusa@gmail.com`

Required coverage:
- Production deployment failures
- runtime/server failures
- database failures
- authentication failures

Use platform-native alerting where supported. Verify configuration and use an official non-destructive test alert when available. Do not claim coverage that is not actually configured.

Incident classification:
- P0: Production unavailable, security incident, data-integrity incident, critical authorization failure
- P1: core employee workflow blocked
- P2: degraded non-blocking operation

For P0/P1, freeze non-essential operational mutations until triage.

## 9. Backup Verification
Backup owner: Abdullah Musaeed
Final Go-Live policy:
- PITR mandatory
- retention at least 30 days
- no fallback/conditional pass

Verification must use Supabase/platform backup metadata, not ordinary table reads.

Record:
- latest backup
- backup timestamp
- PITR state
- retention days
- verification timestamp
- verifier

If PITR is unavailable or retention is below 30 days, Go-Live remains blocked.

## 10. Rollback Target
A valid rollback target must be an actual prior Production deployment and must satisfy one of:

A. successful Production Live Verify exists for that exact deployment; or

B. Career Gate runtime fingerprint is proven identical to the successfully verified Career Gate baseline, the deployment was READY, its identity/SHA are known, no Career Gate runtime-affecting difference exists, and required rollback smoke routes are verified before accepting it.

Commit ancestry alone is insufficient.

## 11. Rollback Procedure
1. identify verified known-good deployment;
2. verify exact deployment ID and SHA;
3. invoke the supported Vercel rollback/redeploy mechanism;
4. verify active Production alias resolves correctly;
5. verify Production root health;
6. verify `/staff/login`;
7. verify the current Smart Client Import Production route;
8. if an actual rollback occurs, verify basic authenticated operational health;
9. record the rollback event and evidence.

Do not assume obsolete `/staff/import` unless current Production discovery confirms it exists.

## 12. Incident Handling
1. identify exact failure and affected scope;
2. preserve logs/evidence;
3. classify code/config/database/provider/access cause;
4. stop duplicate recovery attempts;
5. choose one authoritative recovery path;
6. verify rollback target before rollback;
7. apply only the minimum required fix;
8. run affected validation only;
9. verify Production after recovery;
10. document outcome.

Never disable authorization, RLS, validation, or security controls as an incident shortcut.

## 13. Hotfix Approval
Hotfix approver: Abdullah Musaeed

During freeze/hypercare every hotfix requires:
- verified current defect;
- exact evidence;
- isolated scope;
- explicit approval;
- relevant tests;
- verified rollback target;
- PR-only change;
- Production verification after deployment.

No unrelated refactor, feature, or aesthetic work may be bundled into a hotfix.

## 14. Go-Live Freeze
Freeze is active only when:
- `FREEZE_CONFIRMED=yes`
- actual ISO timestamp is recorded
- owner identity is recorded
- B1 main protection is active
- B7 backup/rollback is verified
- PR-only is enforced
- direct main push is disabled
- hotfix approval path exists

A written policy alone is not an active freeze.

During freeze:
- `NO_NEW_DEV_CYCLE=true`
- PR-only changes
- no direct main push
- only verified operational, P0/P1, or verified security fixes

## 15. Hypercare
Hypercare starts only when the first authorized released employee begins real Production work.

Target duration: 72 hours.

Exit requires:
- at least 72 hours elapsed;
- no critical incidents;
- no unresolved Production blocker;
- monitoring operational;
- PITR/backups verified;
- employee UAT complete;
- First-Day Acceptance passed;
- owner approval;
- tech-lead approval.

If any exit criterion is ambiguous at 72 hours, extend by 24 hours and require explicit owner reassessment. Do not unfreeze automatically.

## 16. Human UAT
B5 requires a real human operator in Production using isolated clearly synthetic UAT data:
1. Login
2. Import
3. Review
4. Verify
5. Approve
6. Queue
7. Open Client
8. Re-attach

Pass condition: 8/8 without developer intervention and no unresolved blocking usability issue.

## 17. Evidence Retention
Canonical Go-Live evidence path: `docs/go-live/`.

Store only non-secret evidence. Never store passwords, OTPs, access/refresh tokens, cookies, session storage, DB credentials, service-role keys, private credentials, or secret authentication links.

All documentation/evidence changes are PR-only.

## Approval
ADMIN_SOP_APPROVER:
- Abdullah Musaeed

This SOP remains `drafted_pending_human_approval` until human approval is completed. It becomes operational only after approval, PR merge, and verification of the canonical file on `main`.
