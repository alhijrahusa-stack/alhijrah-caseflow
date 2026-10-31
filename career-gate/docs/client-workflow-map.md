# Career Gate — client state map

`clients.current_status` is the authority for operational membership. The six workspaces derive their membership from that field. Existing detailed statuses remain intact for assessments, screening, I-9, first-day preparation and integrations. `pipeline_stage` is retained for compatibility; changing it alone cannot move a client through the workflow API.

| Workspace | Current statuses | Exit evidence / action |
| --- | --- | --- |
| Intake | `new_intake`, `needs_review` | Staff reviews and routes to Account Setup; a verified READY account and pre-interview requirements permit direct Job Ready routing through existing legal transitions in one transaction. |
| Account Setup | `ready_to_apply`, `application_in_progress`, `assessment_required` | READY account and verified pre-interview requirements; future post-hire requirements do not block job preparation. |
| Job Ready | `shift_selected`, `appointment_required` | An actual employment-interview appointment, followed by the existing booking/route action. Failed or interested-but-cancelled attempts return here without deleting the account or prior result. |
| Appointments | `appointment_scheduled` | Attendance plus a recorded decision. Active lists exclude final outcomes and clients outside this status. The default Active Cases view includes overdue interviews awaiting a result; History preserves earlier appointments. |
| Payment & Paperwork | `pre_hire_completed`, `screening_pending`, `i9_available`, `post_hire_tasks`, `ready_for_first_day` | Paperwork may proceed alongside payment. The unpaid subqueue uses the verified ledger; the whole stage uses the post-interview status set. |
| Completed Files | `completed` | All 11 existing post-hire items completed or explicitly not required, the first-day readiness item completed, and the ledger settled. Both write orders are supported. |

`cancelled` stays outside active work in the existing archive. Completed files are not soft-deleted. The all-records register remains available explicitly; `/staff/clients` opens Intake only.

## Completion events and recovery

Post-hire updates and payment projection changes invoke `career_gate_private.reconcile_client_completion` in the same transaction. A fully prepared but unpaid file moves to post-hire work; settlement completes it. Reopening a required item or reversing settlement reopens active post-hire work. The completion guard rejects a new `completed` status without evidence, including through an admin override.

The migration repairs existing fully prepared files from their existing ledger/checklist records. It does not invent interview decisions, payments, staff approvals, appointments or replacement client IDs. Original appointments remain in history.

Manual controls on client cards and the full client file call the existing routing command, require a reason and retain authorization/RLS. Routing, assignment and reconciliation write audit records. The completed destination rechecks evidence rather than overriding it.

## Aggregated dashboard

`GET /api/staff/dashboard-summary` authenticates staff and reads scoped aggregates. It returns six stage counts, stage age from recorded status events, actual receivables, latest-outcome conversion, five prioritized files, and staff workload. It never loads all client profiles to count them. Admin system health uses the existing admin-only reader; staff do not receive privileged queue internals.

Payment delays are evaluated against recorded Pass dates and outstanding balances at read time (more than three days), so this list does not depend on a second scheduled job. Document lists use the latest document per type. Team bars compare current observed loads; they do not imply invented employee capacity. Dashboard changes refresh the aggregate through the existing realtime resource graph without a full dashboard route reload; other surfaces retain their existing recovery behavior.

The single-file `public/career-gate-royal.html` uses the same authenticated APIs and realtime provider. It contains no sample clients, production credentials or hardcoded operational totals. To regenerate: `npm --prefix scripts/royal ci --ignore-scripts` followed by `node scripts/export-royal-html.mjs`.
