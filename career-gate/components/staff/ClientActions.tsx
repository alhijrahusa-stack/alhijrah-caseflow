"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "@/components/forms/useAction";
import { useHandledBy, useStaff } from "@/components/staff/StaffContext";
import { Button } from "@/components/ui/Button";
import {
  CONTACT_LABELS,
  CONTACT_METHODS,
  DEFAULT_NEXT_STEP,
  DOC_LABELS,
  DOC_MAX_BYTES,
  DOC_TYPES,
  STATUS_LABELS,
  STATUSES,
  type Status,
} from "@/lib/domain";
import { fromLocalInput, todayInOffice } from "@/lib/format";

export type Panel = "document" | "appointment" | "note" | "task" | "contacted" | "status" | "next_step" | "followup";

type FormProps = { clientId: string; onDone: () => void };

/** Wraps a form: requires Handled By, shows errors, closes on success. */
function useForm(onDone: () => void) {
  const action = useAction();
  const { handledBy, missing } = useHandledBy();
  async function submit(payload: Record<string, unknown>) {
    if (missing) return action.setError(missing);
    const r = await action.run({ ...payload, handled_by: handledBy });
    if (r) onDone();
    return r;
  }
  return { ...action, submit, handledBy, missing };
}

function Shell({ title, children, error, pending, onCancel, submitLabel, testId }: {
  title: string; children: React.ReactNode; error: string | null; pending: boolean; onCancel: () => void; submitLabel: string; testId: string;
}) {
  return (
    <div className="rounded-lg border border-brand-500 bg-white p-4 shadow-sm" data-testid={testId}>
      <h3 className="mb-3 font-semibold">{title}</h3>
      <div className="space-y-3">{children}</div>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function AddNoteForm({ clientId, onDone }: FormProps) {
  const f = useForm(onDone);
  const [note, setNote] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); f.submit({ action: "add_note", client_id: clientId, note }); }}>
      <Shell title="Add note" testId="form-note" error={f.error} pending={f.pending} onCancel={onDone} submitLabel="Add note">
        <label className="label" htmlFor="note_text">Note</label>
        <textarea id="note_text" required rows={4} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Shell>
    </form>
  );
}

export function AppointmentForm({ clientId, onDone }: FormProps) {
  const f = useForm(onDone);
  const [type, setType] = useState("Pre-hire appointment");
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!when) return f.setError("Choose a date and time");
      f.submit({ action: "schedule_appointment", client_id: clientId, appointment_type: type,
        scheduled_at: fromLocalInput(when).toISOString(), location: location || null, notes: notes || null });
    }}>
      <Shell title="Add appointment" testId="form-appointment" error={f.error} pending={f.pending} onCancel={onDone} submitLabel="Save appointment">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="appt_type">Appointment type</label>
            <input id="appt_type" list="appt-types" required className="input" value={type} onChange={(e) => setType(e.target.value)} />
            <datalist id="appt-types">
              <option value="Office intake" /><option value="Document check" /><option value="Pre-hire appointment" />
              <option value="I-9 appointment" /><option value="Follow-up meeting" />
            </datalist>
          </div>
          <div>
            <label className="label" htmlFor="appt_when">Date &amp; time (Michigan time)</label>
            <input id="appt_when" type="datetime-local" required className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="appt_location">Location</label>
            <input id="appt_location" className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="appt_notes">Notes</label>
            <textarea id="appt_notes" rows={2} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </Shell>
    </form>
  );
}

export function TaskForm({ clientId, onDone }: { clientId: string | null; onDone: () => void }) {
  const f = useForm(onDone);
  const { staff } = useStaff();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      f.submit({ action: "add_task", client_id: clientId, title, description: description || null,
        assigned_to: assignee || null, due_at: due ? fromLocalInput(due).toISOString() : null });
    }}>
      <Shell title="Add task" testId="form-task" error={f.error} pending={f.pending} onCancel={onDone} submitLabel="Add task">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="task_title">Title</label>
            <input id="task_title" required className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="task_desc">Description</label>
            <textarea id="task_desc" rows={2} className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="task_assignee">Assigned to</label>
            <select id="task_assignee" className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Same as Handled By</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="task_due">Due</label>
            <input id="task_due" type="datetime-local" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        </div>
      </Shell>
    </form>
  );
}

