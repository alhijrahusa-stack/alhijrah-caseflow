# Smart import revision rollout and rollback

## Forward rollout

1. Test the migration and the current application together on an isolated database and browser environment. Include concurrent review, OCR and document reattachment, pending override, offline drafts, and legacy-client tests.
2. Apply `20261101232339_import_case_monotonic_revision.sql` before deploying the revision-aware application. The migration is additive: existing inserts and updates need no revision parameter; the database advances the revision on every row update. Do not remove the trigger while either application version is running.
3. Deploy the revision-aware application. Clients without a revision receive HTTP 409 `client_upgrade_required` and must reload. Their stored legacy review drafts must remain available for explicit comparison; they must not be silently sent or overwritten.
4. Check application health, review conflict behavior, pending override audit records, and document access before restoring normal traffic.

## Rollback to code predating pending overrides

A pre-override application can ignore or erase pending override state. **Never expose it to smart import writes while pending state or capture work exists.** Neither the additive revision column nor its trigger protects the pending workflow from an older application.

1. At the ingress, block every mutating smart-import request, including `/api/staff/smart-client-import` and its child routes (mobile, retry, reattach), `/api/staff/universal-intake`, and public `/api/public/client-intake/*` intake/extraction routes. Block other application paths or integrations that write import cases or documents. Keep the block active regardless of which application version receives traffic; verify it with rejected write requests, including from old browser tabs. Do not rely on a frontend toggle.
2. Stop scheduled jobs and all asynchronous/background consumers capable of touching import cases or documents. Drain in-flight requests and OCR/capture work. Verify no writer remains active. If the infrastructure cannot enforce and verify this write freeze, do not roll back to the old application.
3. Take and verify a recoverable, consistent database backup and storage backup. Retain audit records, import rows, pending override snapshots, capture state, document metadata and underlying files; do not clear or rewrite pending state to make the rollback pass. Record the backup locations and count pending overrides and interrupted captures using an authorized operator and a secure channel.
4. Roll back the application while the write freeze remains active. Leave the revision migration and trigger in place. Keep review, approval, import, document upload, reattachment, enrichment and background synchronization blocked for the entire time the old application is serving; old clients may continue to queue local drafts, which must be retained.
5. Restore a tested pending-aware, revision-aware application before enabling writes. Reconcile pending records, interrupted captures, object storage and audit history against the recorded backup and counts; use the application's authorized cancellation/recovery flow, never direct deletion. Validate concurrent editing and pending override behavior in a safe environment, then release writes only after the data and access controls are verified.

Rolling back the database migration or restoring a database snapshot independently of object storage and audit history can lose or desynchronize data. This procedure does not itself provide a freeze mechanism: operations must verify the actual ingress, workers and external integrations in the target environment.
