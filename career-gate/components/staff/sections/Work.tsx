"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHydrated } from "@/components/staff/useHydrated";
import { QuickDate, QuickDateTime } from "@/components/staff/QuickDate";
import { useStaff } from "@/components/staff/StaffContext";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  CONTACT_LABELS,
  POST_HIRE_ITEMS,
  POST_HIRE_LABELS,
  POST_HIRE_STATUS_LABELS,
  POST_HIRE_STATUSES,
} from "@/lib/domain";
import { dateOnly, dateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { Card, SmallBtn, useRowAction, type Row } from "./common";


export type RescheduleValues = { when: string; location: string; notes: string };

export function RescheduleModal({ appt, pending, error, onClose, onSave }: {
  appt: Row;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: RescheduleValues) => Promise<void>;
}) {
  const mounted = useHydrated();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [when, setWhen] = useState(() => toLocalInput(appt.scheduled_at));
  const [location, setLocation] = useState<string>(appt.location ?? "");
  const [notes, setNotes] = useState<string>(appt.notes ?? "");

  useEffect(() => {
    if (!mounted) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <dialog
      ref={dialogRef}
      data-testid="reschedule-modal"
      aria-label="Reschedule appointment"
      onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}
      className="fixed inset-0 m-auto max-h-[90vh] w-[min(90vw,36rem)] overflow-y-auto rounded-2xl border border-white/20 bg-slate-900 p-5 text-slate-100 shadow-2xl backdrop:bg-slate-950/80"
    >
      <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void onSave({ when, location, notes }); }}>
        <h2 className="text-lg font-semibold">Reschedule appointment</h2>
        <QuickDateTime ariaLabel="New date and time" testId="input-new-date-time" autoFocus value={when} onChange={setWhen} required />
        <input aria-label="Location" className="input" placeholder="Location" value={location} onChange={(event) => setLocation(event.target.value)} />
        <input aria-label="Notes" className="input" placeholder="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <SmallBtn aria-label="Cancel reschedule" disabled={pending} onClick={onClose}>Cancel</SmallBtn>
          <SmallBtn type="submit" aria-label="Save changes" data-testid="button-confirm-reschedule" disabled={pending}>
            {pending ? "Saving..." : "Save changes"}
          </SmallBtn>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

export function AppointmentRowActions({ appt, onReschedule, rescheduling }: {
  appt: Row;
  onReschedule: (appointmentId: string) => void;
  rescheduling: boolean;
}) {
  const { isManager } = useStaff();
  const a = useRowAction("Appointment decision saved");
  const isMounted = useHydrated();
  const [cancelling, setCancelling] = useState(false);
  const [decisionNote, setDecisionNote] = useState("");
  if (!isManager) return null;
  const closed = ["cancelled", "attended", "missed"].includes(appt.status);
  const interview = appt.appointment_kind === "employment_interview";
  const pendingInterviewDecision = interview && appt.status === "attended" && !appt.outcome;
  const decide = (decision: "pass" | "fail" | "missed" | "cancelled_interested" | "cancelled_not_interested") =>
    a.go({ action: "appointment_decision", appointment_id: appt.id, decision, note: decisionNote || null });
  return (
    <div className="space-y-3 whitespace-normal">
      {appt.outcome && <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Decision recorded: {String(appt.outcome).replaceAll("_", " ")}</p>}
      {pendingInterviewDecision && <>
        <p role="status" className="text-xs font-semibold text-amber-200">Attendance recorded · Interview decision pending</p>
        <div className="flex flex-wrap gap-2">
          <SmallBtn disabled={a.pending} onClick={() => decide("pass")}>Pass / نجح</SmallBtn>
          <SmallBtn disabled={a.pending} onClick={() => decide("fail")}>Fail / رسب</SmallBtn>
        </div>
        <input className="input w-full" aria-label="Interview decision note" placeholder="Decision evidence or note" value={decisionNote} maxLength={1000} onChange={(e) => setDecisionNote(e.target.value)} />
      </>}
      {!closed && <>
        <div className="flex flex-wrap gap-2">
          {appt.status !== "confirmed" && <SmallBtn aria-label="Confirm" disabled={a.pending} onClick={() => a.go({ action: "update_appointment", appointment_id: appt.id, status: "confirmed" })}>Confirm booking</SmallBtn>}
          {interview ? <>
            <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "record_appointment_attendance", appointment_id: appt.id })}>Mark attended / تسجيل الحضور</SmallBtn>
            <SmallBtn disabled={a.pending} onClick={() => decide("missed")}>Missed / تخلف</SmallBtn>
          </> : <>
            <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "update_appointment", appointment_id: appt.id, status: "attended" })}>Attended / حضر</SmallBtn>
            <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "update_appointment", appointment_id: appt.id, status: "missed" })}>Missed / تخلف</SmallBtn>
          </>}
          <SmallBtn aria-label="Edit / Reschedule" aria-expanded={rescheduling} disabled={!isMounted || a.pending} onClick={() => onReschedule(String(appt.id))}>Reschedule / إعادة جدولة</SmallBtn>
          {interview
            ? <SmallBtn disabled={a.pending} onClick={() => setCancelling((v) => !v)}>Canceled / إلغاء</SmallBtn>
            : <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "update_appointment", appointment_id: appt.id, status: "cancelled" })}>Cancel / إلغاء</SmallBtn>}
        </div>
        {interview && <input className="input w-full" aria-label="Interview decision note" placeholder="Decision evidence or note" value={decisionNote} maxLength={1000} onChange={(e) => setDecisionNote(e.target.value)} />}
        {cancelling && <div className="flex flex-wrap gap-2 rounded-xl border border-amber-300/20 bg-white/5 p-3">
          <SmallBtn disabled={a.pending} onClick={() => decide("cancelled_interested")}>Interested — return to Job Ready</SmallBtn>
          <SmallBtn disabled={a.pending} onClick={() => decide("cancelled_not_interested")}>Not interested — close file</SmallBtn>
        </div>}
      </>}
      {a.pending && <p role="status" className="text-xs text-amber-200">Saving to Career Gate...</p>}
      {a.error && <p role="alert" className="text-xs text-red-300">{a.error}</p>}
    </div>
  );
}

