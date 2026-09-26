"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useState } from "react";
import { useAction } from "@/components/forms/useAction";
import { shiftLabel } from "@/components/forms/PreferenceSteps";
import {
  AddNoteForm,
  AppointmentForm,
  ContactedForm,
  DocumentForm,
  FollowupForm,
  NextStepForm,
  type Panel,
  StatusForm,
  TaskForm,
} from "@/components/staff/ClientActions";
import { MessagePreview } from "@/components/staff/MessagePreview";
import { useHandledBy, useStaff } from "@/components/staff/StaffContext";
import { StatusBadge } from "@/components/staff/StatusBadge";
import { Button } from "@/components/ui/Button";
import { options } from "@/lib/catalog";
import {
  CONTACT_LABELS,
  DOC_LABELS,
  LANGUAGES,
  POST_HIRE_ITEMS,
  POST_HIRE_LABELS,
  POST_HIRE_STATUS_LABELS,
  POST_HIRE_STATUSES,
  STATUS_LABELS,
  type Status,
} from "@/lib/domain";
import { dateOnly, dateTime, formatPhone, fromLocalInput, toLocalInput } from "@/lib/format";

type Row = Record<string, any>;
export type ClientFileData = {
  client: Row;
  employment: Row[];
  preferences: Row[];
  documents: Row[];
  appointments: Row[];
  notes: Row[];
  tasks: Row[];
  contacts: Row[];
  followups: Row[];
  postHire: Row[];
  activity: Row[];
  authorization: Row | null;
};

