"use client";

import { useState } from "react";
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
import { ACCURACY_DISCLAIMER, AUTHORIZATION_TEXT, AUTHORIZATION_VERSION, OFFICE } from "@/lib/office";

type PendingDoc = { id: string; doc_type: (typeof DOC_TYPES)[number]; file: File };
type Done = { ref: string; status_url: string; failed: { name: string; error: string }[] };

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
  { key: "documents", title: "Documents" },
  { key: "review", title: "Review, authorization & signature" },
];

export function IntakeWizard() {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
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
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const current = STEPS[step];
  const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

  const ready: Record<string, boolean> = {
    state: stateCode === "MI",
    city: prefs.cities.length > 0,
    site: prefs.sites.length > 0,
    job: prefs.jobs.length > 0,
    primary: prefs.primary.length > 0,
    backup: true,
    pay: true,
    personal: personalReady(profile) && employmentReady(profile),
    documents: true,
    review: accepted && accuracy && printedName.trim().length >= 2 && sameName(signature, printedName),
  };

  async function submit() {
    setSubmitting("Submitting application…");
    setError(null);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
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
        }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok) throw new Error(data?.error?.message ?? `Submission failed (${res.status})`);

      const failed: Done["failed"] = [];
      for (const [i, d] of docs.entries()) {
        setSubmitting(`Uploading document ${i + 1} of ${docs.length}…`);
        const form = new FormData();
        form.set("ref", data.ref);
        form.set("token", data.upload_token ?? new URL(data.status_url).searchParams.get("t") ?? "");
        form.set("doc_type", d.doc_type);
        form.set("file", d.file);
        const up = await fetch("/api/intake/documents", { method: "POST", body: form });
        const upData = await up.json().catch(() => null);
        if (!upData?.ok) failed.push({ name: d.file.name, error: upData?.error?.message ?? `Upload failed (${up.status})` });
      }
      setDone({ ref: data.ref, status_url: data.status_url, failed });
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(null);
    }
  }

  if (done) {
    return (
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6" data-testid="submit-result">
        <p className="text-lg font-semibold">Career Gate has received your employment request.</p>
        <p>
          Reference: <strong data-testid="reference" className="font-mono">{done.ref}</strong>
        </p>
        <p>We will contact you regarding the next available step.</p>
        {done.failed.length > 0 && (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">These documents did not upload. Please bring or send them to the office:</p>
            <ul className="mt-1 list-disc pl-5">
              {done.failed.map((f) => <li key={f.name}>{f.name}: {f.error}</li>)}
            </ul>
          </div>
        )}
        <p className="text-sm text-slate-500">Save this link — it is the only way to see your status online.</p>
        <a href={done.status_url} className="inline-flex rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Track Status
        </a>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-5 py-4">
        <p className="text-xs text-slate-500">Step {step + 1} of {STEPS.length}</p>
        <h2 className="text-lg font-semibold">{current.title}</h2>
        <div className="mt-3 h-1 overflow-hidden rounded bg-slate-100">
          <div className="h-full bg-brand-600 transition-all duration-200" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </header>

      <div className="space-y-4 p-5">
        {current.key === "state" && (
          <>
            <MultiSelect name="State" value={stateCode ? [stateCode] : []} onChange={(v) => setStateCode(v.includes("MI") ? "MI" : "")}
              choices={[{ value: "MI", label: "Michigan", hint: "Career Gate currently operates in Michigan." }]} />
            {!hasCatalog && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
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
        {current.key === "personal" && <ProfileFields value={profile} onChange={setProfile} />}
        {current.key === "documents" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Optional. JPEG, PNG, WebP or PDF, up to 4 MB each. Do not upload Amazon passwords.</p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="label" htmlFor="doc_type">Document type</label>
                <select id="doc_type" className="input" value={docType} onChange={(e) => setDocType(e.target.value as typeof docType)}>
                  {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_LABELS[t]}</option>)}
                </select>
              </div>
              <input
                aria-label="Choose file"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (f.size > DOC_MAX_BYTES) return setError(`${f.name} is larger than 4 MB`);
                  setError(null);
                  setDocs((d) => [...d, { id: crypto.randomUUID(), doc_type: docType, file: f }].slice(0, 10));
                }}
              />
            </div>
            {docs.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between px-4 py-2">
                    <span>{DOC_LABELS[d.doc_type]} — {d.file.name}</span>
                    <button type="button" className="text-red-600 hover:underline" onClick={() => setDocs((x) => x.filter((y) => y.id !== d.id))}>Remove</button>
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

            <div className="whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed" data-testid="authorization-text">
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
              <span>
                {OFFICE.company} may contact me about this request by phone, WhatsApp or email.
              </span>
            </label>
          </div>
        )}

        <input tabIndex={-1} aria-hidden="true" autoComplete="off" className="hidden" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {submitting && <p className="text-sm text-slate-600" aria-live="polite">{submitting}</p>}
      </div>

      <footer className="flex justify-between border-t border-slate-100 px-5 py-4">
        <Button variant="ghost" disabled={step === 0 || Boolean(submitting)} onClick={() => { setError(null); setStep((s) => s - 1); }}>
          Back
        </Button>
        {step === STEPS.length - 1 ? (
          <Button disabled={!ready.review || Boolean(submitting)} onClick={submit}>Submit</Button>
        ) : (
          <Button disabled={!ready[current.key]} onClick={() => { setError(null); setStep((s) => s + 1); window.scrollTo({ top: 0 }); }}>
            Next
          </Button>
        )}
      </footer>
    </section>
  );
}