export function ContactedForm({ clientId, onDone }: FormProps) {
  const f = useForm(onDone);
  const [method, setMethod] = useState<(typeof CONTACT_METHODS)[number]>("call");
  const [result, setResult] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [followup, setFollowup] = useState("");
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      f.submit({ action: "mark_contacted", client_id: clientId, method, result, next_action: nextAction || null, followup_date: followup || null });
    }}>
      <Shell title="Mark contacted" testId="form-contacted" error={f.error} pending={f.pending} onCancel={onDone} submitLabel="Save contact">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="contact_method">Method</label>
            <select id="contact_method" className="input" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              {CONTACT_METHODS.map((m) => <option key={m} value={m}>{CONTACT_LABELS[m]}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="contact_followup">Follow-up date (optional)</label>
            <input id="contact_followup" type="date" min={todayInOffice()} className="input" value={followup} onChange={(e) => setFollowup(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="contact_result">Result</label>
            <input id="contact_result" required className="input" placeholder="e.g. Reached client, confirmed documents" value={result} onChange={(e) => setResult(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="contact_next">Next action</label>
            <input id="contact_next" className="input" value={nextAction} onChange={(e) => setNextAction(e.target.value)} />
          </div>
        </div>
      </Shell>
    </form>
  );
}

export function FollowupForm({ clientId, onDone }: FormProps) {
  const f = useForm(onDone);
  const [due, setDue] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); f.submit({ action: "add_followup", client_id: clientId, due_date: due, reason }); }}>
      <Shell title="Add follow-up" testId="form-followup" error={f.error} pending={f.pending} onCancel={onDone} submitLabel="Add follow-up">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="fu_due">Due date</label>
            <input id="fu_due" type="date" required className="input" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="fu_reason">Reason</label>
            <input id="fu_reason" required className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
      </Shell>
    </form>
  );
}

export function StatusForm({ clientId, current, nextStep, onDone }: FormProps & { current: Status; nextStep: string }) {
  const f = useForm(onDone);
  const [status, setStatus] = useState<Status>(current);
  const [step, setStep] = useState(nextStep);
  return (
    <form onSubmit={(e) => { e.preventDefault(); f.submit({ action: "update_status", client_id: clientId, status, next_step: step }); }}>
      <Shell title="Change status" testId="form-status" error={f.error} pending={f.pending} onCancel={onDone} submitLabel="Save status">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="st_status">Status</label>
            <select id="st_status" className="input" value={status}
              onChange={(e) => { const s = e.target.value as Status; setStatus(s); setStep(DEFAULT_NEXT_STEP[s]); }}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="st_next">Next step</label>
            <input id="st_next" required className="input" value={step} onChange={(e) => setStep(e.target.value)} />
          </div>
        </div>
      </Shell>
    </form>
  );
}

export function NextStepForm({ clientId, nextStep, onDone }: FormProps & { nextStep: string }) {
  const f = useForm(onDone);
  const [step, setStep] = useState(nextStep);
  return (
    <form onSubmit={(e) => { e.preventDefault(); f.submit({ action: "set_next_step", client_id: clientId, next_step: step }); }}>
      <Shell title="Set next step" testId="form-next-step" error={f.error} pending={f.pending} onCancel={onDone} submitLabel="Save next step">
        <label className="label" htmlFor="ns_text">Next step (shown on the client status page)</label>
        <input id="ns_text" required className="input" value={step} onChange={(e) => setStep(e.target.value)} />
      </Shell>
    </form>
  );
}

export function DocumentForm({ clientId, onDone }: FormProps) {
  const router = useRouter();
  const { handledBy, missing } = useHandledBy();
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]>("photo_id");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (missing) return setError(missing);
      if (!file) return setError("Choose a file");
      if (file.size > DOC_MAX_BYTES) return setError("File is larger than 4 MB");
      setPending(true);
      setError(null);
      const form = new FormData();
      form.set("client_id", clientId);
      form.set("handled_by", handledBy);
      form.set("doc_type", docType);
      form.set("file", file);
      const res = await fetch("/api/staff/documents", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      setPending(false);
      if (!data?.ok) return setError(data?.error?.message ?? `Upload failed (${res.status})`);
      router.refresh();
      onDone();
    }}>
      <Shell title="Add document" testId="form-document" error={error} pending={pending} onCancel={onDone} submitLabel="Upload">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="doc_type_sel">Type</label>
            <select id="doc_type_sel" className="input" value={docType} onChange={(e) => setDocType(e.target.value as typeof docType)}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_LABELS[t]}</option>)}
            </select>
          </div>
          <input aria-label="Document file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
            className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <p className="text-xs text-slate-500">JPEG, PNG, WebP or PDF up to 4 MB. Stored privately.</p>
      </Shell>
    </form>
  );
}
