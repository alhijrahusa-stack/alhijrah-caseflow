"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAction } from "@/components/forms/useAction";
import { StaffPicker } from "@/components/staff/StaffPicker";
import { useStaff } from "@/components/staff/StaffContext";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import {
  CONTACT_LABELS,
  CONTACT_METHODS,
  DEFAULT_NEXT_STEP,
  DOC_LABELS,
  DOC_MAX_BYTES,
  DOC_TYPES,
  STATUS_LABELS,
  TRANSITIONS,
  type Status,
} from "@/lib/domain";
import { dateTime, fromLocalInput, todayInOffice } from "@/lib/format";

export type Panel = "document" | "appointment" | "note" | "task" | "contacted" | "status" | "next_step" | "followup" | "assign";

type FormProps = { clientId: string; onDone: () => void };

function Shell({ title, children, error, pending, onCancel, submitLabel, testId }: {
  title: string; children: React.ReactNode; error: string | null; pending: boolean; onCancel: () => void; submitLabel: string; testId: string;
}) {
  return (
    <div
      className="rounded-2xl border border-white/[.09] bg-[linear-gradient(150deg,rgba(15,28,48,.94),rgba(7,14,26,.96))] p-4 text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,.04),0_22px_70px_rgba(0,0,0,.26)] backdrop-blur-2xl"
      data-testid={testId}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      <h3 className="mb-3 font-semibold tracking-[-.01em] text-slate-100">{title}</h3>
      <div className="space-y-3">{children}</div>
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function useSubmit(onDone: () => void, success: string) {
  const a = useAction({ successMessage: success });
  const submit = async (payload: Record<string, unknown>) => {
    const r = await a.run(payload);
    if (r) onDone();
    return r;
  };
  return { ...a, submit };
}

export function AddNoteForm({ clientId, onDone }: FormProps) {
  const f = useSubmit(onDone, "Note added");
  const [note, setNote] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); f.submit({ action: "add_note", client_id: clientId, note }); }}>
      <Shell title="Add note" testId="form-note" error={f.error} pending={f.pending} onCancel={onDone} submitLabel="Add note">
        <label className="label" htmlFor="note_text">Note</label>
        <textarea id="note_text" required rows={4} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="text-xs text-slate-500">Notes cannot be edited later. Add a new note to correct one.</p>
      </Shell>
    </form>
  );
}

type Slot = { start: string; end: string; resource_key: string };

