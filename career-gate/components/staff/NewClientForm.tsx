"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAction } from "@/components/forms/useAction";
import { CityStep, JobStep, PreferenceSummary, ShiftStep, SiteStep } from "@/components/forms/PreferenceSteps";
import { emptyPrefs, toSelections, type PrefState } from "@/components/forms/preferences";
import { emptyProfile, ProfileFields, profilePayload, type ProfileForm } from "@/components/forms/ProfileFields";
import { StaffPicker } from "@/components/staff/StaffPicker";
import { useStaff } from "@/components/staff/StaffContext";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { options } from "@/lib/catalog";
import { DEFAULT_NEXT_STEP, DOC_LABELS, DOC_MAX_BYTES, DOC_TYPES, ENTRY_STATUSES, STATUS_LABELS, type Status } from "@/lib/domain";

type PendingDoc = { id: string; doc_type: (typeof DOC_TYPES)[number]; file: File };
type Draft = {
  profile: ProfileForm;
  prefs: PrefState;
  status: Status;
  nextStep: string;
  note: string;
  consent: boolean;
  assigned: string;
};

const DRAFT_KEY = "career-gate:new-client-draft";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[.08] bg-white/[.028] shadow-[inset_0_1px_0_rgba(255,255,255,.025),0_18px_48px_rgba(0,0,0,.12)] backdrop-blur-xl">
      <h2 className="border-b border-white/[.06] px-5 py-3 text-sm font-semibold text-slate-200">{title}</h2>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

