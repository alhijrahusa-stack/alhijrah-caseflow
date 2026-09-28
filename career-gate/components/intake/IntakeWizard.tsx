"use client";

import { useEffect, useRef, useState } from "react";
import { MultiSelect } from "@/components/forms/MultiSelect";
import { CityStep, JobStep, PreferenceSummary, ShiftStep, SiteStep } from "@/components/forms/PreferenceSteps";
import { emptyPrefs, toSelections, type PrefState } from "@/components/forms/preferences";
import {
  emptyProfile,
  employmentReady,
  personalReady,
  ProfileFields,
  profilePayload,
  type ProfileForm,
} from "@/components/forms/ProfileFields";
import { Button } from "@/components/ui/Button";
import { options } from "@/lib/catalog";
import { DOC_LABELS, DOC_MAX_BYTES, DOC_TYPES } from "@/lib/domain";
import {
  clearIntakeDraft,
  deleteIntakeDraftFile,
  loadIntakeDraft,
  putIntakeDraftFile,
  saveIntakeDraft,
} from "@/lib/intake-draft";
import { ACCURACY_DISCLAIMER, AUTHORIZATION_TEXT, AUTHORIZATION_VERSION, OFFICE } from "@/lib/office";

type UploadState = "SELECTED" | "PREPARING" | "UPLOADING" | "UPLOADED" | "FAILED" | "RETRYING";
type FlowState =
  | "LOCAL_DRAFT"
  | "SUBMISSION_PENDING"
  | "APPLICATION_CREATED"
  | "ATTACHMENT_PENDING"
  | "ATTACHMENT_UPLOADED"
  | "ATTACHMENT_FAILED"
  | "COMPLETED";

type PendingDoc = {
  id: string;
  doc_type: (typeof DOC_TYPES)[number];
  file: File;
  state: UploadState;
  error: string | null;
  serverId: string | null;
};

type Done = { ref: string; notifications: { channel: string; status: string }[] };
type ApplicationState = Done & { uploadToken: string };

type DraftSnapshot = {
  idempotencyKey: string;
  step: number;
  stateCode: "MI" | "";
  prefs: PrefState;
  profile: ProfileForm;
  docMeta: Array<Omit<PendingDoc, "file">>;
  consent: boolean;
  accepted: boolean;
  accuracy: boolean;
  printedName: string;
  signature: string;
  flowState: FlowState;
  application: ApplicationState | null;
};

const hasCatalog = options.length > 0;

type Step = { key: string; title: string };
const STEPS: Step[] = [
  { key: "state", title: "Michigan" },
  ...(hasCatalog
    ? [
        { key: "city", title: "City" },
        { key: "site", title: "Site" },
        { key: "job", title: "Job" },
        { key: "primary", title: "Primary shift" },
        { key: "backup", title: "Backup shift" },
        { key: "pay", title: "Pay" },
      ]
    : []),
  { key: "personal", title: "Personal information" },
  { key: "amazon", title: "Amazon history" },
  { key: "employment", title: "Employment history" },
  { key: "availability", title: "Appointment availability" },
  { key: "documents", title: "Documents" },
  { key: "review", title: "Review, authorization & signature" },
];

function sameName(a: string, b: string) {
  return a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
}

function uploadLabel(state: UploadState) {
  return state.replaceAll("_", " ");
}

function documentMetadata(rows: PendingDoc[]): DraftSnapshot["docMeta"] {
  return rows.map(({ id, doc_type, state, error, serverId }) => ({ id, doc_type, state, error, serverId }));
}

