# Career Gate — Admin SOP

Status: Draft — Pending Human Approval
Approver: Abdullah Musaeed
Environment: Production

## 1. Staff Account Administration

1. Use Career Gate administrative controls for staff lifecycle actions.
2. Confirm the target staff identity before any change.
3. Keep only active, required staff accounts enabled.
4. Disable access when a staff member no longer requires production access.
5. Do not create shared staff accounts.
6. Do not edit authentication/session infrastructure to solve ordinary staff-management issues.

## 2. Roles

Current verified production roles:

- `admin`
- `manager`
- `staff`

Operational rule:

- admin: system/administrative authority defined by current Career Gate server authorization;
- manager: management/operational actions defined by current Career Gate server authorization;
- staff: assigned-client operational actions within authorized scope.

Do not invent or use unverified roles such as super_admin, owner, tenant_admin, or branch_admin.

## 3. Full / Custom Permission Modes

Go-live constraint:

The current verified production authorization model is role-based plus client scope and RLS. A production granular permission store or verified `full/custom` permission mode was not discovered in the current schema during go-live verification.

Therefore:

- do not represent granular Full/Custom modes as active until they exist in Production and are verified;
- do not simulate granular permission controls in UI only;
- do not weaken current role/server/RLS enforcement;
- any future permission-mode implementation must require server authorization and audit evidence before operational use.

## 4. Grant / Revoke Permissions

For current production:

1. Apply only verified role changes supported by existing Career Gate controls.
2. Confirm the target user and intended role.
3. Require authorized administrative action.
4. Verify the resulting role server-side.
5. Preserve audit evidence where the current operation provides it.

For any future granular permission mode:

- admin/manager management rights must be explicitly implemented and verified;
- staff must never grant permissions;
- staff must never elevate their own role;
- every mutation must be authorized server-side;
- every mutation must record actor, target, previous permissions, new permissions, and timestamp.

## 5. Audit Requirements

For sensitive administrative actions retain evidence of:

- actor;
- actor role;
- target type;
- target identifier;
- action;
- reason where required;
- previous state where available;
- new state where available;
- timestamp;
- trace/reference when available.

Never place OTPs, tokens, passwords, service-role keys, private document contents, or other secrets in audit records.

## 6. Archive Policy

Default client deletion action:

`Delete & Archive`

Rules:

- archive/soft-delete is the normal removal path;
- preserve client data and operational history;
- archived records are available only to authorized management roles according to current production controls;
- restoration is permitted only through an authorized management process;
- every archive/restore action must be attributable and auditable.

Staff must not archive/delete clients unless explicitly authorized by the verified production authorization model.

## 7. Permanent Delete — Exceptional Path

Permanent delete is not the normal workflow.

Requirements before any permanent delete:

1. admin/manager authority must be verified by the actual production implementation;
2. explicit target client/case identifier must be entered/confirmed;
3. first confirmation must identify the target and effect;
4. second confirmation must explicitly confirm irreversibility;
5. dependency impact must be checked;
6. legal/financial/audit retention requirements must be checked;
7. an audit record must be retained where technically/legal-operationally applicable;
8. no hard delete may be used merely for routine test cleanup.

During B4 go-live cleanup, hard delete is prohibited.

## 8. Restore

1. Confirm the client is archived, not permanently deleted.
2. Confirm the exact client identifier.
3. Use only the authorized restore mechanism.
4. Verify the record becomes active/visible according to current rules.
5. Verify operational history remains intact.
6. Retain restore audit evidence.

Permanent-delete restore is not supported.

## 9. Monitoring

Monitoring owner: Abdullah Musaeed
Alert recipient: `Alhijrahusa@gmail.com`

Required monitoring domains:

- deployment failures;
- runtime/server errors;
- database failures;
- authentication failures.

Required process:

1. configure platform-native alerts where supported;
2. use the designated alert recipient;
3. test with an official supported test-alert mechanism when available;
4. retain configuration and delivery evidence;
5. investigate critical production alerts immediately.

Do not expose secrets in alert payloads.

## 10. Backup Verification

Backup owner: Abdullah Musaeed
Required policy target:

- PITR: enabled;
- retention: at least 30 days.

Verification must use Supabase backup metadata, not ordinary SQL table reads.

Record:

- latest backup;
- backup timestamp;
- retention days;
- PITR state;
- verification timestamp;
- verifier.

Do not claim backup compliance without platform metadata evidence.

## 11. Rollback

Rollback owner: Abdullah Musaeed

Procedure:

1. identify a deployment already verified as known-good;
2. confirm its exact Git SHA;
3. confirm CI/acceptance success for that SHA;
4. invoke the platform-supported rollback/redeploy path;
5. verify production root health;
6. verify `/staff/login`;
7. verify `/staff/import` authentication/access behavior;
8. record the rollback event and reason.

Do not roll back to an unverified SHA.

For irreversible data migrations, use a forward-recovery procedure rather than unsafe rollback.

## 12. Incident Handling

For a production incident:

1. identify the exact failure and affected scope;
2. preserve logs/evidence;
3. determine whether the issue is code, configuration, database, provider, or access related;
4. stop duplicate recovery attempts;
5. choose one authoritative recovery path;
6. verify a rollback target before rollback;
7. implement only the minimum required operational fix;
8. run affected validation only;
9. verify Production after recovery;
10. document incident outcome.

Never disable authorization, RLS, signature verification, or other security controls as an incident shortcut.

## 13. Hotfix Approval

Hotfix approver: Abdullah Musaeed

During freeze/hypercare a hotfix requires:

- verified production defect;
- exact evidence;
- defined affected scope;
- technical-lead approval;
- known rollback target;
- PR-based change;
- relevant checks passing;
- production verification after deployment.

No unrelated refactor or feature work may be bundled into a hotfix.

## 14. Go-Live Freeze Rules

Go-live SHA: `fe4e21a85fc36fd45ddadb983376c185f6baef1f`

Freeze begins immediately after final production verification and human confirmation.

During freeze:

- `NO_NEW_DEV_CYCLE=true`;
- PR-only changes;
- no direct main push;
- hotfix requires tech-lead approval;
- hypercare changes are verified operational fixes only;
- every hotfix requires evidence and rollback target.

Hypercare target: 72 hours.

Hypercare does not end automatically when 72 hours elapse.

Unfreeze requires all of:

- no critical incidents;
- no unresolved production blockers;
- monitoring healthy;
- backup verified;
- UAT complete;
- no rollback required;
- GO_LIVE_OWNER approval;
- TECH_LEAD approval.

## 15. Production UAT Handoff

B5 requires a real employee to execute in Production without developer intervention:

1. Login
2. Import
3. Review
4. Verify
5. Approve
6. Queue
7. Open Client
8. Re-attach

Pass condition: 8/8 successful without developer intervention.

Record each step, blocker, date, and final result.

## Approval

ADMIN_SOP_APPROVER:
- Abdullah Musaeed

This SOP remains `drafted_pending_human_approval` until the required human approval is completed.