export function NewClientForm() {
  const router = useRouter();
  const { run, pending, error } = useAction({ successMessage: null });
  const { activeStaff, me } = useStaff();
  const toast = useToast();
  const [assigned, setAssigned] = useState(me.role === "staff" ? me.id : "");
  const [fileError, setFileError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile);
  const [prefs, setPrefs] = useState<PrefState>(emptyPrefs);
  const [status, setStatus] = useState<Status>("new_intake");
  const [nextStep, setNextStep] = useState(DEFAULT_NEXT_STEP.new_intake);
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [docs, setDocs] = useState<PendingDoc[]>([]);
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]>("photo_id");
  const [progress, setProgress] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<"idle" | "restored" | "saved">("idle");

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as Draft;
      if (!draft?.profile || !draft?.prefs) return;
      setProfile(draft.profile);
      setPrefs(draft.prefs);
      setStatus(draft.status);
      setNextStep(draft.nextStep);
      setNote(draft.note);
      setConsent(draft.consent);
      setAssigned(draft.assigned);
      setDraftState("restored");
    } catch {
      sessionStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const draft: Draft = { profile, prefs, status, nextStep, note, consent, assigned };
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        setDraftState("saved");
      } catch {
        // Temporary browser draft is non-authoritative; server save remains authoritative.
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [profile, prefs, status, nextStep, note, consent, assigned]);

  async function save() {
    const res = await run({
      action: "create_client",
      assigned_staff: assigned || null,
      profile: profilePayload(profile),
      primary: toSelections(prefs.primary),
      backup: toSelections(prefs.backup),
      status,
      next_step: nextStep,
      initial_note: note || null,
      communication_consent: consent,
    });
    if (!res) return;
    const clientId = res.client_id as string;
    const failed: string[] = [];
    for (const [i, d] of docs.entries()) {
      setProgress(`Uploading document ${i + 1} of ${docs.length}…`);
      const form = new FormData();
      form.set("client_id", clientId);
      form.set("doc_type", d.doc_type);
      form.set("file", d.file);
      const up = await fetch("/api/staff/documents", { method: "POST", body: form });
      const data = await up.json().catch(() => null);
      if (!data?.ok) failed.push(`${d.file.name}: ${data?.error?.message ?? up.status}`);
    }
    setProgress(null);
    sessionStorage.removeItem(DRAFT_KEY);
    toast(failed.length ? "warning" : "success", failed.length ? `Client ${res.ref} created; ${failed.length} document(s) failed` : `Client ${res.ref} created`);
    const q = failed.length ? `?upload_failed=${encodeURIComponent(failed.join("; "))}` : "";
    router.push(`/staff/client/${clientId}${q}`);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Section title="Personal information"><ProfileFields section="personal" value={profile} onChange={setProfile} /></Section>
        <Section title="Amazon history"><ProfileFields section="amazon" value={profile} onChange={setProfile} /></Section>
        <Section title="Employment history"><ProfileFields section="employment" value={profile} onChange={setProfile} /></Section>
        <Section title="Appointment availability"><ProfileFields section="availability" value={profile} onChange={setProfile} /></Section>
      </div>
      <div className="space-y-6">
        <Section title="Job preferences">
          {options.length === 0 ? (
            <p className="text-sm text-slate-500">The job catalog has no active options. Preferences can be added once data/job-catalog.json lists them.</p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <div data-testid="pref-city"><p className="label">City</p><CityStep value={prefs} onChange={setPrefs} /></div>
                <div data-testid="pref-site"><p className="label">Site</p><SiteStep value={prefs} onChange={setPrefs} /></div>
                <div data-testid="pref-job"><p className="label">Job</p><JobStep value={prefs} onChange={setPrefs} /></div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div data-testid="pref-primary"><p className="label">Primary shifts</p><ShiftStep rank="primary" value={prefs} onChange={setPrefs} /></div>
                <div data-testid="pref-backup"><p className="label">Backup shifts</p><ShiftStep rank="backup" value={prefs} onChange={setPrefs} /></div>
              </div>
              <PreferenceSummary value={prefs} />
            </>
          )}
        </Section>
        <Section title="Documents">
          <div className="flex flex-wrap items-end gap-2">
            <select aria-label="Document type" className="input w-56" value={docType} onChange={(e) => setDocType(e.target.value as typeof docType)}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_LABELS[t]}</option>)}
            </select>
            <input aria-label="Choose file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border file:border-white/[.08] file:bg-white/[.04] file:px-3 file:py-2 file:text-xs file:text-slate-300"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (f.size > DOC_MAX_BYTES) return setFileError(`${f.name} is larger than 4 MB`);
                setFileError(null);
                setDocs((d) => [...d, { id: crypto.randomUUID(), doc_type: docType, file: f }]);
              }} />
          </div>
          {docs.map((d) => (
            <p key={d.id} className="flex justify-between text-sm text-slate-300">
              <span>{DOC_LABELS[d.doc_type]} — {d.file.name}</span>
              <button type="button" className="text-red-400" onClick={() => setDocs((x) => x.filter((y) => y.id !== d.id))}>Remove</button>
            </p>
          ))}
        </Section>
        <Section title="Status, next step and notes">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="nc_status">Initial status</label>
              <select id="nc_status" className="input" value={status}
                onChange={(e) => {
                  const s = e.target.value as Status;
                  if (nextStep === DEFAULT_NEXT_STEP[status]) setNextStep(DEFAULT_NEXT_STEP[s]);
                  setStatus(s);
                }}>
                {ENTRY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="nc_next">Next step</label>
              <input id="nc_next" className="input" value={nextStep} onChange={(e) => setNextStep(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Assigned staff (Handled By)</label>
            <StaffPicker value={assigned} staff={activeStaff} onChange={setAssigned} disabled={pending} />
          </div>
          <div>
            <label className="label" htmlFor="nc_note">Initial note</label>
            <textarea id="nc_note" rows={3} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            Client agreed to be contacted by phone, WhatsApp or email
          </label>
          <p className="text-[10px] text-slate-600" aria-live="polite">
            {draftState === "restored" ? "Temporary browser draft restored." : draftState === "saved" ? "Temporary browser draft saved." : ""}
          </p>
        </Section>
        {(error || fileError) && <p role="alert" className="text-sm text-red-400">{error ?? fileError}</p>}
        {progress && <p className="text-sm text-slate-400">{progress}</p>}
        <Button onClick={save} disabled={pending || Boolean(progress)} className="w-full">
          {pending ? "Saving…" : "Create client file"}
        </Button>
      </div>
    </div>
  );
}
