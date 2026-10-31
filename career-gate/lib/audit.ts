import "server-only";
import type postgres from "postgres";
import { fingerprint } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { logActivity } from "@/lib/service";

// Deterministic audit rules. They raise alerts; they never change client data.
export type Severity = "low" | "medium" | "high" | "critical";
type Rule = {
  rule: string;
  severity: Severity;
  recommended_action: string;
  explanation: string;
  query: (db: postgres.Sql, clientId: string | null) => Promise<{ client_id: string; evidence: Record<string, unknown> }[]>;
};

const scope = (db: postgres.Sql, clientId: string | null, col = "c.id") =>
  clientId ? db`and ${db.unsafe(col)} = ${clientId}` : db``;

export const RULES: Rule[] = [
  {
    rule: "identity_review_shared_phone",
    severity: "medium",
    recommended_action: "Verify the applicant. Continue the existing file if it belongs to the same person; otherwise retain both files and record the verification note.",
    explanation: "Another active file uses the same phone. Phone alone does not identify an applicant and does not block staff creation.",
    query: (db, id) => db`
      select c.id as client_id,
             jsonb_build_object('shared_with', jsonb_agg(o.ref order by o.ref)) as evidence
      from clients c
      join clients o on o.id <> c.id and o.deleted_at is null
        and regexp_replace(coalesce(o.phone,''),'\\D','','g') = regexp_replace(coalesce(c.phone,''),'\\D','','g')
      where c.deleted_at is null and length(regexp_replace(coalesce(c.phone,''),'\\D','','g')) >= 7
        ${scope(db, id)}
      group by c.id` as never,
  },
  {
    rule: "identity_review_shared_email",
    severity: "medium",
    recommended_action: "Verify whether these files belong to the same applicant. If they do, continue the earlier file and archive this one; if they do not, ignore this alert with the verification note.",
    explanation: "Another active file uses the same email address. Email alone does not identify a person, so both files were kept and a person must verify the applicant.",
    query: (db, id) => db`
      select c.id as client_id,
             jsonb_build_object('shared_with', jsonb_agg(o.ref order by o.ref)) as evidence
      from clients c
      join clients o on o.id <> c.id and o.deleted_at is null
        and lower(trim(o.email)) = lower(trim(c.email))
      where c.deleted_at is null and nullif(trim(c.email), '') is not null
        ${scope(db, id)}
      group by c.id` as never,
  },
  {
    rule: "i9_available_without_required_prior_steps",
    severity: "high",
    recommended_action: "Confirm screening was completed and record it under Post-Hire Tasks, or correct the status.",
    explanation: "The client is at I-9 Available or later, but screening is not recorded as confirmed or completed.",
    query: (db, id) => db`
      select c.id as client_id, jsonb_build_object('status', c.current_status,
             'screening', (select status from post_hire_items p where p.client_id = c.id and p.item = 'screening')) as evidence
      from clients c
      where c.deleted_at is null and c.current_status in ('i9_available', 'post_hire_tasks', 'ready_for_first_day')
        and not exists (select 1 from post_hire_items p where p.client_id = c.id and p.item = 'screening' and p.status in ('confirmed', 'completed'))
        ${scope(db, id)}` as never,
  },
  {
    rule: "appointment_scheduled_without_appointment",
    severity: "high",
    recommended_action: "Add the appointment record or move the status back to Appointment Required.",
    explanation: "Status says an appointment is scheduled, but no scheduled, confirmed or rescheduled appointment record exists.",
    query: (db, id) => db`
      select c.id as client_id, jsonb_build_object('status', c.current_status) as evidence
      from clients c
      where c.deleted_at is null and c.current_status = 'appointment_scheduled'
        and not exists (select 1 from appointments a where a.client_id = c.id
                        and a.status in ('scheduled', 'confirmed', 'rescheduled'))
        ${scope(db, id)}` as never,
  },
  {
    rule: "appointment_outcome_missing",
    severity: "high",
    recommended_action: "Open the appointment and record the actual attendance and outcome, or reschedule if the interview did not take place.",
    explanation: "The latest active appointment has ended and its outcome has not been recorded.",
    query: (db, id) => db`
      select c.id as client_id, jsonb_build_object('appointment_id', a.id, 'scheduled_at', a.scheduled_at, 'status', a.status) as evidence
      from clients c join lateral (
        select id,scheduled_at,ends_at,status from appointments p where p.client_id=c.id
          and p.status in ('scheduled','confirmed','rescheduled') order by p.scheduled_at desc,p.id desc limit 1
      ) a on true
      where c.deleted_at is null and c.current_status='appointment_scheduled' and a.ends_at<now()
        and not exists (select 1 from appointment_outcomes o where o.appointment_id=a.id)
        ${scope(db, id)}` as never,
  },
  {
    rule: "ready_for_first_day_without_start_date",
    severity: "high",
    recommended_action: "Record the confirmed start date under Post-Hire Tasks.",
    explanation: "The client is Ready for First Day but no start date is recorded.",
    query: (db, id) => db`
      select c.id as client_id, jsonb_build_object('status', c.current_status) as evidence
      from clients c
      where c.deleted_at is null and c.current_status = 'ready_for_first_day' and c.start_date is null ${scope(db, id)}` as never,
  },
  {
    rule: "completed_with_open_required_tasks",
    severity: "medium",
    recommended_action: "Complete or cancel the open tasks, or reopen the file.",
    explanation: "The client is Completed while tasks are still pending or in progress.",
    query: (db, id) => db`
      select c.id as client_id, jsonb_build_object('open_tasks',
             (select jsonb_agg(t.title order by t.created_at) from tasks t where t.client_id = c.id and t.status in ('pending', 'in_progress'))) as evidence
      from clients c
      where c.deleted_at is null and c.current_status = 'completed'
        and exists (select 1 from tasks t where t.client_id = c.id and t.status in ('pending', 'in_progress')) ${scope(db, id)}` as never,
  },
  {
    rule: "document_verified_without_reviewer_metadata",
    severity: "critical",
    recommended_action: "Re-review the document and record the reviewer.",
    explanation: "A document is marked verified without a reviewer or review time.",
    query: (db, id) => db`
      select d.client_id, jsonb_build_object('document_ids', jsonb_agg(d.id order by d.id)) as evidence
      from documents d join clients c on c.id = d.client_id
      where c.deleted_at is null and d.status = 'verified' and (d.reviewed_by is null or d.reviewed_at is null) ${scope(db, id)}
      group by d.client_id` as never,
  },
  {
    rule: "followup_overdue",
    severity: "medium",
    recommended_action: "Contact the client and complete or reschedule the follow-up.",
    explanation: "An open follow-up is past its due date.",
    query: (db, id) => db`
      select f.client_id, jsonb_build_object('followups',
             jsonb_agg(jsonb_build_object('id', f.id, 'due_date', f.due_date, 'reason', f.reason) order by f.due_date)) as evidence
      from followups f join clients c on c.id = f.client_id
      where c.deleted_at is null and f.status = 'open' and f.due_date < (now() at time zone 'America/Detroit')::date ${scope(db, id)}
      group by f.client_id` as never,
  },
  {
    rule: "assessment_required_without_assessment_record",
    severity: "medium",
    recommended_action: "Add the assessment items and record what the client confirms.",
    explanation: "Status is Assessment Required but no assessment items are recorded.",
    query: (db, id) => db`
      select c.id as client_id, jsonb_build_object('status', c.current_status) as evidence
      from clients c
      where c.deleted_at is null and c.current_status = 'assessment_required'
        and not exists (select 1 from assessments a where a.client_id = c.id) ${scope(db, id)}` as never,
  },
];