function Card({ title, id, actions, children }: { title: string; id: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-lg border border-slate-200 bg-white" data-testid={`section-${id}`}>
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </header>
      <div className="p-4 text-sm">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-slate-500">{children}</p>;
}

function Dl({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

const yn = (v: boolean | null) => (v === true ? "Yes" : v === false ? "No" : "Not answered");

function SmallBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-50 ${props.className ?? ""}`} />;
}

/** Runs a row-level action with the current Handled By. */
function useRowAction() {
  const a = useAction();
  const { handledBy, missing } = useHandledBy();
  const go = (payload: Record<string, unknown>) => (missing ? a.setError(missing) : a.run({ ...payload, handled_by: handledBy }));
  return { ...a, go, handledBy, missing };
}

export function ClientFile({ data, statusUrl, uploadFailed }: { data: ClientFileData; statusUrl: string; uploadFailed?: string }) {
  const { client: c } = data;
  const [panel, setPanel] = useState<Panel | null>(null);
  const close = () => setPanel(null);
  const quick: [Panel, string][] = [
    ["document", "Add Document"], ["appointment", "Add Appointment"], ["note", "Add Note"], ["task", "Add Task"],
    ["contacted", "Mark Contacted"], ["status", "Change Status"], ["next_step", "Set Next Step"], ["followup", "Add Follow-up"],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold" data-testid="client-name">{c.full_name}</h1>
        <span className="font-mono text-sm text-slate-500" data-testid="client-ref">{c.ref}</span>
        <StatusBadge status={c.current_status} />
        <span className="text-xs text-slate-400">{c.source === "public" ? "Online application" : "Office-created"}</span>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="quick-actions">
        <Link href={`/staff/client/${c.id}/edit`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">Edit Client</Link>
        {quick.map(([p, label]) => (
          <button key={p} type="button" onClick={() => setPanel(panel === p ? null : p)}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors duration-200 ${panel === p ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 bg-white hover:bg-slate-50"}`}>
            {label}
          </button>
        ))}
        <a href={statusUrl} target="_blank" rel="noopener" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50" data-testid="open-status-page">
          Open Status Page
        </a>
      </div>

      {uploadFailed && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Client created, but some documents did not upload: {uploadFailed}
        </p>
      )}

      {panel === "document" && <DocumentForm clientId={c.id} onDone={close} />}
      {panel === "appointment" && <AppointmentForm clientId={c.id} onDone={close} />}
      {panel === "note" && <AddNoteForm clientId={c.id} onDone={close} />}
      {panel === "task" && <TaskForm clientId={c.id} onDone={close} />}
      {panel === "contacted" && <ContactedForm clientId={c.id} onDone={close} />}
      {panel === "status" && <StatusForm clientId={c.id} current={c.current_status} nextStep={c.next_step} onDone={close} />}
      {panel === "next_step" && <NextStepForm clientId={c.id} nextStep={c.next_step} onDone={close} />}
      {panel === "followup" && <FollowupForm clientId={c.id} onDone={close} />}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <StatusCard c={c} />
          <PreferencesCard clientId={c.id} prefs={data.preferences} />
          <DocumentsCard docs={data.documents} />
          <AppointmentsCard appts={data.appointments} />
          <TasksCard tasks={data.tasks} />
          <FollowupsCard followups={data.followups} />
          <PostHireCard clientId={c.id} items={data.postHire} startDate={c.start_date} />
        </div>
        <div className="space-y-4">
          <Card title="Client Information" id="client-info">
            <Dl rows={[
              ["Phone", formatPhone(c.phone)],
              ["Email", c.email],
              ["Date of birth", dateOnly(c.date_of_birth)],
              ["Language", LANGUAGES[c.preferred_language as keyof typeof LANGUAGES] ?? c.preferred_language],
              ["Address", [c.street, c.city, c.state, c.zip].filter(Boolean).join(", ") || "—"],
              ["Availability", c.appointment_availability],
              ["Contact consent", c.communication_consent ? "Yes" : "No"],
              ["Created", dateTime(c.created_at)],
              ["Last updated", dateTime(c.updated_at)],
            ]} />
            {data.authorization && (
              <p className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-600" data-testid="authorization-record">
                Authorization v{data.authorization.authorization_version} signed by “{data.authorization.signature}”
                (printed: {data.authorization.printed_name}) at {dateTime(data.authorization.signed_at)}.
              </p>
            )}
          </Card>
          <Card title="Amazon History" id="amazon-history">
            <Dl rows={[
              ["Worked at Amazon", yn(c.amazon_worked_before)],
              ...(c.amazon_worked_before ? [["Dates", `${dateOnly(c.amazon_worked_from)} – ${dateOnly(c.amazon_worked_to)}`] as [string, string]] : []),
              ["Applied before", yn(c.amazon_applied_before)],
              ...(c.amazon_applied_before ? [["Amazon email", c.amazon_application_email ?? "—"] as [string, string]] : []),
            ]} />
          </Card>
          <Card title="Employment History" id="employment-history">
            {data.employment.length ? (
              <ul className="space-y-2">
                {data.employment.map((e) => (
                  <li key={e.id}>
                    <p className="font-medium">{e.job_title} — {e.company}</p>
                    <p className="text-slate-500">{dateOnly(e.from_date)} – {e.to_date ? dateOnly(e.to_date) : "Present"}</p>
                  </li>
                ))}
              </ul>
            ) : <Empty>None recorded.</Empty>}
          </Card>
          <MessagePreview client={c} />
          <NotesCard notes={data.notes} />
          <ContactsCard contacts={data.contacts} />
          <ActivityCard activity={data.activity} />
        </div>
      </div>
    </div>
  );
}

function StatusCard({ c }: { c: Row }) {
  const { staff } = useStaff();
  const a = useRowAction();
  return (
    <Card title="Current Status & Next Step" id="status">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Current Status</p>
          <p className="mt-1 font-semibold" data-testid="current-status">{STATUS_LABELS[c.current_status as Status]}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Next Step</p>
          <p className="mt-1" data-testid="next-step">{c.next_step}</p>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-slate-500" htmlFor="assign_staff">Assigned staff</label>
          <select id="assign_staff" className="input mt-1" value={c.handled_by ?? ""} disabled={a.pending}
            onChange={(e) => a.go({ action: "assign_staff", client_id: c.id, staff_id: e.target.value || null })}>
            <option value="">Unassigned</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      {a.error && <p role="alert" className="mt-2 text-red-600">{a.error}</p>}
    </Card>
  );
}

