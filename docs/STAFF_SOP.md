# Career Gate — Staff SOP

Status: Draft — Pending Human Approval
Approvers: Abdullah Musaeed, Salah Abdulhakim
Environment: Production

## 1. Login
1. Open the Career Gate staff portal.
2. Enter the authorized work email.
3. Request one sign-in code and enter it in the same login flow.
4. Confirm the Staff Dashboard loads before starting work.
5. Never share passwords, OTPs, session links, cookies, or authentication tokens.
6. If login fails repeatedly, stop repeated attempts and escalate with the exact error and time.

## 2. Dashboard Orientation
Use only workspaces and controls visible to your authorized account. Do not interpret a hidden or denied control as a system failure until the required role/permission is confirmed.

## 3. Smart Client Import
1. Open the supported Smart Client Import workspace.
2. Import only an authorized source.
3. Review extracted values and field evidence.
4. Correct errors manually when evidence supports the correction.
5. Confirm required identity/contact fields before verification.
6. Submit only after the displayed information matches the source.

Never invent missing client information.

## 4. Sheet Import
1. Open the supported sheet import workflow.
2. Confirm column mapping and parsed rows.
3. Resolve invalid rows and duplicate indicators.
4. Submit only validated rows.
5. Confirm resulting records in Career Gate.

## 5. Import Queue
1. Work from the current queue state.
2. Open items requiring human review.
3. Resolve blocking validation items.
4. Do not mark work complete until the authoritative operation succeeds.

## 6. Review
For each file:
1. Confirm client identity and source evidence.
2. Review extracted and manually edited fields.
3. Check duplicate/conflict indicators.
4. Confirm documents belong to the correct client.
5. Record only factual operational notes.
6. Leave unresolved items in their actual pending/blocking state.

## 7. Verify
1. Review the exact field/document being verified.
2. Confirm evidence belongs to the correct client.
3. Compare source evidence with the staged record.
4. Use only controls authorized to your role and granular permissions.
5. Do not verify incomplete, unreadable, conflicting, or wrong-client evidence.

## 8. Manual Correction
Manual changes must be evidence-based. Do not change values merely to make validation pass. After a correction, rerun the supported verification step and confirm the saved value persists.

## 9. Duplicate Handling
1. Do not create a second client to bypass a duplicate warning.
2. Compare identity evidence, not name alone.
3. Escalate ambiguous identity conflicts.
4. Preserve existing history and audit evidence.

## 10. Missing Documents
1. Identify the exact missing requirement.
2. Keep the record in its actual pending state when the requirement is mandatory.
3. Use approved follow-up mechanisms.
4. Do not fabricate or substitute unrelated documents.

## 11. Re-Attach
1. Open the correct file/client.
2. Confirm the replacement document belongs to that client and requirement.
3. Use the supported re-attach/upload control.
4. Confirm the document appears on the correct record.
5. Re-run review/verification when required.

## 12. Approve File
1. Confirm required review and verification are complete.
2. Confirm blocking issues are resolved.
3. Use Approve File only when your role/permissions authorize it.
4. Confirm the resulting status.
5. If the system denies approval, do not bypass authorization; escalate.

## 13. Open Client
1. Use the approved queue/search/client link.
2. Confirm the client identity before action.
3. Work only inside your authorized scope.
4. Treat the canonical client page as the operational client record.

## 14. Archive Rules
Archive is not ordinary staff cleanup. Do not archive/delete records unless the current verified authorization model permits your account and the business reason is valid. Permanent deletion is never a routine staff action.

## 15. Prohibited Actions
Staff must not:
- share credentials, OTPs, sessions, tokens, or authentication links;
- access clients outside authorized scope;
- grant permissions or elevate their own role;
- bypass server authorization/RLS;
- directly mutate Production database tables;
- hard-delete clients;
- invent client data or documents;
- create duplicates to bypass validation;
- disable security/validation controls;
- mark incomplete work complete.

## 16. Escalation Path
Escalate when authentication, authorization, identity, duplicate resolution, verification, approval, data integrity, or a core workflow blocks work.

Escalation owner: authorized Career Gate manager/administrator.

Include only:
- client/case reference when applicable;
- exact action attempted;
- exact error/result;
- timestamp;
- screenshot only when it contains no secrets.

## 17. Logout and Security
1. Sign out when work is complete or the device is unattended.
2. Never share a staff session.
3. Do not save OTPs or private credentials in notes/messages.
4. Use only authorized devices/networks.
5. Report suspicious access or unexpected data exposure immediately.

## 18. Training / UAT
Training and UAT use clearly synthetic records whenever possible. Do not use a real client merely to demonstrate the workflow.

## Approval
STAFF_SOP_APPROVERS:
- Abdullah Musaeed
- Salah Abdulhakim

This SOP remains `drafted_pending_human_approval` until both required approvers complete review. It becomes operational only after approval, PR merge, and verification of the canonical file on `main`.
