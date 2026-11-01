"use client";

import { StaffLabel, useStaffLabel } from "@/components/staff/StaffLabel";
import { arabicStaffLabel } from "@/lib/staff-ui-labels";


import { RoyalSelect, RoyalOption } from "@/components/forms/RoyalSelect";
import { RoyalCombobox } from "@/components/forms/RoyalCombobox";

import { isEmploymentInterview } from "@/lib/appointment-purpose";

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
import { dateTime, fromLocalInput, todayInOffice, toLocalInput } from "@/lib/format";
import { AmazonWarehousePicker } from "@/components/staff/AmazonWarehousePicker";
import { siteForLocation, warehouseMapUrl } from "@/lib/amazon-interview-sites";

export type Panel = "document" | "appointment" | "note" | "task" | "contacted" | "status" | "next_step" | "followup" | "assign";

type FormProps = { clientId: string; onDone: () => void };

function Shell({ title, children, error, pending, onCancel, submitLabel, testId }: {
  title: string; children: React.ReactNode; error: string | null; pending: boolean; onCancel: () => void; submitLabel: string; testId: string;
}) {
  const uiLabel = useStaffLabel();
  return (
    <div
      className="rounded-2xl border border-amber-300/25 bg-gradient-to-br from-[#163754] to-[#071525] p-4 text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,.04),0_22px_70px_rgba(0,0,0,.26)] "
      data-testid={testId}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      <h3 className="mb-3 font-semibold tracking-[-.01em] text-slate-100">{title}</h3>
      <div className="space-y-3">{children}</div>
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? uiLabel("Saving…") : submitLabel}</Button>
        <Button variant="ghost" onClick={onCancel}><StaffLabel en="Cancel"/></Button>
      </div>
    </div>
  );
}

function useSubmit(onDone: () => void, success: string) {
  const uiLabel = useStaffLabel();
  const a = useAction({ successMessage: uiLabel(success) });
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
  const uiLabel = useStaffLabel();
  const f = useSubmit(onDone, "Note added");
  const [note, setNote] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); f.submit({ action: "add_note", client_id: clientId, note }); }}>
      <Shell title={uiLabel("Add note")} testId="form-note" error={f.error} pending={f.pending} onCancel={onDone} submitLabel={uiLabel("Add note")}>
        <label className="label" htmlFor="note_text"><StaffLabel en="Note"/></label>
        <textarea id="note_text" required rows={4} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="text-xs text-slate-500"><StaffLabel en="Notes cannot be edited later. Add a new note to correct one."/></p>
      </Shell>
    </form>
  );
}

type Slot = { start: string; end: string; resource_key: string };

