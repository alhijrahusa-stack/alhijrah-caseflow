"use client";

import { useState } from "react";
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

export function AppointmentRowActions({ appt }: { appt: Row }) {
  const { isManager } = useStaff();
  const a = useRowAction("Appointment updated");
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(toLocalInput(appt.scheduled_at));
  const [location, setLocation] = useState(appt.location ?? "");
  const [notes, setNotes] = useState(appt.notes ?? "");
  if (!isManager) return null;
  const set = (status: string) => a.go({ action: "update_appointment", appointment_id: appt.id, status });
  const closed = ["cancelled", "attended", "missed"].includes(appt.status);
  return (
    <div className="space-x-1 whitespace-nowrap">
      {!closed && appt.status !== "confirmed" && <SmallBtn disabled={a.pending} onClick={() => set("confirmed")}>Confirm</SmallBtn>}
      {!closed && <SmallBtn disabled={a.pending} onClick={() => set("attended")}>Attended</SmallBtn>}
      {!closed && <SmallBtn disabled={a.pending} onClick={() => set("missed")}>Missed</SmallBtn>}
      {!closed && <SmallBtn disabled={a.pending} onClick={() => set("cancelled")}>Cancel</SmallBtn>}
      <SmallBtn onClick={() => setEditing(!editing)}>{closed ? "Edit" : "Edit / Reschedule"}</SmallBtn>
      {editing && (
        <form className="mt-2 grid max-w-md gap-2 whitespace-normal rounded-md bg-slate-50 p-2" onSubmit={async (e) => {
          e.preventDefault();
          const ok = await a.go({ action: "update_appointment", appointment_id: appt.id, scheduled_at: fromLocalInput(when).toISOString(), location: location || null, notes: notes || null });
          if (ok) setEditing(false);
        }}>
          <QuickDateTime ariaLabel="New date and time" value={when} onChange={setWhen} required />
          <input aria-label="Location" className="input py-1" placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
          <input aria-label="Notes" className="input py-1" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <SmallBtn type="submit" disabled={a.pending}>Save changes</SmallBtn>
        </form>
      )}
      {a.error && <p role="alert" className="whitespace-normal text-xs text-red-600">{a.error}</p>}
    </div>
  );
}

export function Appointments({ appts, onAdd }: { appts: Row[]; onAdd: (() => void) | null }) {
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
                  <td><AppointmentRowActions appt={x} /></td>
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
          })}>{a.pending ? "Saving…" : "Save changes"}</button>
        )}
      </div>
    </article>
  );
}

export function PostHire({ clientId, items, startDate, embedded = false }