export function Appointments({ appts, onAdd, onReschedule, reschedulingId }: {
  appts: Row[];
  onAdd: (() => void) | null;
  onReschedule: (appointmentId: string) => void;
  reschedulingId: string | null;
}) {
  return (
    <Card title="Appointments" id="appointments" actions={onAdd && <SmallBtn onClick={onAdd}>+ Add appointment</SmallBtn>}>
      {appts.length === 0 ? (
        <EmptyState title="No appointments" text="Book from the office calendar's next free slots." action={onAdd ? <SmallBtn onClick={onAdd}>+ Add appointment</SmallBtn> : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>When</th><th>Type</th><th>With</th><th>Location</th><th>Status</th><th /></tr></thead>
            <tbody>
              {appts.map((x) => (
                <tr id={`appointment-${String(x.id)}`} key={x.id} data-testid="appointment-row" className="scroll-mt-28">
                  <td className="whitespace-nowrap">{dateTime(x.scheduled_at)}<span className="block text-xs text-slate-500">until {dateTime(x.ends_at).split(", ").pop()} · {x.timezone}</span></td>
                  <td>{x.appointment_type}{x.notes && <span className="block text-xs text-slate-500">{x.notes}</span>}</td>
                  <td>{x.resource_key === "office" ? "Office" : "Staff member"}</td>
                  <td>{x.location ?? "—"}</td>
                  <td data-testid="appointment-status">{x.status}</td>
                  <td><AppointmentRowActions appt={x} onReschedule={onReschedule} rescheduling={reschedulingId === String(x.id)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">Source of truth: Career Gate internal calendar. No external calendar is connected.</p>
    </Card>
  );
}

export function Notes({ notes, onAdd }: { notes: Row[]; onAdd: () => void }) {
  return (
    <Card title="Notes" id="notes" actions={<SmallBtn onClick={onAdd}>+ Add note</SmallBtn>}>
      {notes.length === 0 ? (
        <EmptyState title="No notes yet" text="Add the first note for this client." action={<SmallBtn onClick={onAdd}>+ Add note</SmallBtn>} />
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} data-testid="note-row">
              <p className="whitespace-pre-wrap">{n.note}</p>
              <p className="text-xs text-slate-500">{n.staff_name} · {dateTime(n.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function TaskRowActions({ task }: { task: Row }) {
  const a = useRowAction("Task updated");
  const open = task.status === "pending" || task.status === "in_progress";
  return (
    <div className="space-x-1 whitespace-nowrap">
      {task.status === "pending" && <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "update_task", task_id: task.id, status: "in_progress" })}>Start</SmallBtn>}
      {open && <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "complete_task", task_id: task.id })}>Complete</SmallBtn>}
      {open && <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "update_task", task_id: task.id, status: "cancelled" })}>Cancel</SmallBtn>}
      {!open && <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "update_task", task_id: task.id, status: "pending" })}>Reopen</SmallBtn>}
      {a.error && <p role="alert" className="whitespace-normal text-xs text-red-600">{a.error}</p>}
    </div>
  );
}

