# Royal staff workspace

The staff workspace uses the original client, ledger, appointment and review records. The six operational workspaces still derive exclusively from `clients.current_status`; manager review, saved filters and offline drafts do not create another client lifecycle. See [the status map](client-workflow-map.md).

| Entry point | Actual behavior |
| --- | --- |
| Clients | Ten records per server page, scoped search, current-stage membership, per-account saved filters, Excel and Print / Save PDF |
| Smart Intake | Ten imports per page, visible Open / Approve, grouped recorded fields, review and source drawers |
| Approval with missing items | Explicit confirmation and reason; recorded actor, reviewer, time and missing fields; canonical client creation and follow-up tasks remain atomic |
| Send to manager | Durable hand-off of an accessible client or authorized report, without changing the client state |
| Manager Task Center | In-place review and version-checked canonical routing, immutable resolution record and duplicate/concurrent-resolution protection |
| Operations assistant | Authorized payment, document, team and capacity queries, answered from current records |
| Capacity notice | At most three projections from actual 28-day stage exits; insufficient history is stated explicitly |
| Document preview | Authorized, audited temporary link in a large drawer; zoom, Escape, focus restoration and no page navigation |
| Language | English first visit, persistent EN / AR preference, mirrored layout, unchanged original data |

## Integrity boundaries

Missing optional intake data can be deferred with an audited reason. Identity validity, duplicate resolution, reviewer ownership, current permissions and optimistic version checks remain enforced. Intake approval does not establish that a document is human-verified, an interview passed, or money was paid. Completion still requires the canonical settled account and the entire post-interview checklist.

Manager routing uses the same lifecycle rules as manual routing. A previous successful interview cannot override a newer recorded failure. Report routing creates a real follow-up task for the sender; it does not move unrelated clients.

## Search and exports

Search uses indexed PostgreSQL trigram matching with Arabic normalization. It covers client identity and extraction fields already retained by the system. Full raw OCR text and original document bytes are not newly retained or indexed. Codes, email and phone retain literal matching. RLS is applied before search and export.

Excel exports contain inline strings, including values beginning with `=`; they cannot execute spreadsheet formulas. Export size is bounded. Print / Save PDF uses the browser's PDF/printer flow so Arabic remains readable.

## Offline behavior

An already opened review remains editable without a network connection. Session-only, actor-bound drafts expire after eight hours and are cleared on sign-out/account change. Explicit Save Draft can queue a version-checked save for reconnecting; approval and routing require a connection. Conflicting server changes retain the local draft for comparison rather than silently replacing newer data.

The service worker caches only a generic recovery page. It does not cache private pages, API responses, uploaded documents, signed URLs or credentials. Reopening a private page after a full offline reload requires reconnecting.

## Operational intelligence

The assistant supports explicit operational questions in English and Arabic. Its answers are deterministic database results, not generated claims of a configured language model. Capacity estimates assume the previous 28-day throughput continues, require at least five observed exits, and do not invent client deadlines or statistical confidence. No external reminders are sent automatically.

## Rollout

Apply `20261031224246_manager_task_center.sql` and `20261031224316_registry_search.sql` before deploying the application. Both are additive and preserve all client/payment/appointment records. The first creates the private manager hand-off table, RLS and realtime publication entry; the second adds normalized search indexes and per-account saved filters with RLS.
