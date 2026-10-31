"use client";

import { StaffLabel, useStaffLabel } from "@/components/staff/StaffLabel";
import { arabicStaffLabel } from "@/lib/staff-ui-labels";


import { RoyalSelect, RoyalOption } from "@/components/forms/RoyalSelect";


import { useState } from "react";
import { useStaff } from "@/components/staff/StaffContext";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { ASSESSMENT_SOURCE_LABELS, ASSESSMENT_SOURCES, ASSESSMENT_STATUSES, STATUS_LABELS, type Status } from "@/lib/domain";
import { dateTime } from "@/lib/format";
import { OFFICE } from "@/lib/office";
import { Card, SmallBtn, useRowAction, type Row } from "./common";

function AssessmentRow({ clientId, item, canEdit }: { clientId: string; item: Row; canEdit: boolean }) {
  const uiLabel = useStaffLabel();
  const a = useRowAction("Assessment item saved");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(item.status);
  const [answer, setAnswer] = useState(item.confirmed_answer ?? "");
  const [source, setSource] = useState(item.source ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const unresolved = item.status === "unresolved";
  return (
    <tr data-testid={`assessment-${item.item_key}`}>
      <td>{item.prompt_reference ?? item.item_key}<span className="block text-xs text-slate-400">{item.assessment_type}</span></td>
      <td>
        {unresolved ? <span className="font-semibold text-amber-700"><StaffLabel en="UNRESOLVED — NEEDS CLIENT CONFIRMATION"/></span> : uiLabel(item.status.replace("_", " "))}
      </td>
      <td>{item.confirmed_answer ?? <span className="text-slate-400">—</span>}{item.source && <span className="block text-xs text-slate-500">{uiLabel(ASSESSMENT_SOURCE_LABELS[item.source as keyof typeof ASSESSMENT_SOURCE_LABELS])}</span>}</td>
      <td className="text-xs text-slate-500">{item.updated_by_name ?? "—"} · {dateTime(item.updated_at)}</td>
      <td>
        {canEdit && <SmallBtn onClick={() => setOpen(!open)}><StaffLabel en="Update"/></SmallBtn>}
        {open && (
          <form className="mt-2 grid w-72 gap-2 rounded-md bg-slate-50 p-2" onSubmit={async (e) => {
            e.preventDefault();
            const ok = await a.go({ action: "update_assessment", client_id: clientId, assessment_type: item.assessment_type, item_key: item.item_key, status, confirmed_answer: answer || null, source: source || null, notes: notes || null });
            if (ok) setOpen(false);
          }}>
            <RoyalSelect aria-label={uiLabel("Assessment status")} className="input py-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              {ASSESSMENT_STATUSES.map((s) => <RoyalOption labelAr={arabicStaffLabel(s.replace("_", " "))} key={s} value={s}>{s.replace("_", " ")}</RoyalOption>)}
            </RoyalSelect>
            <input aria-label={uiLabel("Answer the client confirmed")} className="input py-1" placeholder={uiLabel("Answer the client confirmed")} value={answer} onChange={(e) => setAnswer(e.target.value)} />
            <RoyalSelect aria-label={uiLabel("Source")} className="input py-1" value={source} onChange={(e) => setSource(e.target.value)}>
              <RoyalOption labelAr="المصدر…" value="">Source…</RoyalOption>
              {ASSESSMENT_SOURCES.map((s) => <RoyalOption labelAr={arabicStaffLabel(ASSESSMENT_SOURCE_LABELS[s])} key={s} value={s}>{ASSESSMENT_SOURCE_LABELS[s]}</RoyalOption>)}
            </RoyalSelect>
            <input aria-label={uiLabel("Notes")} className="input py-1" placeholder={uiLabel("Notes")} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <SmallBtn type="submit" disabled={a.pending}><StaffLabel en="Save"/></SmallBtn>
            {a.error && <p role="alert" className="text-xs text-red-600">{a.error}</p>}
          </form>
        )}
      </td>
    </tr>
  );
}

export function Assessments({ clientId, items, references }: { clientId: string; items: Row[]; references: Row[] }) {
  const uiLabel = useStaffLabel();
  const { isManager } = useStaff();
  const a = useRowAction("Standard items added as UNRESOLVED");
  const [custom, setCustom] = useState({ type: "", key: "", prompt: "" });
  const add = useRowAction("Assessment item added");
  return (
    <Card title={uiLabel("Assessments")} id="assessments"
      actions={isManager && <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "add_standard_assessments", client_id: clientId })}><StaffLabel en="+ Add standard items"/></SmallBtn>}>
      <p className="mb-2 text-xs text-slate-500"><StaffLabel en="Records only answers the client confirmed. The system never chooses or suggests assessment answers."/></p>
      {items.length === 0 ? (
        <EmptyState title={uiLabel("No assessment items")} text={uiLabel("Add the items this client must confirm; they start as UNRESOLVED.")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th><StaffLabel en="Item"/></th><th>Status</th><th><StaffLabel en="Confirmed answer"/></th><th><StaffLabel en="Updated"/></th><th /></tr></thead>
            <tbody>{items.map((i) => <AssessmentRow key={`${i.id}-${i.updated_at}`} clientId={clientId} item={i} canEdit={isManager} />)}</tbody>
          </table>
        </div>
      )}
      {isManager && (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await add.go({ action: "update_assessment", client_id: clientId, assessment_type: custom.type, item_key: custom.key, prompt_reference: custom.prompt || null, status: "unresolved" });
          if (ok) setCustom({ type: "", key: "", prompt: "" });
        }}>
          <input aria-label={uiLabel("Assessment type")} required className="input w-40 py-1" placeholder={uiLabel("Type")} value={custom.type} onChange={(e) => setCustom({ ...custom, type: e.target.value })} />
          <input aria-label={uiLabel("Item key")} required className="input w-32 py-1" placeholder={uiLabel("Item key")} value={custom.key} onChange={(e) => setCustom({ ...custom, key: e.target.value })} />
          <input aria-label={uiLabel("Prompt reference")} className="input w-56 py-1" placeholder={uiLabel("Prompt reference")} value={custom.prompt} onChange={(e) => setCustom({ ...custom, prompt: e.target.value })} />
          <SmallBtn type="submit" disabled={add.pending}><StaffLabel en="+ Add item"/></SmallBtn>
        </form>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium"><StaffLabel en="Reference material (not client answers)"/></summary>
        <ul className="mt-2 space-y-2">
          {references.map((r) => (
            <li key={r.key}><p className="font-medium">{r.title}</p><p className="whitespace-pre-line text-slate-600">{r.body}</p></li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

export function IntakeAgent({ clientId, run }: { clientId: string; run: Row | null }) {
  const uiLabel = useStaffLabel();
  const a = useRowAction(null);
  const toast = useToast();
  const [latest, setLatest] = useState<Row | null>(null);
  const out = (latest?.findings ?? run?.output ?? null) as Row | null;
  const llm = (latest?.llm ?? run?.output?.llm ?? null) as Row | null;
  return (
    <Card title={uiLabel("Intake Check (agent)")} id="intake-agent"
      actions={<SmallBtn disabled={a.pending} onClick={async () => {
        const r = await a.run({ action: "run_intake_agent", client_id: clientId }, null);
        if (r?.run) { setLatest(r.run as Row); toast("info", "Intake check complete"); }
      }}>{a.pending ? uiLabel("Checking…") : uiLabel("Run check")}</SmallBtn>}>
      {!out ? (
        <EmptyState title={uiLabel("Not run yet")} text={uiLabel("Detects missing or inconsistent intake items. It never fills in values.")} />
      ) : (
        <div className="space-y-2" data-testid="intake-agent-output">
          {(out.missing_items as Row[]).length === 0 ? <p className="text-green-700"><StaffLabel en="No missing intake items detected."/></p> : (
            <ul className="list-disc pl-5">
              {(out.missing_items as Row[]).map((m) => <li key={m.code} className={m.severity === "required" ? "" : "text-slate-500"}>{m.label}{m.severity === "recommended" ? " (recommended)" : ""}</li>)}
            </ul>
          )}
          <p><strong><StaffLabel en="Recommended action:"/></strong> {out.recommended_action}</p>
          {out.message_draft && <pre className="whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans text-xs">{out.message_draft}</pre>}
          <p className="text-xs text-slate-500"><StaffLabel en="Findings: deterministic rules. Draft wording:"/>{" "}{llm?.status === "succeeded" ? `model ${llm.model}` : llm?.status === "not_configured" ? "template (agent model NOT_CONFIGURED)" : llm?.status === "schema_invalid" ? "template (model output failed validation)" : llm?.status === "failed" ? "template (model call failed)" : uiLabel("template")}.
            {run?.created_at && !latest && ` Last run ${dateTime(run.created_at)}.`}
          </p>
        </div>
      )}
    </Card>
  );
}

export function buildMessage(c: Row) {
  const first = String(c.full_name).split(" ")[0];
  return [
    `Hello ${first},`,
    ``,
    `This is ${OFFICE.company} — ${OFFICE.product}, about your employment request ${c.ref}.`,
    `Current status: ${STATUS_LABELS[c.current_status as Status] ?? c.current_status}.`,
    `Next step: ${c.next_step}`,
    ``,
    `Questions? Call ${OFFICE.phone}, WhatsApp ${OFFICE.whatsapp}, or email ${OFFICE.email}.`,
  ].join("\n");
}

export function Messages({ c, notifications, onContacted }: { c: Row; notifications: Row[]; onContacted: () => void }) {
  const uiLabel = useStaffLabel();
  const { isManager } = useStaff();
  const toast = useToast();
  const send = useRowAction(null);
  const text = buildMessage(c);
  return (
    <Card title={uiLabel("Communication")} id="message">
      <pre className="whitespace-pre-wrap rounded bg-slate-50 p-3 font-sans text-sm" data-testid="message-text">{text}</pre>
      <div className="mt-2 flex flex-wrap gap-2">
        <SmallBtn onClick={async () => {
          try { await navigator.clipboard.writeText(text); toast("success", "Message copied"); } catch { toast("error", "Copy failed — select the text and copy it manually"); }
        }}><StaffLabel en="Copy Message"/></SmallBtn>
        <SmallBtn onClick={onContacted}><StaffLabel en="Mark Contacted"/></SmallBtn>
        {isManager && c.communication_consent && (
          <>
            <SmallBtn disabled={send.pending} onClick={async () => {
              const r = await send.run({ action: "send_notification", client_id: c.id, channel: "sms", message: text }, null);
              if (r) toast(r.status === "sent" ? "success" : "warning", r.status === "sent" ? "SMS sent (provider confirmed)" : `SMS ${String(r.status).toUpperCase()}`);
            }}><StaffLabel en="Send SMS"/></SmallBtn>
            {c.email && (
              <SmallBtn disabled={send.pending} onClick={async () => {
                const r = await send.run({ action: "send_notification", client_id: c.id, channel: "email", message: text }, null);
                if (r) toast(r.status === "sent" ? "success" : "warning", r.status === "sent" ? "Email sent (provider confirmed)" : `Email ${String(r.status).toUpperCase()}`);
              }}><StaffLabel en="Send Email"/></SmallBtn>
            )}
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-500"><StaffLabel en="A message counts as sent only when the provider confirms it. Otherwise it is recorded as NOT_CONFIGURED or failed."/></p>
      {notifications.length > 0 && (
        <table className="table mt-3" data-testid="notification-log">
          <thead><tr><th>When</th><th><StaffLabel en="Channel"/></th><th><StaffLabel en="Template"/></th><th>Status</th></tr></thead>
          <tbody>
            {notifications.map((n, i) => (
              <tr key={i}><td className="whitespace-nowrap">{dateTime(n.created_at)}</td><td>{n.channel}</td><td>{n.template}</td>
                <td data-testid="notification-status">{n.status === "not_configured" ? "NOT_CONFIGURED" : n.status}{n.error ? ` · ${n.error}` : ""}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function Alerts({ alerts }: { alerts: Row[] }) {
  const uiLabel = useStaffLabel();
  const a = useRowAction("Alert updated");
  const [ignoring, setIgnoring] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (!alerts.length) return null;
  return (
    <section className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm" data-testid="client-alerts">
      {alerts.map((al) => (
        <div key={al.id} className="flex flex-wrap items-start gap-2">
          <span className="rounded bg-red-600 px-1.5 text-xs uppercase text-white">{al.severity}</span>
          <div className="flex-1">
            <p className="font-medium">{al.explanation}</p>
            <p className="text-xs text-red-900"><StaffLabel en="Recommended:"/>{" "}{al.recommended_action}</p>
          </div>
          <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "resolve_alert", alert_id: al.id, note: "Resolved from client file" })}><StaffLabel en="Resolve"/></SmallBtn>
          <SmallBtn onClick={() => { setIgnoring(al.id); setReason(""); }}><StaffLabel en="Ignore"/></SmallBtn>
          {ignoring === al.id && (
            <form className="flex w-full gap-1" onSubmit={async (e) => { e.preventDefault(); if (await a.go({ action: "ignore_alert", alert_id: al.id, reason })) setIgnoring(null); }}>
              <input aria-label={uiLabel("Ignore reason")} required className="input py-1 text-xs" placeholder={uiLabel("Reason (required)")} value={reason} onChange={(e) => setReason(e.target.value)} />
              <SmallBtn type="submit"><StaffLabel en="Save"/></SmallBtn>
            </form>
          )}
        </div>
      ))}
    </section>
  );
}

const ACTION_LABELS: Record<string, string> = {
  client_created: "Client created", client_updated: "Client updated", client_deleted: "Client deleted",
  preference_added: "Preference added", preference_removed: "Preference removed", status_changed: "Status changed",
  status_overridden: "Status overridden (admin)", next_step_changed: "Next step changed", staff_assigned: "Staff assigned",
  document_uploaded: "Document uploaded", document_processing_started: "Document processing started", document_processed: "Document processed",
  document_verified: "Document verified", document_rejected: "Document rejected", document_reupload_requested: "Re-upload requested",
  document_opened: "Document opened", appointment_created: "Appointment created", appointment_updated: "Appointment updated",
  appointment_rescheduled: "Appointment rescheduled", appointment_completed: "Appointment completed", note_added: "Note added",
  task_added: "Task added", task_updated: "Task updated", task_completed: "Task completed", contact_logged: "Contact logged",
  followup_created: "Follow-up created", followup_completed: "Follow-up completed", assessment_updated: "Assessment updated",
  post_hire_updated: "Post-hire updated", agent_alert_created: "Audit alert raised", agent_run: "Agent run",
  notification_queued: "Notification queued", notification_sent: "Notification sent", notification_failed: "Notification failed",
  notification_not_configured: "Notification NOT_CONFIGURED", status_otp_requested: "Status code requested", status_otp_verified: "Status code verified",
};

function summarize(v: unknown) {
  if (!v || typeof v !== "object") return null;
  const e = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && x !== undefined && typeof x !== "object");
  return e.length ? e.map(([k, x]) => `${k.replace(/_/g, " ")}: ${k === "status" ? STATUS_LABELS[x as Status] ?? x : x}`).join(" · ") : null;
}

export function Activity({ activity }: { activity: Row[] }) {
  const uiLabel = useStaffLabel();
  return (
    <Card title={uiLabel("Activity Log")} id="activity">
      {activity.length === 0 ? <EmptyState title={uiLabel("No activity")} text={uiLabel("Every change to this file is recorded here.")} /> : (
        <ol className="relative space-y-3 border-l border-slate-200 pl-4">
          {activity.map((l) => {
            const before = summarize(l.old_value);
            const after = summarize(l.new_value);
            return (
              <li key={l.id} data-testid="activity-row" data-action={l.action}>
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-500" aria-hidden="true" />
                <p className="font-medium">{ACTION_LABELS[l.action] ?? l.action}</p>
                {before && <p className="text-xs text-slate-500"><StaffLabel en="Before —"/>{" "}{before}</p>}
                {after && <p className="text-xs text-slate-600">{before ? "After — " : ""}{after}</p>}
                <p className="text-xs text-slate-400">{l.staff_name ?? "System / applicant"} · {dateTime(l.created_at)}</p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