export function IntakeWizard() {
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState(0);
  const [stateCode, setStateCode] = useState<"MI" | "">("");
  const [prefs, setPrefs] = useState<PrefState>(emptyPrefs);
  const [profile, setProfile] = useState<ProfileForm>(emptyProfile);
  const [docs, setDocs] = useState<PendingDoc[]>([]);
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]>("photo_id");
  const [consent, setConsent] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [accuracy, setAccuracy] = useState(false);
  const [printedName, setPrintedName] = useState("");
  const [signature, setSignature] = useState("");
  const [website, setWebsite] = useState("");
  const [flowState, setFlowState] = useState<FlowState>("LOCAL_DRAFT");
  const [application, setApplication] = useState<ApplicationState | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const revisionRef = useRef<number | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  function snapshot(nextFlowState = flowState, nextApplication = application): DraftSnapshot {
    return {
      idempotencyKey,
      step,
      stateCode,
      prefs,
      profile,
      docMeta: documentMetadata(docs),
      consent,
      accepted,
      accuracy,
      printedName,
      signature,
      flowState: nextFlowState,
      application: nextApplication,
    };
  }

  async function persistDraft(next: DraftSnapshot) {
    const write = saveChainRef.current.then(async () => {
      revisionRef.current = await saveIntakeDraft(next, revisionRef.current);
    });
    saveChainRef.current = write.catch(() => undefined);
    await write;
  }

  useEffect(() => {
    let cancelled = false;
    loadIntakeDraft<DraftSnapshot>()
      .then((saved) => {
        if (cancelled || !saved) return;
        const d = saved.data;
        if (!d || typeof d !== "object" || !Array.isArray(d.docMeta)) return;
        const fileById = new Map(saved.files.map((f) => [f.id, f]));
        const restoredDocs: PendingDoc[] = [];
        for (const meta of d.docMeta) {
          const stored = fileById.get(meta.id);
          if (!stored || !(DOC_TYPES as readonly string[]).includes(stored.doc_type)) continue;
          restoredDocs.push({
            ...meta,
            doc_type: stored.doc_type as PendingDoc["doc_type"],
            file: stored.file,
            state: meta.state === "UPLOADED" ? "UPLOADED" : meta.state === "FAILED" ? "FAILED" : "SELECTED",
          });
        }
        setIdempotencyKey(d.idempotencyKey || crypto.randomUUID());
        setStep(Math.min(Math.max(Number(d.step) || 0, 0), STEPS.length - 1));
        setStateCode(d.stateCode === "MI" ? "MI" : "");
        setPrefs(d.prefs ?? emptyPrefs);
        setProfile(d.profile ?? emptyProfile);
        setDocs(restoredDocs);
        setConsent(Boolean(d.consent));
        setAccepted(Boolean(d.accepted));
        setAccuracy(Boolean(d.accuracy));
        setPrintedName(d.printedName ?? "");
        setSignature(d.signature ?? "");
        setFlowState(d.flowState === "COMPLETED" ? "LOCAL_DRAFT" : d.flowState ?? "LOCAL_DRAFT");
        setApplication(d.application ?? null);
        revisionRef.current = saved.revision;
        setDraftNotice("Saved application draft restored on this device.");
      })
      .catch((e) => setDraftNotice(e instanceof Error ? e.message : "Local draft recovery is unavailable."))
      .finally(() => { if (!cancelled) setDraftReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!draftReady || done) return;
    const timer = window.setTimeout(() => {
      void persistDraft(snapshot()).catch((e) => {
        setDraftNotice(e instanceof Error ? e.message : "Could not save the local draft.");
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [accepted, accuracy, application, consent, docs, done, draftReady, flowState, idempotencyKey, prefs, printedName, profile, signature, stateCode, step]);

  const current = STEPS[step];
  const ready: Record<string, boolean> = {
    state: stateCode === "MI",
    city: prefs.cities.length > 0,
    site: prefs.sites.length > 0,
    job: prefs.jobs.length > 0,
    primary: prefs.primary.length > 0,
    backup: true,
    pay: true,
    personal: personalReady(profile),
    amazon: profile.amazon_worked_before !== "" && profile.amazon_applied_before !== "",
    employment: employmentReady(profile),
    availability: profile.appointment_availability.trim().length > 0,
    documents: true,
    review: accepted && accuracy && printedName.trim().length >= 2 && sameName(signature, printedName),
  };

  function intakePayload() {
    return {
      state: "MI",
      profile: profilePayload(profile),
      primary: toSelections(prefs.primary),
      backup: toSelections(prefs.backup),
      communication_consent: consent,
      authorization: {
        version: AUTHORIZATION_VERSION,
        accepted,
        accuracy_acknowledged: accuracy,
        printed_name: printedName,
        signature,
      },
      website,
    };
  }

  async function createOrReplayApplication(): Promise<ApplicationState> {
    setFlowState("SUBMISSION_PENDING");
    setSubmitting(application ? "Renewing secure upload access…" : "Submitting application…");
    await persistDraft(snapshot("SUBMISSION_PENDING", application));
    const res = await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(intakePayload()),
    });
    const data = await res.json().catch(() => null);
    if (!data?.ok) throw new Error(data?.error?.message ?? `Submission failed (${res.status})`);
    const next: ApplicationState = {
      ref: String(data.ref),
      uploadToken: String(data.upload_token),
      notifications: Array.isArray(data.notifications) ? data.notifications : application?.notifications ?? [],
    };
    setApplication(next);
    setFlowState("APPLICATION_CREATED");
    await persistDraft(snapshot("APPLICATION_CREATED", next));
    return next;
  }

  function patchDoc(id: string, patch: Partial<Omit<PendingDoc, "id" | "file" | "doc_type">>) {
    setDocs((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  async function uploadOne(doc: PendingDoc, uploadToken: string, retry: boolean) {
    patchDoc(doc.id, { state: retry ? "RETRYING" : "PREPARING", error: null });
    await Promise.resolve();
    patchDoc(doc.id, { state: "UPLOADING" });
    const form = new FormData();
    form.set("upload_token", uploadToken);
    form.set("upload_id", doc.id);
    form.set("doc_type", doc.doc_type);
    form.set("file", doc.file);
    const response = await fetch("/api/intake/documents", { method: "POST", body: form });
    const payload = await response.json().catch(() => null);
    if (!payload?.ok) {
      const message = payload?.error?.message ?? `Upload failed (${response.status})`;
      patchDoc(doc.id, { state: "FAILED", error: message });
      return { ok: false as const, error: message };
    }
    patchDoc(doc.id, { state: "UPLOADED", error: null, serverId: String(payload.id) });
    return { ok: true as const };
  }

  async function uploadPending(targetDocs: PendingDoc[], app: ApplicationState, retry: boolean) {
    if (targetDocs.length === 0) return true;
    setFlowState("ATTACHMENT_PENDING");
    let allOk = true;
    for (const [index, doc] of targetDocs.entries()) {
      setSubmitting(`${retry ? "Retrying" : "Uploading"} document ${index + 1} of ${targetDocs.length}…`);
      const result = await uploadOne(doc, app.uploadToken, retry);
      if (!result.ok) allOk = false;
    }
    setFlowState(allOk ? "ATTACHMENT_UPLOADED" : "ATTACHMENT_FAILED");
    return allOk;
  }

  async function completeApplication(app: ApplicationState) {
    setFlowState("COMPLETED");
    setDone({ ref: app.ref, notifications: app.notifications });
    await clearIntakeDraft().catch((e) => setDraftNotice(e instanceof Error ? e.message : "Could not clear the completed local draft."));
    revisionRef.current = null;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    setError(null);
    try {
      const app = await createOrReplayApplication();
      const targets = docs.filter((d) => d.state !== "UPLOADED");
      const uploaded = await uploadPending(targets, app, false);
      if (uploaded) await completeApplication(app);
      else setError("Your application was saved, but one or more selected documents did not finish uploading. Retry the failed documents below; the application will not be submitted again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
      if (!application) setFlowState("LOCAL_DRAFT");
    } finally {
      setSubmitting(null);
    }
  }

  async function retryFailed() {
    setError(null);
    try {
      const app = await createOrReplayApplication();
      const targets = docs.filter((d) => d.state !== "UPLOADED");
      const uploaded = await uploadPending(targets, app, true);
      if (uploaded) await completeApplication(app);
      else setError("Some documents still could not be uploaded. Your application remains saved and the failed documents remain available for another retry.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Document retry failed");
    } finally {
      setSubmitting(null);
    }
  }

  async function addFile(file: File) {
    if (submitting) return;
    if (file.size > DOC_MAX_BYTES) {
      setError(`${file.name} is larger than 4 MB`);
      return;
    }
    if (docs.length >= 10) {
      setError("You can attach up to 10 documents.");
      return;
    }
    const id = crypto.randomUUID();
    try {
      await putIntakeDraftFile(id, docType, file);
      setDocs((rows) => [...rows, { id, doc_type: docType, file, state: "SELECTED", error: null, serverId: null }]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The selected document could not be saved locally.");
    }
  }

  async function removeFile(id: string) {
    if (submitting) return;
    const doc = docs.find((d) => d.id === id);
    if (!doc || doc.state === "UPLOADING" || doc.state === "UPLOADED") return;
    try {
      await deleteIntakeDraftFile(id);
      setDocs((rows) => rows.filter((row) => row.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The document could not be removed from the local draft.");
    }
  }

  if (done) {
    return (
      <section className="cg-intake-card space-y-5 p-6 sm:p-8" data-testid="submit-result">
        <div className="cg-intake-success-mark">✓</div>
        <div>
          <p className="text-xl font-semibold text-slate-950">Career Gate has received your employment request.</p>
          <p className="mt-2 text-sm text-slate-600">Your application and all selected documents were saved successfully.</p>
        </div>
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          Reference: <strong data-testid="reference" className="font-mono">{done.ref}</strong>
        </p>
        {done.notifications.some((n) => n.status === "queued") ? (
          <p className="text-sm text-slate-500" data-testid="confirmation-state">A confirmation message is being sent to the contact details you gave.</p>
        ) : (
          <p className="text-sm text-slate-500" data-testid="confirmation-state">Please keep your reference number for status tracking.</p>
        )}
        <a href={`/status?ref=${encodeURIComponent(done.ref)}`} className="inline-flex rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700">
          Track Status
        </a>
      </section>
    );
  }

  return (
    <section className="cg-intake-card overflow-hidden">
      <header className="cg-intake-header px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">Career Gate Application</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">{current.title}</h2>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-slate-500">Step {step + 1} of {STEPS.length}</p>
            <p className="mt-1 text-[11px] font-semibold tracking-wide text-slate-400" data-testid="flow-state">{flowState.replaceAll("_", " ")}</p>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
          <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300 ease-out" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </header>

      <div className="space-y-5 p-5 sm:p-7">
        {draftNotice && <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" aria-live="polite">{draftNotice}</p>}
        {current.key === "state" && (
          <>
            <MultiSelect name="State" value={stateCode ? [stateCode] : []} onChange={(v) => setStateCode(v.includes("MI") ? "MI" : "")}
              choices={[{ value: "MI", label: "Michigan", hint: "Career Gate currently operates in Michigan." }]} />
            {!hasCatalog && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                No job openings are listed right now. You can still send your information and the office will contact you when a position is available.
              </p>
            )}
          </>
        )}
        {current.key === "city" && <CityStep value={prefs} onChange={setPrefs} />}
        {current.key === "site" && <SiteStep value={prefs} onChange={setPrefs} />}
        {current.key === "job" && <JobStep value={prefs} onChange={setPrefs} />}
        {current.key === "primary" && (
          <>
            <p className="text-sm text-slate-600">Choose the shifts you want most, in order of preference.</p>
            <ShiftStep rank="primary" value={prefs} onChange={setPrefs} />
          </>
        )}
        {current.key === "backup" && (
          <>
            <p className="text-sm text-slate-600">Optional: shifts you would also accept if your primary choices are not available.</p>
            <ShiftStep rank="backup" value={prefs} onChange={setPrefs} />
          </>
        )}
        {current.key === "pay" && (
          <>
            <p className="text-sm text-slate-600">Pay shown is exactly as listed for each site, job and shift.</p>
            <PreferenceSummary value={prefs} />
          </>
        )}
        {current.key === "personal" && <ProfileFields section="personal" value={profile} onChange={setProfile} />}
        {current.key === "amazon" && <ProfileFields section="amazon" value={profile} onChange={setProfile} />}
        {current.key === "employment" && <ProfileFields section="employment" value={profile} onChange={setProfile} />}
        {current.key === "availability" && <ProfileFields section="availability" value={profile} onChange={setProfile} />}
        {current.key === "documents" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-sm font-medium text-slate-800">Supporting documents</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Optional until selected. JPEG, PNG, WebP or PDF, up to 4 MB each. Selected files stay in your local draft until server storage confirms them.</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-52 flex-1">
                <label className="label" htmlFor="doc_type">Document type</label>
                <select id="doc_type" className="input" value={docType} onChange={(e) => setDocType(e.target.value as typeof docType)} disabled={Boolean(submitting)}>
                  {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_LABELS[t]}</option>)}
                </select>
              </div>
              <label className="cg-file-button">
                <span>Choose document</span>
                <input
                  aria-label="Choose file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="sr-only"
                  disabled={Boolean(submitting)}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void addFile(file);
                  }}
                />
              </label>
            </div>
            {docs.length > 0 && (
              <ul className="space-y-2 text-sm" data-testid="document-list">
                {docs.map((doc) => (
                  <li key={doc.id} className="cg-document-row">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-800">{DOC_LABELS[doc.doc_type]} — {doc.file.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={`cg-upload-state cg-upload-${doc.state.toLowerCase()}`}>{uploadLabel(doc.state)}</span>
                        <span className="text-xs text-slate-400">{Math.ceil(doc.file.size / 1024)} KB</span>
                      </div>
                      {doc.error && <p className="mt-1 text-xs text-red-600">{doc.error}</p>}
                    </div>
                    {doc.state !== "UPLOADED" && doc.state !== "UPLOADING" && (
                      <button type="button" disabled={Boolean(submitting)} className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50" onClick={() => void removeFile(doc.id)}>Remove</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {current.key === "review" && (
          <div className="space-y-5">
            {hasCatalog && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Job preferences</h3>
                <PreferenceSummary value={prefs} />
              </div>
            )}
            <dl className="grid grid-cols-3 gap-y-1 text-sm">
              <dt className="text-slate-500">Name</dt><dd className="col-span-2">{profile.full_name}</dd>
              <dt className="text-slate-500">Phone</dt><dd className="col-span-2">{profile.phone}</dd>
              <dt className="text-slate-500">Email</dt><dd className="col-span-2">{profile.email || "—"}</dd>
              <dt className="text-slate-500">Documents</dt><dd className="col-span-2">{docs.length}</dd>
            </dl>

            <div className="whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed" data-testid="authorization-text">
              {AUTHORIZATION_TEXT}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="printed_name">Printed Name</label>
                <input id="printed_name" className="input" value={printedName} onChange={(e) => setPrintedName(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="signature">Signature (type your printed name)</label>
                <input id="signature" className="input font-serif italic" value={signature} onChange={(e) => setSignature(e.target.value)} />
              </div>
            </div>
            {signature && printedName && !sameName(signature, printedName) && (
              <p className="text-sm text-amber-700">Signature must match your printed name.</p>
            )}
            <p className="text-sm text-slate-600">Date: recorded by the server when you submit.</p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <span>I have read and agree to the Acknowledgment &amp; Authorization above.</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={accuracy} onChange={(e) => setAccuracy(e.target.checked)} />
              <span>{ACCURACY_DISCLAIMER}</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{OFFICE.company} may contact me about this request by phone, WhatsApp or email.</span>
            </label>
          </div>
        )}

        <input tabIndex={-1} aria-hidden="true" autoComplete="off" className="hidden" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />

        {application && flowState === "ATTACHMENT_FAILED" && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4" data-testid="attachment-retry-panel">
            <p className="text-sm font-semibold text-amber-950">Application saved — document upload incomplete</p>
            <p className="mt-1 text-xs text-amber-800">Reference: <span className="font-mono font-semibold">{application.ref}</span>. Retrying will reuse this application and the same document upload IDs.</p>
            <button type="button" disabled={Boolean(submitting)} onClick={() => void retryFailed()} className="mt-3 rounded-lg bg-amber-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
              Retry failed documents
            </button>
          </div>
        )}
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {submitting && <p className="text-sm font-medium text-slate-600" aria-live="polite">{submitting}</p>}
      </div>

      <footer className="flex justify-between border-t border-slate-200/80 bg-slate-50/60 px-5 py-4 sm:px-7">
        <Button variant="ghost" disabled={step === 0 || Boolean(submitting)} onClick={() => { setError(null); setStep((s) => s - 1); }}>
          Back
        </Button>
        {step === STEPS.length - 1 ? (
          flowState === "ATTACHMENT_FAILED" ? (
            <Button disabled={Boolean(submitting)} onClick={() => void retryFailed()}>Retry documents</Button>
          ) : (
            <Button disabled={!ready.review || Boolean(submitting)} onClick={() => void submit()}>Submit</Button>
          )
        ) : (
          <Button disabled={!ready[current.key]} onClick={() => { setError(null); setStep((s) => s + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            Next
          </Button>
        )}
      </footer>
    </section>
  );
}
