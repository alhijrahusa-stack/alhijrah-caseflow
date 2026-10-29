"use client";

import { useEffect, useRef, useState } from "react";
import { useAction } from "@/components/forms/useAction";
import { useTargetedMutation } from "@/components/staff/realtime/useTargetedMutation";
import { QuickDate, QuickDateTime } from "@/components/staff/QuickDate";
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
  STATUSES,
  TRANSITIONS,
  type Status,
} from "@/lib/domain";
import { dateTime, fromLocalInput, toLocalInput, todayInOffice } from "@/lib/format";
import { AppointmentLocationPicker, locationDisplay, type AppointmentLocation } from "@/components/staff/AppointmentLocationPicker";

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
  const isMounted = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);
  const submit = async (payload: Record<string, unknown>) => {
    const r = await a.run(payload);
    if (r && isMounted.current) onDone();
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

export function AppointmentForm({ clientId, clientName, onDone }: FormProps & { clientName?: string }) {
  const f = useSubmit(onDone, "Appointment saved");
  const { activeStaff } = useStaff();
  const [type, setType] = useState("Pre-hire appointment");
  const [lifecycleInterview, setLifecycleInterview] = useState(false);
  const [resource, setResource] = useState("office");
  const [duration, setDuration] = useState(30);
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState("");
  const [selectedSite, setSelectedSite] = useState<AppointmentLocation | null>(null);
  const [notes, setNotes] = useState("");
  const [review, setReview] = useState(false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    fetch(`/api/staff/slots?resource=${encodeURIComponent(resource)}&duration=${duration}`)
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        if (d?.ok) { setSlots(d.slots); setSlotError(null); }
        else setSlotError(d?.error?.message ?? "Could not load suggested times");
      })
      .catch(() => { if (!off) setSlotError("Could not load suggested times"); });
    return () => { off = true; };
  }, [resource, duration]);

  const currentLocation = selectedSite ? locationDisplay(selectedSite) : location;
  const resetReview = () => setReview(false);
  const confirmBooking = () => {
    if (!when) return f.setError("Choose a date and time");
    const start = fromLocalInput(when);
    if (!Number.isFinite(start.getTime()) || start.getTime() <= Date.now()) return f.setError("Choose a future date and time");
    if (!type.trim()) return f.setError("Appointment type is required");
    if (!currentLocation.trim()) return f.setError("Choose an interview site or enter an office location");
    if (!review) { f.setError(null); setReview(true); return; }
    f.submit({
      action: "schedule_appointment", client_id: clientId,
      appointment_type: type, lifecycle_interview: lifecycleInterview, resource_key: resource,
      duration_minutes: duration, scheduled_at: start.toISOString(),
      location_id: selectedSite?.id ?? null, location: currentLocation,
      notes: notes || null, confirm_booking: true,
    });
  };

  return <form onSubmit={(event) => { event.preventDefault(); confirmBooking(); }}>
    <Shell title="Add appointment · حجز موعد" testId="form-appointment" error={f.error} pending={f.pending}
      onCancel={onDone} submitLabel={review ? "Approve & Save Appointment" : "Review Appointment"}>
      <div className="rounded-2xl border border-amber-300/25 bg-gradient-to-br from-[#1b3853] to-[#091a2d] p-3 shadow-[inset_0_1px_rgba(255,255,255,.08)]">
        <p className="text-xs font-semibold tracking-wider text-amber-200">CAREER GATE · APPOINTMENT WORKSPACE</p>
        <p className="mt-1 text-sm text-slate-300">Select an appointment time and interview destination, then approve the summary.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="appt_type">Appointment type</label>
          <input id="appt_type" list="appt-types" required className="input" value={type} onChange={e=>{setType(e.target.value);resetReview();}} />
          <datalist id="appt-types">
            <option value="Office intake"/><option value="Document check"/><option value="Employment interview"/><option value="Pre-hire appointment"/>
            <option value="I-9 appointment"/><option value="Follow-up meeting"/>
          </datalist>
        </div>
        <div>
          <label className="label" htmlFor="appt_resource">Handled by</label>
          <select id="appt_resource" className="input" value={resource} onChange={e=>{setResource(e.target.value);resetReview();}}>
            <option value="office">Office</option>
            {activeStaff.map(staff=><option key={staff.id} value={`staff:${staff.id}`}>{staff.display_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="appt_duration">Duration (minutes)</label>
          <input id="appt_duration" type="number" min={5} max={480} className="input" value={duration}
            onChange={e=>{setDuration(Number(e.target.value)||30);resetReview();}} />
        </div>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-200/20 bg-amber-200/[.06] p-3 text-sm text-slate-100">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-amber-300" checked={lifecycleInterview} onChange={e=>{
          setLifecycleInterview(e.target.checked);resetReview();
          if(e.target.checked && type==="Pre-hire appointment")setType("Employment interview");
        }} />
        <span><strong className="block text-amber-200">Employment interview · G3 Pipeline</strong>
          <span className="mt-1 block text-xs text-slate-400">Moves an eligible Job Ready client into the appointment stage. Other types stay independent.</span>
        </span>
      </label>
      <div data-testid="slot-suggestions">
        <p className="label">Suggested times (optional)</p>
        {slotError && <p className="text-xs text-amber-200">{slotError}</p>}
        <div className="flex flex-wrap gap-2">
          {slots?.map(slot=><button key={slot.start} type="button" disabled={f.pending} data-testid="slot"
            className="rounded-xl border border-cyan-400/25 bg-cyan-400/[.06] px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-400/[.12]"
            onClick={()=>{setWhen(toLocalInput(slot.start));setResource(slot.resource_key);resetReview();}}>
            Select {dateTime(slot.start)}
          </button>)}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="appt_when">Date & time · Michigan local time</label>
        <QuickDateTime ariaLabel="Or a specific date & time (Michigan time)" value={when}
          onChange={value=>{setWhen(value);resetReview();}} />
      </div>
      <div className="space-y-2">
        <label className="label">Location · موقع المقابلة</label>
        <AppointmentLocationPicker selectedId={selectedSite?.id??null}
          onSelect={site=>{setSelectedSite(site);setLocation(locationDisplay(site));resetReview();}}
          onClear={()=>{setSelectedSite(null);setLocation("");resetReview();}} />
        <input id="appt_location" aria-label="Manual appointment location" className="input"
          placeholder="Office address or another location" value={currentLocation}
          onChange={event=>{setSelectedSite(null);setLocation(event.target.value);resetReview();}} />
      </div>
      <div>
        <label className="label" htmlFor="appt_notes">Notes</label>
        <textarea id="appt_notes" rows={2} className="input" value={notes}
          onChange={event=>{setNotes(event.target.value);resetReview();}} />
      </div>
      {review && <section data-testid="appointment-review" aria-label="Confirm appointment"
        className="space-y-2 rounded-2xl border border-amber-300/50 bg-gradient-to-br from-[#1c3855] to-[#091c30] p-4 text-sm text-slate-100">
        <h4 className="font-semibold text-amber-200">Review & confirm · مراجعة واعتماد الموعد</h4>
        <p><strong>Client:</strong> {clientName || "Selected client"}</p>
        <p><strong>Type:</strong> {type}</p>
        <p><strong>Location:</strong> {currentLocation}</p>
        <p><strong>When:</strong> {dateTime(fromLocalInput(when))}</p>
        <p className="text-amber-100">يرجى الوصول قبل موعد المقابلة بنصف ساعة، وإحضار الوثائق الأصلية للمقابلة.</p>
        <p className="text-slate-200">نتمنى لكم التوفيق · بوابة التوظيف — Career Gate</p>
        <button type="button" onClick={resetReview} className="min-h-9 rounded-lg border border-white/20 px-3 text-xs text-slate-200">Edit details</button>
      </section>}
    </Shell>
  </form>;
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
            <QuickDateTime ariaLabel="Due" value={due} onChange={setDue} />
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
            <QuickDate ariaLabel="Follow-up date (optional)" min={todayInOffice()} value={followup} onChange={setFollowup} />
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
            <QuickDate ariaLabel="Due date" value={due} onChange={setDue} required />
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
  const { isAdmin } = useStaff();
  const allowed = TRANSITIONS[current];
  const choices = isAdmin ? STATUSES.filter((s) => s !== current) : allowed;
  const initial = choices[0] ?? "";
  const [status, setStatus] = useState<Status | "">(initial);
  const [step, setStep] = useState(initial ? DEFAULT_NEXT_STEP[initial] : nextStep);
  const [reason, setReason] = useState("");
  const requiresOverride = Boolean(status && isAdmin && !allowed.some((s) => s === status));

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!status) return;
      f.submit(requiresOverride
        ? { action: "override_status", client_id: clientId, status, next_step: step, reason }
        : { action: "update_status", client_id: clientId, status, next_step: step });
    }}>
      <Shell title="Change status" testId="form-status" error={f.error} pending={f.pending} onCancel={onDone} submitLabel={requiresOverride ? "Apply administrative status" : "Save status"}>
        <div className="rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2 text-xs text-slate-400">
          Current: <strong className="text-slate-200">{STATUS_LABELS[current]}</strong>
          {isAdmin && <span className="ml-2 text-amber-300/70">All statuses available</span>}
        </div>
        {choices.length === 0 ? (
          <p className="text-sm text-slate-500">No further status changes are allowed from {STATUS_LABELS[current]}.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="st_status">New status</label>
              <select id="st_status" className="input" value={status}
                onChange={(e) => { const s = e.target.value as Status; setStatus(s); setStep(DEFAULT_NEXT_STEP[s]); setReason(""); }}>
                {choices.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="st_next">Next step</label>
              <input id="st_next" required className="input" value={step} onChange={(e) => setStep(e.target.value)} />
            </div>
          </div>
        )}
        {requiresOverride && (
          <div className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-3">
            <p className="mb-2 text-xs text-amber-100/70">This status is outside the normal transition path. The reason is required and will be recorded in the activity log.</p>
            <label className="label" htmlFor="st_reason">Administrative reason</label>
            <input id="st_reason" required className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
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
  const onMutated = useTargetedMutation();
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
      onMutated("upload_document", clientId);
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