export function AppointmentForm({ clientId, clientName, onDone }: FormProps & { clientName: string }) {
  const uiLabel = useStaffLabel();
  const f = useSubmit(onDone, "Appointment saved");
  const { activeStaff } = useStaff();
  const [type, setType] = useState("Employment interview");
  const [lifecycleInterview, setLifecycleInterview] = useState(true);
  const [resource, setResource] = useState("office");
  const [duration, setDuration] = useState(30);
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const selectedSite = siteForLocation(location);
  const formattedWhen = when ? fromLocalInput(when) : null;
  const validWhen = formattedWhen !== null && Number.isFinite(formattedWhen.getTime());

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

  const base = { client_id: clientId, appointment_type: type, lifecycle_interview: lifecycleInterview, location: location || null, notes: notes || null };
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (!validWhen || !formattedWhen) return f.setError("Choose a valid date and time");
      f.submit({ action: "schedule_appointment", ...base, approve_booking: true, resource_key: resource, duration_minutes: duration, scheduled_at: formattedWhen.toISOString() });
    }}>
      <Shell title={uiLabel("Add appointment")} testId="form-appointment" error={f.error} pending={f.pending} onCancel={onDone} submitLabel={uiLabel("Approve & Save appointment")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="appt_type"><StaffLabel en="Appointment type"/></label>
            <RoyalCombobox id="appt_type" options={["Office intake", "Document check", "Employment interview", "Pre-hire appointment", "I-9 appointment", "Follow-up meeting"]} required className="input" value={type} onChange={(e) => {setType(e.target.value);setLifecycleInterview(isEmploymentInterview(e.target.value));}} />
          </div>
          <div>
            <label className="label" htmlFor="appt_resource"><StaffLabel en="With"/></label>
            <RoyalSelect id="appt_resource" className="input" value={resource} onChange={(e) => setResource(e.target.value)}>
              <RoyalOption labelAr="المكتب" value="office">Office</RoyalOption>
              {activeStaff.map((s) => <RoyalOption key={s.id} value={`staff:${s.id}`}>{s.display_name}</RoyalOption>)}
            </RoyalSelect>
          </div>
          <div>
            <label className="label" htmlFor="appt_duration"><StaffLabel en="Minutes"/></label>
            <input id="appt_duration" type="number" min={5} max={480} className="input" value={duration} onChange={(e) => setDuration(Number(e.target.value) || 30)} />
          </div>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-200/20 bg-amber-200/[.06] p-3 text-sm text-slate-100">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-amber-300" checked={lifecycleInterview} onChange={(e) => {
            setLifecycleInterview(e.target.checked);
            if (e.target.checked && !isEmploymentInterview(type)) setType("Employment interview");
            if (!e.target.checked && isEmploymentInterview(type)) setType("Office intake");
          }} />
          <span><strong className="block text-amber-200"><StaffLabel en="Employment interview · G3 Pipeline"/></strong>
            <span className="mt-1 block text-xs text-slate-400"><StaffLabel en="Moves an eligible Job Ready client to Appointment Scheduled in the same database transaction. Office and document appointments remain independent."/></span>
          </span>
        </label>
        <div data-testid="slot-suggestions">
          <p className="label"><StaffLabel en="Next available (office calendar)"/></p>
          {slotError && <p className="text-sm text-red-400">{slotError}</p>}
          {slots && slots.length === 0 && <p className="text-sm text-slate-300"><StaffLabel en="No office-calendar suggestions. Staff can choose an exact time below; other clients may share that time and resource."/></p>}
          <div className="flex flex-wrap gap-2">
            {slots?.map((s) => (
              <button key={s.start} type="button" disabled={f.pending} data-testid="slot"
                className="rounded-xl border border-amber-300/30 bg-[#163750] px-3 py-2 text-xs text-amber-100 hover:border-amber-300/70"
                onClick={() => { setWhen(toLocalInput(s.start)); setResource(s.resource_key); }}><StaffLabel en="Select"/>{" "}{dateTime(s.start)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="appt_when"><StaffLabel en="Or a specific date & time (Michigan time)"/></label>
            <QuickDateTime ariaLabel="Or a specific date & time (Michigan time)" value={when} onChange={setWhen} />
          </div>
          <div>
            <label className="label" htmlFor="appt_location"><StaffLabel en="Location"/></label>
            <AmazonWarehousePicker value={location} onChange={setLocation} disabled={f.pending} />
            <input id="appt_location" aria-label={uiLabel("Appointment location (editable)")} maxLength={300} className="input mt-2 w-full" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={uiLabel("Office or verified interview address")} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="appt_notes"><StaffLabel en="Notes"/></label>
            <textarea id="appt_notes" rows={2} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <section aria-label={uiLabel("Review appointment before approval")} className="rounded-2xl border border-amber-300/35 bg-gradient-to-br from-[#15344e] to-[#07182b] p-3.5 text-slate-100 shadow-[inset_0_1px_rgba(255,255,255,.1)]">
          <p className="text-xs font-semibold tracking-wide text-amber-200"><StaffLabel en="CAREER GATE · APPOINTMENT REVIEW"/></p>
          <h4 className="mt-1 text-base font-semibold">مراجعة الموعد قبل الاعتماد</h4>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div><dt className="text-slate-400"><StaffLabel en="Client / العميل"/></dt><dd className="mt-1 break-words font-semibold">{clientName}</dd></div>
            <div><dt className="text-slate-400"><StaffLabel en="Type / نوع الموعد"/></dt><dd className="mt-1 break-words font-semibold">{type}</dd></div>
            <div><dt className="text-slate-400"><StaffLabel en="Michigan time"/></dt><dd className="mt-1 font-semibold">{validWhen&&formattedWhen ? dateTime(formattedWhen.toISOString()) : "Choose date & time"}</dd></div>
            <div><dt className="text-slate-400"><StaffLabel en="Location"/></dt><dd className="mt-1 break-words font-semibold">{selectedSite ? `${selectedSite.name} · ${selectedSite.code}` : location || "Office / Not specified"}</dd></div>
          </dl>
          {selectedSite && <a href={warehouseMapUrl(selectedSite.address)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex rounded-xl border border-amber-300/40 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-300/10"><StaffLabel en="Google Maps · عرض الموقع"/></a>}
          <p className="mt-3 text-xs leading-6 text-amber-100" dir="rtl">يرجى الوصول قبل موعد المقابلة بنصف ساعة، وإحضار الوثائق الأصلية للمقابلة. نتمنى لكم التوفيق — بوابة التوظيف Career Gate.</p>
          <p className="mt-2 text-xs text-slate-300"><StaffLabel en="Approval confirms the booking in the database. Email notifications are queued for clients who have consented and provided a valid email; staff resource notices use the configured office email."/></p>
        </section>
      </Shell>
    </form>
  );
}

export function TaskForm({ clientId, onDone }: { clientId: string | null; onDone: () => void }) {
  const uiLabel = useStaffLabel();
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
      <Shell title={uiLabel("Add task")} testId="form-task" error={f.error} pending={f.pending} onCancel={onDone} submitLabel={uiLabel("Add task")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="task_title"><StaffLabel en="Title"/></label>
            <input id="task_title" required className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="task_desc"><StaffLabel en="Description"/></label>
            <textarea id="task_desc" rows={2} className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="task_assignee"><StaffLabel en="Assigned to"/></label>
            <RoyalSelect id="task_assignee" className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              {activeStaff.map((s) => <RoyalOption key={s.id} value={s.id}>{s.display_name}</RoyalOption>)}
            </RoyalSelect>
          </div>
          <div>
            <label className="label" htmlFor="task_due"><StaffLabel en="Due"/></label>
            <QuickDateTime ariaLabel="Due" value={due} onChange={setDue} />
          </div>
        </div>
      </Shell>
    </form>
  );
}

export function ContactedForm({ clientId, onDone }: FormProps) {
  const uiLabel = useStaffLabel();
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
      <Shell title={uiLabel("Mark contacted")} testId="form-contacted" error={f.error} pending={f.pending} onCancel={onDone} submitLabel={uiLabel("Save contact")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="contact_method"><StaffLabel en="Method"/></label>
            <RoyalSelect id="contact_method" className="input" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              {CONTACT_METHODS.map((m) => <RoyalOption labelAr={arabicStaffLabel(CONTACT_LABELS[m])} key={m} value={m}>{CONTACT_LABELS[m]}</RoyalOption>)}
            </RoyalSelect>
          </div>
          <div>
            <label className="label" htmlFor="contact_followup"><StaffLabel en="Follow-up date (optional)"/></label>
            <QuickDate ariaLabel="Follow-up date (optional)" min={todayInOffice()} value={followup} onChange={setFollowup} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="contact_result"><StaffLabel en="Result"/></label>
            <input id="contact_result" required className="input" placeholder={uiLabel("What actually happened")} value={result} onChange={(e) => setResult(e.target.value)} />
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
  const uiLabel = useStaffLabel();
  const f = useSubmit(onDone, "Follow-up added");
  const [due, setDue] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); f.submit({ action: "add_followup", client_id: clientId, due_date: due, reason }); }}>
      <Shell title={uiLabel("Add follow-up")} testId="form-followup" error={f.error} pending={f.pending} onCancel={onDone} submitLabel={uiLabel("Add follow-up")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="fu_due"><StaffLabel en="Due date"/></label>
            <QuickDate ariaLabel="Due date" value={due} onChange={setDue} required />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="fu_reason"><StaffLabel en="Reason"/></label>
            <input id="fu_reason" required className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
      </Shell>
    </form>
  );
}

export function StatusForm({ clientId, current, nextStep, onDone }: FormProps & { current: Status; nextStep: string }) {
  const uiLabel = useStaffLabel();
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
      <Shell title={uiLabel("Change status")} testId="form-status" error={f.error} pending={f.pending} onCancel={onDone} submitLabel={requiresOverride ? "Apply administrative status" : "Save status"}>
        <div className="rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2 text-xs text-slate-400"><StaffLabel en="Current:"/>{" "}<strong className="text-slate-200">{uiLabel(STATUS_LABELS[current])}</strong>
          {isAdmin && <span className="ml-2 text-amber-300/70"><StaffLabel en="All statuses available"/></span>}
        </div>
        {choices.length === 0 ? (
          <p className="text-sm text-slate-500"><StaffLabel en="No further status changes are allowed from"/>{" "}{uiLabel(STATUS_LABELS[current])}.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="st_status"><StaffLabel en="New status"/></label>
              <RoyalSelect id="st_status" className="input" value={status}
                onChange={(e) => { const s = e.target.value as Status; setStatus(s); setStep(DEFAULT_NEXT_STEP[s]); setReason(""); }}>
                {choices.map((s) => <RoyalOption labelAr={arabicStaffLabel(STATUS_LABELS[s])} key={s} value={s}>{STATUS_LABELS[s]}</RoyalOption>)}
              </RoyalSelect>
            </div>
            <div>
              <label className="label" htmlFor="st_next"><StaffLabel en="Next step"/></label>
              <input id="st_next" required className="input" value={step} onChange={(e) => setStep(e.target.value)} />
            </div>
          </div>
        )}
        {requiresOverride && (
          <div className="rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-3">
            <p className="mb-2 text-xs text-amber-100/70"><StaffLabel en="This status is outside the normal transition path. The reason is required and will be recorded in the activity log."/></p>
            <label className="label" htmlFor="st_reason"><StaffLabel en="Administrative reason"/></label>
            <input id="st_reason" required className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
      </Shell>
    </form>
  );
}

export function NextStepForm({ clientId, nextStep, onDone }: FormProps & { nextStep: string }) {
  const uiLabel = useStaffLabel();
  const f = useSubmit(onDone, "Next step saved");
  const [step, setStep] = useState(nextStep);
  return (
    <form onSubmit={(e) => { e.preventDefault(); f.submit({ action: "set_next_step", client_id: clientId, next_step: step }); }}>
      <Shell title={uiLabel("Set next step")} testId="form-next-step" error={f.error} pending={f.pending} onCancel={onDone} submitLabel={uiLabel("Save next step")}>
        <label className="label" htmlFor="ns_text"><StaffLabel en="Next step (shown to the client)"/></label>
        <input id="ns_text" required className="input" value={step} onChange={(e) => setStep(e.target.value)} />
      </Shell>
    </form>
  );
}

export function AssignForm({ clientId, current, onDone }: FormProps & { current: string | null }) {
  const uiLabel = useStaffLabel();
  const f = useSubmit(onDone, "Assignment saved");
  const { activeStaff } = useStaff();
  const [staffId, setStaffId] = useState(current ?? "");
  return (
    <form onSubmit={(e) => { e.preventDefault(); f.submit({ action: "assign_staff", client_id: clientId, staff_id: staffId || null }); }}>
      <Shell title={uiLabel("Assign staff")} testId="form-assign" error={f.error} pending={f.pending} onCancel={onDone} submitLabel={uiLabel("Save")}>
        <label className="label"><StaffLabel en="Handled by"/></label>
        <StaffPicker value={staffId} staff={activeStaff} onChange={setStaffId} disabled={f.pending} />
      </Shell>
    </form>
  );
}

export function DocumentForm({ clientId, onDone }: FormProps) {
  const uiLabel = useStaffLabel();
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
      <Shell title={uiLabel("Add document")} testId="form-document" error={error} pending={pending} onCancel={onDone} submitLabel={uiLabel("Upload")}>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="doc_type_sel"><StaffLabel en="Type"/></label>
            <RoyalSelect id="doc_type_sel" className="input" value={docType} onChange={(e) => setDocType(e.target.value as typeof docType)}>
              {DOC_TYPES.map((t) => <RoyalOption labelAr={arabicStaffLabel(DOC_LABELS[t])} key={t} value={t}>{DOC_LABELS[t]}</RoyalOption>)}
            </RoyalSelect>
          </div>
          <input aria-label={uiLabel("Document file")} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
            className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border file:border-white/[.08] file:bg-white/[.04] file:px-3 file:py-2 file:text-xs file:text-slate-300" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <p className="text-xs text-slate-500"><StaffLabel en="JPEG, PNG, WebP or PDF up to 4 MB. Stored privately; the original is never modified."/></p>
      </Shell>
    </form>
  );
}