export function AppointmentForm({ clientId, onDone }: FormProps) {
  const f = useSubmit(onDone, "Appointment saved");
  const { activeStaff } = useStaff();
  const [type, setType] = useState("Pre-hire appointment");
  const [resource, setResource] = useState("office");
  const [duration, setDuration] = useState(30);
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    fetch(`/api/staff/slots?resource=${encodeURIComponent(resource)}&duration=${duration}`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        if (d?.ok) { setSlots(d.slots); setSlotError(null); } else setSlotError(d?.error?.message ?? "Could not load availability");
      })
      .catch(() => !off && setSlotError("Could not load availability"));
    return () => { off = true; };
  }, [resource, duration]);

  const base = { client_id: clientId, appointment_type: type, location: location || null, notes: notes || null };
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!when) return f.setError("Choose a suggested slot or enter a date and time");
      f.submit({ action: "schedule_appointment", ...base, resource_key: resource, duration_minutes: duration, scheduled_at: fromLocalInput(when).toISOString() });
    }}>
      <Shell title="Add appointment" testId="form-appointment" error={f.error} pending={f.pending} onCancel={onDone} submitLabel="Save appointment">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="appt_type">Appointment type</label>
            <input id="appt_type" list="appt-types" required className="input" value={type} onChange={(e) => setType(e.target.value)} />
            <datalist id="appt-types">
              <option value="Office intake" /><option value="Document check" /><option value="Pre-hire appointment" />
              <option value="I-9 appointment" /><option value="Follow-up meeting" />
            </datalist>
          </div>
          <div>
            <label className="label" htmlFor="appt_resource">With</label>
            <select id="appt_resource" className="input" value={resource} onChange={(e) => setResource(e.target.value)}>
              <option value="office">Office</option>
              {activeStaff.map((s) => <option key={s.id} value={`staff:${s.id}`}>{s.display_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="appt_duration">Minutes</label>
            <input id="appt_duration" type="number" min={5} max={480} className="input" value={duration} onChange={(e) => setDuration(Number(e.target.value) || 30)} />
          </div>
        </div>
        <div data-testid="slot-suggestions">
          <p className="label">Next available (office calendar)</p>
          {slotError && <p className="text-sm text-red-400">{slotError}</p>}
          {slots && slots.length === 0 && <p className="text-sm text-slate-500">No open slots in the next 3 weeks. Set office hours under Availability, or enter a time below.</p>}
          <div className="flex flex-wrap gap-2">
            {slots?.map((s) => (
              <button key={s.start} type="button" disabled={f.pending} data-testid="slot"
                className="rounded-md border border-cyan-400/25 bg-cyan-400/[.04] px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-400/[.08]"
                onClick={() => f.submit({ action: "book_slot", ...base, resource_key: s.resource_key, start: s.start, end: s.end })}>
                Book {dateTime(s.start)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="appt_when">Or a specific date &amp; time (Michigan time)</label>
            <input id="appt_when" type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div>
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
  const f = useSubmit(onDone, "Task added");
  const { activeStaff, me } = useStaff();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState(me.id);
  const [due, setDue] = useState("");
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      f.submit({ action: "add_task", client_id: clientId, title, description: description || null, assigned_to: assignee || null, due_at: due ? fromLocalInput(due).toISOString() : null });
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
              {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
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
  const f = useSubmit(onDone, "Contact recorded");
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
            <input id="contact_result" required className="input" placeholder="What actually happened" value={result} onChange={(e) => setResult(e.target.value)} />
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
  const f = useSubmit(onDone, "Follow-up added");
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
  const f = useSubmit(onDone, "Status updated");
  const choices = TRANSITIONS[current];
  const initial = choices[0] ?? "";
  const [status, setStatus] = useState<Status | "">(initial);
  const [step, setStep] = useState(initial ? DEFAULT_NEXT_STEP[initial] : nextStep);

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!status) return;
      f.submit({ action: "update_status", client_id: clientId, status, next_step: step });
    }}>
      <Shell title="Change status" testId="form-status" error={f.error} pending={f.pending} onCancel={onDone} submitLabel="Save status">
        <div className="rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2 text-xs text-slate-400">
          Current: <strong className="text-slate-200">{STATUS_LABELS[current]}</strong>
        </div>
        {choices.length === 0 ? (
          <p className="text-sm text-slate-500">No further status changes are allowed from {STATUS_LABELS[current]}.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="st_status">New status</label>
              <select id="st_status" className="input" value={status}
                onChange={(e) => { const s = e.target.value as Status; setStatus(s); setStep(DEFAULT_NEXT_STEP[s]); }}>
                {choices.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="st_next">Next step</label>
              <input id="st_next" required className="input" value={step} onChange={(e) => setStep(e.target.value)} />
            </div>
          </div>
        )}
      </Shell>
    </form>
  );
}

export function NextStepForm({ clientId, nextStep, onDone }: FormProps & { nextStep: string }) {
  const f = useSubmit(onDone, "Next step saved");
  const [step, setStep] = useState(nextStep);
  return (
    <form onSubmit={(e) => { e.preventDefault(); f.submit({ action: "set_next_step", client_id: clientId, next_step: step }); }}>
      <Shell title="Set next step" testId="form-next-step" error={f.error} pending={f.pending} onCancel={onDone} submitLabel="Save next step">
        <label className="label" htmlFor="ns_text">Next step (shown to the client)</label>
        <input id="ns_text" required className="input" value={step} onChange={(e) => setStep(e.target.value)} />
      </Shell>
    </form>
  );
}

export function AssignForm({ clientId, current, onDone }: FormProps & { current: string | null }) {
  const f = useSubmit(onDone, "Assignment saved");
  const { activeStaff } = useStaff();
  const [staffId, setStaffId] = useState(current ?? "");
  return (
    <form onSubmit={(e) => { e.preventDefault(); f.submit({ action: "assign_staff", client_id: clientId, staff_id: staffId || null }); }}>
      <Shell title="Assign staff" testId="form-assign" error={f.error} pending={f.pending} onCancel={onDone} submitLabel="Save">
        <label className="label">Handled by</label>
        <StaffPicker value={staffId} staff={activeStaff} onChange={setStaffId} disabled={f.pending} />
      </Shell>
    </form>
  );
}

export function DocumentForm({ clientId, onDone }: FormProps) {
  const router = useRouter();
  const toast = useToast();
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]>("photo_id");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (!file) return setError("Choose a file");
      if (file.size > DOC_MAX_BYTES) return setError("File is larger than 4 MB");
      setPending(true);
      setError(null);
      const form = new FormData();
      form.set("client_id", clientId);
      form.set("doc_type", docType);
      form.set("file", file);
      const res = await fetch("/api/staff/documents", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      setPending(false);
      if (!data?.ok) {
        const msg = data?.error?.message ?? `Upload failed (${res.status})`;
        setError(msg);
        toast("error", msg);
        return;
      }
      toast("success", "Document uploaded; processing queued");
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
            className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border file:border-white/[.08] file:bg-white/[.04] file:px-3 file:py-2 file:text-xs file:text-slate-300" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <p className="text-xs text-slate-500">JPEG, PNG, WebP or PDF up to 4 MB. Stored privately; the original is never modified.</p>
      </Shell>
    </form>
  );
}
