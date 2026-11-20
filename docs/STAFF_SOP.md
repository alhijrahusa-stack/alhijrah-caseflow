# Career Gate — Staff SOP

Status: Draft — Pending Human Approval
Approvers: Abdullah Musaeed, Salah Abdulhakim
Environment: Production

## 1. Login

1. Open the Career Gate staff portal.
2. Enter the authorized work email.
3. Request one sign-in code.
4. Enter the received verification code.
5. Confirm the Staff Dashboard loads before starting work.
6. Never share OTP codes, session links, or authentication tokens.

If login fails, stop repeated OTP requests and escalate to the administrator with the exact error and time.

## 2. Smart Client Import

1. Open the existing Staff Import workspace.
2. Choose the supported smart-import source.
3. Review the parsed client information before committing it.
4. Confirm the client identity and required fields.
5. Submit only after the displayed information matches the source material.
6. Open the resulting client record and verify the import completed correctly.

Do not invent missing information and do not overwrite an existing client solely because imported data appears similar.

## 3. Sheet Import

1. Open the existing import workspace.
2. Select the supported sheet/import source.
3. Confirm column mapping and parsed records.
4. Resolve invalid rows before final submission.
5. Review duplicate indicators before continuing.
6. Submit only validated rows.
7. Confirm the resulting records in Career Gate.

Do not bypass validation or manually create duplicate records to work around an import error.

## 4. Import Queue

1. Review queued or pending imported records.
2. Work from the existing queue state shown by Career Gate.
3. Open each queued item that requires human review.
4. Complete required review/verification actions.
5. Resolve blockers before moving the file forward.

Do not mark work complete when the authoritative operation has not succeeded.

## 5. Review

For each client file:

1. Confirm identity and contact details against the submitted source.
2. Review application data, requirements, documents, tasks, appointments, and current workflow status.
3. Check for duplicate or conflicting records.
4. Confirm required evidence is attached to the correct client.
5. Record only factual operational notes.
6. Leave unresolved items in their actual pending/blocking state.

## 6. Verify

1. Review the exact document or requirement requiring verification.
2. Confirm the document belongs to the correct client.
3. Compare the source evidence with the operational record.
4. Use only the verification controls available to your authorized role.
5. Do not mark a document verified when the evidence is incomplete, unreadable, inconsistent, or belongs to another client.

Staff members without the required authorization must escalate verification/approval work to a manager or administrator.

## 7. Duplicate Handling

1. Do not create a second client record to bypass a duplicate warning.
2. Compare the existing record and incoming information.
3. Confirm whether the records represent the same person.
4. Escalate ambiguous identity conflicts to a manager/administrator.
5. Preserve existing history and audit evidence.

Never merge or delete records based only on a matching name.

## 8. Missing Documents

1. Identify the exact missing requirement/document.
2. Confirm the requirement belongs to the correct stage/client.
3. Record the missing item through the existing Career Gate workflow.
4. Use approved communication/follow-up actions when available.
5. Keep the client blocked when the requirement is mandatory and not satisfied.

Do not mark a requirement complete merely to move the workflow forward.

## 9. Re-Attach

1. Open the correct client file.
2. Confirm the replacement document belongs to that client and requirement.
3. Upload/re-attach through the existing secure document flow.
4. Confirm the new document appears on the correct client.
5. Re-run the applicable human review/verification step.

Never attach a document to a different client to work around an upload problem.

## 10. Approve File

1. Review all required stages, documents, and blockers.
2. Confirm all mandatory requirements are satisfied.
3. Use the existing approval/action control only when your role is authorized.
4. Confirm the resulting workflow state is correct.
5. If approval is denied by the system, do not bypass the authorization control; escalate.

## 11. Open Client

1. Use the existing client search, queue, or dashboard link.
2. Confirm the client name/reference before taking action.
3. Work only on clients visible within your authorized scope.
4. Use Client File as the operational record for documents, tasks, appointments, follow-ups, status, and activity.

## 12. Prohibited Actions

Staff must not:

- share OTPs, access tokens, passwords, or private credentials;
- access a client outside authorized scope;
- attempt to elevate their own role;
- grant permissions to themselves or others;
- bypass server authorization or RLS;
- hard-delete client records;
- alter financial history outside authorized Career Gate controls;
- mark incomplete work as complete;
- create duplicate clients to bypass validation;
- upload documents to the wrong client;
- store client secrets in notes, browser storage, or personal files;
- disable security controls to make an operation succeed.

## 13. Escalation Path

Escalate immediately when:

- authentication fails repeatedly;
- access is denied for an action required to complete work;
- client identity is ambiguous;
- a duplicate cannot be resolved safely;
- a required document is inconsistent or suspicious;
- an approval/verification action requires manager/admin authority;
- a financial or commission discrepancy appears;
- a system error, provider failure, or data inconsistency blocks work.

Escalation owner: authorized Career Gate manager/administrator.

Include:

- client reference when applicable;
- exact action attempted;
- exact error/result;
- timestamp;
- screenshot only when it does not expose secrets.

## 14. Logout and Security Basics

1. Sign out when work is complete or the device is unattended.
2. Do not share a staff session between users.
3. Do not save OTPs or credentials in notes or messages.
4. Use only authorized devices/networks for production work.
5. Report unexpected access, suspicious activity, or unauthorized data exposure immediately.
6. Never copy private client documents outside approved operational workflows.

## Approval

STAFF_SOP_APPROVERS:
- Abdullah Musaeed
- Salah Abdulhakim

This SOP remains `drafted_pending_human_approval` until both required operational approvers complete the required review/approval process.