export function PreferencesCard({ clientId, prefs }: { clientId: string; prefs: Row[] }) {
  const a = useRowAction();
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [rank, setRank] = useState<"primary" | "backup">("primary");
  const taken = new Set(prefs.map((p) => `${p.site_code}|${p.job_id}|${p.shift_code}`));
  const groups: ["primary" | "backup", Row[]][] = [["primary", prefs.filter((p) => p.rank === "primary")], ["backup", prefs.filter((p) => p.rank === "backup")]];

  return (
    <Card title="Job Preferences" id="preferences"
      actions={options.length > 0 && <SmallBtn onClick={() => setAdding(!adding)}>+ Add preference</SmallBtn>}>
      {adding && (
        <form className="mb-4 flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-3" onSubmit={async (e) => {
          e.preventDefault();
          const [site_code, job_id, shift_code] = key.split("|");
          if (!key) return a.setError("Choose an option");
          if (await a.go({ action: "add_preference", client_id: clientId, rank, selection: { site_code, job_id, shift_code } })) { setAdding(false); setKey(""); }
        }}>
          <select aria-label="Rank" className="input w-32" value={rank} onChange={(e) => setRank(e.target.value as typeof rank)}>
            <option value="primary">Primary</option><option value="backup">Backup</option>
          </select>
          <select aria-label="Catalog option" className="input min-w-[18rem] flex-1" value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">Select site · job · shift…</option>
            {options.filter((o) => !taken.has(o.key)).map((o) => (
              <option key={o.key} value={o.key}>{o.city} · {o.site_name} · {o.job_title} · {shiftLabel(o)}{o.pay ? ` · ${o.pay}` : ""}</option>
            ))}
          </select>
          <Button type="submit" disabled={a.pending}>Add</Button>
        </form>
      )}
      {prefs.length === 0 ? <Empty>No preferences recorded.</Empty> : (
        <div className="space-y-4">
          {groups.map(([rk, rows]) => rows.length > 0 && (
            <div key={rk}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{rk === "primary" ? "Primary" : "Backup"}</p>
              <table className="table">
                <thead><tr><th>#</th><th>City</th><th>Site</th><th>Job</th><th>Shift</th><th>Days</th><th>Hours</th><th>Pay snapshot</th><th /></tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} data-testid="preference-row">
                      <td className="font-semibold">{p.preference_order}</td>
                      <td>{p.city}</td>
                      <td>{p.site_name} <span className="text-slate-400">({p.site_code})</span></td>
                      <td>{p.job_title}{p.employment_type ? <span className="block text-xs text-slate-500">{p.employment_type}</span> : null}</td>
                      <td>{p.shift_code}</td>
                      <td>{p.days ?? "—"}</td>
                      <td>{p.hours ?? "—"}</td>
                      <td className="font-medium" data-testid="pay-snapshot">{p.pay_snapshot ?? "Not listed"}</td>
                      <td><SmallBtn disabled={a.pending} onClick={() => a.go({ action: "remove_preference", client_id: clientId, preference_id: p.id })}>Remove</SmallBtn></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      {a.error && <p role="alert" className="mt-2 text-red-600">{a.error}</p>}
    </Card>
  );
}

function DocumentsCard({ docs }: { docs: Row[] }) {
  const a = useRowAction();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  async function open(id: string) {
    if (a.missing) return a.setError(a.missing);
    setOpening(id);
    a.setError(null);
    // Open synchronously so pop-up blockers allow it, then point it at the signed URL.
    const win = window.open("", "_blank");
    const res = await fetch(`/api/documents/${id}?handled_by=${a.handledBy}`);
    const data = await res.json().catch(() => null);
    setOpening(null);
    if (!data?.ok) {
      win?.close();
      return a.setError(data?.error?.message ?? `Could not open document (${res.status})`);
    }
    if (win) win.location.href = data.url;
    else window.location.href = data.url;
  }

  return (
    <Card title="Documents" id="documents">
      {docs.length === 0 ? <Empty>No documents uploaded.</Empty> : (
        <table className="table">
          <thead><tr><th>Type</th><th>File</th><th>Uploaded</th><th>Status</th><th>Reviewed</th><th /></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} data-testid="document-row">
                <td>{DOC_LABELS[d.doc_type as keyof typeof DOC_LABELS] ?? d.doc_type}</td>
                <td className="max-w-[14rem] truncate" title={d.file_name}>{d.file_name}<span className="block text-xs text-slate-400">{Math.ceil(d.size_bytes / 1024)} KB · opened {d.open_count}×</span></td>
                <td className="whitespace-nowrap">{dateTime(d.uploaded_at)}<span className="block text-xs text-slate-400">{d.uploaded_by_name ?? "Client (online)"}</span></td>
                <td data-testid="document-status">
                  <span className={d.status === "verified" ? "text-green-700" : d.status === "rejected" ? "text-red-700" : "text-amber-700"}>{d.status}</span>
                  {d.rejection_reason && <span className="block text-xs text-slate-500">{d.rejection_reason}</span>}
                </td>
                <td className="text-xs text-slate-500">{d.reviewed_at ? `${d.reviewed_by_name} · ${dateTime(d.reviewed_at)}` : "—"}</td>
                <td className="space-x-1 whitespace-nowrap">
                  <SmallBtn onClick={() => open(d.id)} disabled={opening === d.id}>{opening === d.id ? "Opening…" : "Open"}</SmallBtn>
                  {d.status !== "verified" && <SmallBtn disabled={a.pending} onClick={() => a.go({ action: "verify_document", document_id: d.id })}>Verify</SmallBtn>}
                  {d.status !== "rejected" && <SmallBtn onClick={() => { setRejecting(d.id); setReason(""); }}>Reject</SmallBtn>}
                  {rejecting === d.id && (
                    <form className="mt-2 flex gap-1" onSubmit={async (e) => {
                      e.preventDefault();
                      if (await a.go({ action: "reject_document", document_id: d.id, reason })) setRejecting(null);
                    }}>
                      <input aria-label="Rejection reason" required className="input py-1 text-xs" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                      <SmallBtn type="submit" disabled={a.pending}>Save</SmallBtn>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-xs text-slate-500">Verification is a manual staff review. Links expire after 10 minutes and every open is logged.</p>
      {a.error && <p role="alert" className="mt-2 text-red-600">{a.error}</p>}
    </Card>
  );
}

export function AppointmentRowActions({ appt }: { appt: Row }) {
  const a = useRowAction();
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(toLocalInput(appt.scheduled_at));
  const [location, setLocation] = useState(appt.location ?? "");
  const [type, setType] = useState(appt.appointment_type);
  const [notes, setNotes] = useState(appt.notes ?? "");
  const set = (status: string) => a.go({ action: "update_appointment", appointment_id: appt.id, status });
  const closed = appt.status === "cancelled" || appt.status === "attended" || appt.status === "missed";
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
          const ok = await a.go({
            action: "update_appointment", appointment_id: appt.id, appointment_type: type,
            scheduled_at: fromLocalInput(when).toISOString(), location: location || null, notes: notes || null,
          });
          if (ok) setEditing(false);
        }}>
          <input aria-label="Appointment type" className="input py-1" value={type} onChange={(e) => setType(e.target.value)} required />
          <input aria-label="New date and time" type="datetime-local" className="input py-1" value={when} onChange={(e) => setWhen(e.target.value)} required />
          <input aria-label="Location" className="input py-1" placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
          <input aria-label="Notes" className="input py-1" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <SmallBtn type="submit" disabled={a.pending}>Save changes</SmallBtn>
        </form>
      )}
      {a.error && <p role="alert" className="whitespace-normal text-xs text-red-600">{a.error}</p>}
    </div>
  );
}

function AppointmentsCard({ appts }: { appts: Row[] }) {
  return (
    <Card title="Appointments" id="appointments">
      {appts.length === 0 ? <Empty>No appointments.</Empty> : (
        <table className="table">
          <thead><tr><th>When</th><th>Type</th><th>Location</th><th>Status</th><th>By</th><th /></tr></thead>
          <tbody>
            {appts.map((x) => (
              <tr key={x.id} data-testid="appointment-row">
                <td className="whitespace-nowrap">{dateTime(x.scheduled_at)}</td>
                <td>{x.appointment_type}{x.notes && <span className="block text-xs text-slate-500">{x.notes}</span>}</td>
                <td>{x.location ?? "—"}</td>
                <td data-testid="appointment-status">{x.status}</td>
                <td>{x.handled_by_name ?? "—"}</td>
                <td><AppointmentRowActions appt={x} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function NotesCard({ notes }: { notes: Row[] }) {
  return (
    <Card title="Notes" id="notes">
      {notes.length === 0 ? <Empty>No notes.</Empty> : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} data-testid="note-row">
              <p className="whitespace-pre-wrap">{n.note}</p>
              <p className="text-xs text-slate-500">{n.handled_by_name} · {dateTime(n.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function TaskRowActions({ task }: { task: Row }) {
  const a = useRowAction();
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

function TasksCard({ tasks }: { tasks: Row[] }) {
  return (
    <Card title="Tasks" id="tasks">
      {tasks.length === 0 ? <Empty>No tasks.</Empty> : (
        <table className="table">
          <thead><tr><th>Task</th><th>Assigned</th><th>Due</th><th>Status</th><th /></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} data-testid="task-row">
                <td>{t.title}{t.description && <span className="block text-xs text-slate-500">{t.description}</span>}</td>
                <td>{t.assigned_to_name ?? "—"}</td>
                <td className="whitespace-nowrap">{dateTime(t.due_at)}</td>
                <td data-testid="task-status">{t.status.replace("_", " ")}{t.completed_at && <span className="block text-xs text-slate-500">{t.completed_by_name} · {dateTime(t.completed_at)}</span>}</td>
                <td><TaskRowActions task={t} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function ContactsCard({ contacts }: { contacts: Row[] }) {
  return (
    <Card title="Contact History" id="contacts">
      {contacts.length === 0 ? <Empty>No contacts logged.</Empty> : (
        <ul className="space-y-3">
          {contacts.map((k) => (
            <li key={k.id} data-testid="contact-row">
              <p><span className="font-medium">{CONTACT_LABELS[k.method as keyof typeof CONTACT_LABELS]}</span> — {k.result}</p>
              {k.next_action && <p className="text-slate-600">Next: {k.next_action}</p>}
              <p className="text-xs text-slate-500">{k.handled_by_name} · {dateTime(k.created_at)}{k.followup_date ? ` · follow up ${dateOnly(k.followup_date)}` : ""}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function FollowupRowActions({ f }: { f: Row }) {
  const a = useRowAction();
  const [note, setNote] = useState("");
  if (f.status !== "open") return null;
  return (
    <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); a.go({ action: "complete_followup", followup_id: f.id, completion_note: note || null }); }}>
      <input aria-label="Completion note" className="input py-1 text-xs" placeholder="Outcome (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <SmallBtn type="submit" disabled={a.pending}>Complete</SmallBtn>
      {a.error && <p role="alert" className="text-xs text-red-600">{a.error}</p>}
    </form>
  );
}

function FollowupsCard({ followups }: { followups: Row[] }) {
  return (
    <Card title="Follow-ups" id="followups">
      {followups.length === 0 ? <Empty>No follow-ups.</Empty> : (
        <table className="table">
          <thead><tr><th>Due</th><th>Reason</th><th>Status</th><th /></tr></thead>
          <tbody>
            {followups.map((f) => (
              <tr key={f.id} data-testid="followup-row">
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

function PostHireRow({ clientId, item, row, startDate }: { clientId: string; item: (typeof POST_HIRE_ITEMS)[number]; row?: Row; startDate: string | null }) {
  const a = useRowAction();
  const [status, setStatus] = useState(row?.status ?? "not_started");
  const [note, setNote] = useState(row?.note ?? "");
  const [date, setDate] = useState(startDate ?? "");
  const dirty = status !== (row?.status ?? "not_started") || note !== (row?.note ?? "") || (item === "start_date" && date !== (startDate ?? ""));
  return (
    <tr data-testid={`post-hire-${item}`}>
      <td className="font-medium">{POST_HIRE_LABELS[item]}</td>
      <td>
        <select aria-label={`${POST_HIRE_LABELS[item]} status`} className="input py-1" value={status} onChange={(e) => setStatus(e.target.value)}>
          {POST_HIRE_STATUSES.map((s) => <option key={s} value={s}>{POST_HIRE_STATUS_LABELS[s]}</option>)}
        </select>
      </td>
      <td className="space-y-1">
        {item === "start_date" && <input aria-label="Start date" type="date" className="input py-1" value={date} onChange={(e) => setDate(e.target.value)} />}
        <input aria-label={`${POST_HIRE_LABELS[item]} note`} className="input py-1" placeholder="What is confirmed" value={note} onChange={(e) => setNote(e.target.value)} />
      </td>
      <td className="text-xs text-slate-500">{row ? `${row.handled_by_name ?? "—"} · ${dateTime(row.updated_at)}` : "—"}</td>
      <td>
        <SmallBtn disabled={!dirty || a.pending} onClick={() => a.go({
          action: "update_post_hire", client_id: clientId, item, status, note: note || null,
          ...(item === "start_date" ? { start_date: date || null } : {}),
        })}>Save</SmallBtn>
        {a.error && <p role="alert" className="text-xs text-red-600">{a.error}</p>}
      </td>
    </tr>
  );
}

function PostHireCard({ clientId, items, startDate }: { clientId: string; items: Row[]; startDate: string | null }) {
  const byItem = new Map(items.map((r) => [r.item, r]));
  return (
    <Card title="Post-Hire Tasks" id="post-hire">
      <p className="mb-2 text-xs text-slate-500">Record only what the client or employer has actually confirmed.</p>
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Item</th><th>Status</th><th>Details</th><th>Updated</th><th /></tr></thead>
          <tbody>
            {POST_HIRE_ITEMS.map((i) => (
              <PostHireRow key={`${i}-${byItem.get(i)?.updated_at ?? ""}-${startDate ?? ""}`} clientId={clientId} item={i} row={byItem.get(i)} startDate={startDate} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const ACTION_LABELS: Record<string, string> = {
  client_created: "Client created", client_updated: "Client updated", preference_added: "Preference added",
  preference_removed: "Preference removed", status_changed: "Status changed", next_step_changed: "Next step changed",
  staff_assigned: "Staff assigned", document_uploaded: "Document uploaded", document_verified: "Document verified",
  document_rejected: "Document rejected", document_opened: "Document opened", appointment_created: "Appointment created",
  appointment_updated: "Appointment updated", appointment_rescheduled: "Appointment rescheduled",
  appointment_completed: "Appointment completed", note_added: "Note added", task_added: "Task added",
  task_updated: "Task updated", task_completed: "Task completed", contact_logged: "Contact logged",
  followup_created: "Follow-up created", followup_completed: "Follow-up completed", post_hire_updated: "Post-hire updated",
};

function summarize(v: unknown) {
  if (!v || typeof v !== "object") return null;
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && x !== undefined && typeof x !== "object");
  if (!entries.length) return null;
  return entries.map(([k, x]) => `${k.replace(/_/g, " ")}: ${k === "status" ? STATUS_LABELS[x as Status] ?? x : x}`).join(" · ");
}

function ActivityCard({ activity }: { activity: Row[] }) {
  return (
    <Card title="Activity Log" id="activity">
      {activity.length === 0 ? <Empty>No activity.</Empty> : (
        <ol className="relative space-y-3 border-l border-slate-200 pl-4">
          {activity.map((l) => {
            const before = summarize(l.old_value);
            const after = summarize(l.new_value);
            return (
              <li key={l.id} data-testid="activity-row" data-action={l.action}>
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-500" />
                <p className="font-medium">{ACTION_LABELS[l.action] ?? l.action}</p>
                {before && <p className="text-xs text-slate-500">Before — {before}</p>}
                {after && <p className="text-xs text-slate-600">{before ? "After — " : ""}{after}</p>}
                <p className="text-xs text-slate-400">{l.handled_by_name ?? (l.action === "client_created" ? "Online application" : "—")} · {dateTime(l.created_at)}</p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