/**
 * Evaluates every rule (for one client or all). New findings open an alert
 * unless the same evidence was already ignored; open alerts whose condition
 * no longer holds are closed with a system note.
 */
export async function runAudit(clientId: string | null, traceId: string) {
  const db = sql();
  let created = 0;
  let cleared = 0;
  for (const r of RULES) {
    const findings = await r.query(db, clientId);
    const hits = new Set<string>();
    for (const f of findings) {
      hits.add(f.client_id);
      const evidenceHash = fingerprint(f.evidence);
      const [ignored] = await db`
        select 1 from audit_alerts where client_id = ${f.client_id} and rule = ${r.rule} and status = 'ignored' and evidence_hash = ${evidenceHash}`;
      if (ignored) continue;
      const rows = await db`
        insert into audit_alerts (client_id, rule, severity, evidence, evidence_hash, recommended_action, explanation)
        values (${f.client_id}, ${r.rule}, ${r.severity}, ${db.json(f.evidence as never)}, ${evidenceHash}, ${r.recommended_action}, ${r.explanation})
        on conflict (client_id, rule) where status = 'open' do update
          set evidence = excluded.evidence, evidence_hash = excluded.evidence_hash
        returning id, (xmax = 0) as inserted`;
      if (rows[0]?.inserted) {
        created++;
        await logActivity(db, {
          clientId: f.client_id, action: "agent_alert_created", actor: { staffId: null, traceId },
          entityType: "audit_alert", entityId: rows[0].id, newValue: { rule: r.rule, severity: r.severity },
        });
      }
    }
    const open = await db`
      select id, client_id from audit_alerts where rule = ${r.rule} and status = 'open' ${clientId ? db`and client_id = ${clientId}` : db``}`;
    for (const a of open) {
      if (!hits.has(a.client_id)) {
        await db`update audit_alerts set status = 'resolved', resolved_at = now(),
                   resolution_note = 'Condition no longer detected by the rule scan' where id = ${a.id}`;
        cleared++;
      }
    }
  }
  return { created, cleared };
}