export function Tasks({ tasks, onAdd }: { tasks: Row[]; onAdd: () => void }) {
  return (
    <Card title="Tasks" id="tasks" actions={<SmallBtn onClick={onAdd}>+ Add task</SmallBtn>}>
      {tasks.length === 0 ? (
        <EmptyState title="No tasks" text="Track the next piece of work for this client." action={<SmallBtn onClick={onAdd}>+ Add task</SmallBtn>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Task</th><th>Assigned</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr id={`task-${String(t.id)}`} key={t.id} data-testid="task-row" className="scroll-mt-28">
                  <td>{t.title}{t.description && <span className="block text-xs text-slate-500">{t.description}</span>}</td>
                  <td>{t.assigned_to_name ?? "—"}</td>
                  <td className="whitespace-nowrap">{dateTime(t.due_at)}</td>
                  <td data-testid="task-status">{t.status.replace("_", " ")}{t.completed_at && <span className="block text-xs text-slate-500">{t.completed_by_name} · {dateTime(t.completed_at)}</span>}</td>
                  <td><TaskRowActions task={t} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function Contacts({ contacts, onAdd }: { contacts: Row[]; onAdd: () => void }) {
  return (
    <Card title="Contact History" id="contacts" actions={<SmallBtn onClick={onAdd}>Mark contacted</SmallBtn>}>
      {contacts.length === 0 ? (
        <EmptyState title="No contacts logged" text="Record each call, message or visit after it happens." action={<SmallBtn onClick={onAdd}>Mark contacted</SmallBtn>} />
      ) : (
        <ul className="space-y-3">
          {contacts.map((k) => (
            <li key={k.id} data-testid="contact-row">
              <p><span className="font-medium">{CONTACT_LABELS[k.method as keyof typeof CONTACT_LABELS]}</span> — {k.result}</p>
              {k.next_action && <p className="text-slate-600">Next: {k.next_action}</p>}
              <p className="text-xs text-slate-500">{k.staff_name} · {dateTime(k.created_at)}{k.followup_date ? ` · follow up ${dateOnly(k.followup_date)}` : ""}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function FollowupRowActions({ f }: { f: Row }) {
  const a = useRowAction("Follow-up completed");
  const [note, setNote] = useState("");
  if (f.status !== "open") return null;
  return (
    <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); a.go({ action: "complete_followup", followup_id: f.id, completion_note: note || null }); }}>
      <input aria-label="Completion note" className="input py-1 text-xs" placeholder="Outcome (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <SmallBtn type="submit" disabled={a.pending}>Complete</SmallBtn>
    </form>
  );
}

export function Followups({ followups, onAdd }: { followups: Row[]; onAdd: () => void }) {
  return (
    <Card title="Follow-Ups" id="followups" actions={<SmallBtn onClick={onAdd}>+ Add follow-up</SmallBtn>}>
      {followups.length === 0 ? (
        <EmptyState title="No follow-ups" text="Schedule the next check-in with this client." action={<SmallBtn onClick={onAdd}>+ Add follow-up</SmallBtn>} />
      ) : (
        <table className="table">
          <thead><tr><th>Due</th><th>Reason</th><th>Status</th><th /></tr></thead>
          <tbody>
            {followups.map((f) => (
              <tr id={`followup-${String(f.id)}`} key={f.id} data-testid="followup-row" className="scroll-mt-28">
                <td className="whitespace-nowrap">{dateOnly(f.due_date)}</td>
                <td>{f.reason}{f.completion_note && <span className="block text-xs text-slate-500">{f.completion_note}</span>}</td>
                <td data-testid="followup-status">{f.status}{f.completed_at && <span className="block text-xs text-slate-500">{f.completed_by_name} · {dateTime(f.completed_at)}</span>}</td>
                <td><FollowupRowActions f={f} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function PostHireRow({ clientId, item, row, startDate, canEdit }: { clientId: string; item: (typeof POST_HIRE_ITEMS)[number]; row?: Row; startDate: string | null; canEdit: boolean }) {
  const a = useRowAction(`${POST_HIRE_LABELS[item]} saved`);
  const [status, setStatus] = useState(row?.status ?? "not_started");
  const [note, setNote] = useState(row?.note ?? "");
  const [date, setDate] = useState(startDate ?? "");
  const dirty = status !== (row?.status ?? "not_started") || note !== (row?.note ?? "") || (item === "start_date" && date !== (startDate ?? ""));
  const complete = status === "completed";
  return (
    <article className="cg-workflow-pod" data-state={status} data-testid={`post-hire-${item}`}>
      <div className="cg-workflow-pod-head">
        <div className="min-w-0">
          <p className="cg-workflow-pod-kicker">{complete ? "COMPLETE" : status === "not_started" ? "NOT STARTED" : "IN PROGRESS"}</p>
          <h3 className="cg-workflow-pod-title">{POST_HIRE_LABELS[item]}</h3>
        </div>
        <select aria-label={`${POST_HIRE_LABELS[item]} status`} className="cg-workflow-status" value={status} disabled={!canEdit} onChange={(e) => setStatus(e.target.value)}>
          {POST_HIRE_STATUSES.map((s) => <option key={s} value={s}>{POST_HIRE_STATUS_LABELS[s]}</option>)}
        </select>
      </div>
      <div className="cg-workflow-pod-body">
        {item === "start_date" && <QuickDate ariaLabel="Start date" value={date} onChange={setDate} disabled={!canEdit} />}
        <input aria-label={`${POST_HIRE_LABELS[item]} note`} className="cg-workflow-note" placeholder="What is confirmed, by whom" value={note} disabled={!canEdit} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="cg-workflow-pod-foot">
        <span>{row ? `${row.staff_name ?? "—"} · ${dateTime(row.updated_at)}` : "No update recorded"}</span>
        {canEdit && dirty && (
          <button className="cg-workflow-save" type="button" disabled={a.pending} onClick={() => a.go({
            action: "update_post_hire", client_id: clientId, item, status, note: note || null,
            ...(item === "start_date" ? { start_date: date || null } : {}),
          })}>{a.pending ? "Saving…" : "Save"}</button>
        )}
      </div>
    </article>
  );
}

export function PostHire({ clientId, items, startDate, embedded = false }: { clientId: string; items: Row[]; startDate: string | null; embedded?: boolean }) {
  const { isManager } = useStaff();
  const byItem = new Map(items.map((r) => [r.item, r]));
  const completed = POST_HIRE_ITEMS.filter((item) => byItem.get(item)?.status === "completed").length;
  const percent = POST_HIRE_ITEMS.length ? Math.round((completed / POST_HIRE_ITEMS.length) * 100) : 0;
  const content = (
    <div className="cg-workflow-matrix">
      <div className="cg-workflow-telemetry">
        <div>
          <p className="cg-workflow-kicker">EXECUTIVE WORKFLOW MATRIX</p>
          <p className="mt-1 text-xs text-slate-400">Record only verified confirmations. Nothing is inferred.</p>
        </div>
        <div className="cg-workflow-progress">
          <div className="cg-workflow-progress-copy"><strong>{percent}%</strong><span>{completed}/{POST_HIRE_ITEMS.length} complete</span></div>
          <div className="cg-workflow-progress-track" aria-label={`${percent}% complete`}><span style={{ width: `${percent}%` }} /></div>
        </div>
      </div>
      <div className="cg-workflow-pods">
        {POST_HIRE_ITEMS.map((item) => (
          <PostHireRow key={`${item}-${byItem.get(item)?.updated_at ?? ""}-${startDate ?? ""}`} clientId={clientId} item={item} row={byItem.get(item)} startDate={startDate} canEdit={isManager} />
        ))}
      </div>
    </div>
  );
  if (embedded) return <div id="post-hire">{content}</div>;
  return <Card title="Post-Hire Tasks" id="post-hire">{content}</Card>;
}
