"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { extractDeterministicClient } from "@/lib/smart-client-local";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

type Stage = "DRAFT" | "CAPTURING" | "SUBMITTED" | "PROCESSING" | "REVIEW_REQUIRED" | "READY" | "FAILED";
type SubmitResult = {
  case_id: string;
  case_number: string;
  created_at: string;
  uploaded_by_name: string;
  mapped_draft?: { profile?: Record<string, unknown> };
  verification_result?: Record<string, unknown>;
  enrichment_url?: string;
  acceptance_duration_ms?: number;
};

type FieldEvidence = { field_key: string; value: string; strength: "HIGH" | "MEDIUM" | "REVIEW"; verification_state: string };

const FIELD_LABELS: Record<string, string> = {
  full_name: "Full Name", phone: "Phone", email: "Email", date_of_birth: "Date of Birth",
  street: "Street", city: "City", state: "State", zip: "ZIP", preferred_language: "Language",
  appointment_availability: "Availability", site_code: "Site", job_id: "Job", shift_code: "Shift",
};

const surface = "rounded-[10px] border border-white/[.09] bg-[#07101d]/72 shadow-[0_18px_48px_-30px_rgba(0,0,0,.9),inset_0_1px_0_rgba(255,255,255,.04)] backdrop-blur-md";
const subSurface = "rounded-lg border border-white/[.075] bg-[#040a13]/72";
const control = "rounded-md border border-white/[.09] bg-[#030812]/88 transition-[border-color,background-color,box-shadow] duration-150 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F2FE]/45";

function fmtBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtElapsed(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function stageTone(stage: Stage) {
  if (stage === "READY") return "border-emerald-300/25 bg-emerald-300/[.07] text-emerald-200";
  if (stage === "REVIEW_REQUIRED") return "border-amber-300/25 bg-amber-300/[.07] text-amber-200";
  if (stage === "FAILED") return "border-red-300/25 bg-red-300/[.07] text-red-200";
  if (["CAPTURING", "PROCESSING"].includes(stage)) return "border-[#00F2FE]/30 bg-[#00F2FE]/[.065] text-[#8cf8ff]";
  if (stage === "SUBMITTED") return "border-emerald-300/20 bg-emerald-300/[.05] text-emerald-200";
  return "border-white/10 bg-white/[.02] text-slate-400";
}

function pipelineTone(state: string) {
  if (state === "COMPLETE" || state === "SUBMITTED") return "bg-emerald-300 text-emerald-200";
  if (state === "RUNNING" || state === "PROCESSING" || state === "QUEUED") return "bg-[#00F2FE] text-[#8cf8ff]";
  if (state === "REVIEW REQUIRED") return "bg-amber-300 text-amber-200";
  if (state === "FAILED") return "bg-red-300 text-red-200";
  return "bg-slate-700 text-slate-500";
}

function Meta({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "cyan" | "gold" }) {
  const valueTone = tone === "cyan" ? "text-[#8cf8ff]" : tone === "gold" ? "text-[#d4b06a]" : "text-slate-200";
  return <div className="min-w-0"><div className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600">{label}</div><div className={`mt-1 truncate font-mono text-[11px] tabular-nums ${valueTone}`}>{value}</div></div>;
}

export function ExecutiveSmartImportForm({ staff }: { staff: { display_name: string } }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const sessionStart = useRef(Date.now());
  const idempotencyKey = useRef(crypto.randomUUID());
  const completionTimer = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<Stage>("DRAFT");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [serverDraft, setServerDraft] = useState<Record<string, unknown> | null>(null);
  const [verification, setVerification] = useState<Record<string, unknown> | null>(null);
  const [completionPulse, setCompletionPulse] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const deferredNotes = useDeferredValue(notes);
  const local = useMemo(() => extractDeterministicClient(deferredNotes), [deferredNotes]);
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const busy = stage === "CAPTURING" || stage === "PROCESSING";
  const submitted = Boolean(result);
  const extracted = serverDraft ?? local.row;
  const localEvidence = local.evidence as FieldEvidence[];
  const extractedEntries = Object.entries(extracted).filter(([key, value]) => key in FIELD_LABELS && text(value));
  const extractionErrors = Array.isArray(verification?.extraction_errors) ? verification.extraction_errors : [];
  const aiState = text(verification?.ai_state) || (files.length ? "WAITING" : "NOT REQUIRED");
  const outboxState = text(verification?.outbox_state) || (files.length ? "WAITING" : "NOT REQUIRED");
  const processingState = text(verification?.processing_state) || (submitted ? "SUBMITTED" : "DRAFT");

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - sessionStart.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (completionTimer.current) window.clearTimeout(completionTimer.current);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
        return;
      }
      if (event.key === "Escape" && commandOpen) {
        event.preventDefault();
        setCommandOpen(false);
        return;
      }
      if (meta && event.key === "Enter" && !commandOpen) {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandOpen, notes, files, result, stage]);

  useEffect(() => {
    if (!commandOpen) {
      previousFocus.current?.focus?.();
      return;
    }
    previousFocus.current = document.activeElement as HTMLElement | null;
    const panel = commandRef.current;
    const first = panel?.querySelector<HTMLElement>("button,[href],[tabindex]:not([tabindex='-1'])");
    first?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>("button,[href],[tabindex]:not([tabindex='-1'])"));
      if (!focusables.length) return;
      const firstItem = focusables[0];
      const lastItem = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [commandOpen]);

  useEffect(() => {
    if (!result?.case_id || files.length === 0) return;
    let source: EventSource | null = null;
    let stopped = false;
    const refresh = async () => {
      const res = await fetch(`/api/staff/smart-client-import?id=${encodeURIComponent(result.case_id)}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) return;
      const caseData = data.case ?? data.data?.case;
      if (!caseData) return;
      setServerDraft(caseData.mapped_draft?.profile ?? null);
      setVerification(caseData.verification_result ?? null);
      const state = text(caseData.verification_result?.processing_state);
      if (state === "REVIEW_REQUIRED") setStage("REVIEW_REQUIRED");
      else if (["EXTRACTED", "VERIFIED"].includes(state)) setStage("READY");
    };
    source = new EventSource(`/api/staff/smart-client-import/${result.case_id}/stream`);
    source.onmessage = () => { if (!stopped) void refresh(); };
    source.onerror = () => { source?.close(); if (!stopped) window.setTimeout(() => void refresh(), 800); };
    return () => { stopped = true; source?.close(); };
  }, [result?.case_id, files.length]);

  function flashCompletion() {
    setCompletionPulse(false);
    window.requestAnimationFrame(() => setCompletionPulse(true));
    if (completionTimer.current) window.clearTimeout(completionTimer.current);
    completionTimer.current = window.setTimeout(() => setCompletionPulse(false), 900);
  }

  function addFiles(list: FileList | null) {
    if (!list || busy || submitted) return;
    const next = [...files, ...Array.from(list)].slice(0, MAX_FILES);
    const bytes = next.reduce((sum, file) => sum + file.size, 0);
    if (bytes > MAX_TOTAL_BYTES) { setError("Files exceed the 25 MB total limit."); return; }
    setFiles(next);
    setError(null);
  }

  async function submit() {
    if (busy || submitted || (!notes.trim() && files.length === 0)) return;
    setStage("CAPTURING");
    setError(null);
    try {
      const form = new FormData();
      form.set("notes", notes.trim());
      for (const file of files) form.append("files", file, file.name);
      const res = await fetch("/api/staff/smart-client-import/mobile", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey.current },
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (res.status !== 202 || !data?.ok) throw new Error(data?.error?.message ?? `Submission failed (${res.status})`);
      const captured: SubmitResult = {
        case_id: data.case_id,
        case_number: data.case_number,
        created_at: data.created_at,
        uploaded_by_name: data.uploaded_by_name ?? staff.display_name,
        mapped_draft: data.mapped_draft,
        verification_result: data.verification_result,
        enrichment_url: data.enrichment_url,
        acceptance_duration_ms: data.acceptance_duration_ms,
      };
      setResult(captured);
      setServerDraft(data.mapped_draft?.profile ?? null);
      setVerification(data.verification_result ?? null);
      setStage(files.length ? "PROCESSING" : "SUBMITTED");
      flashCompletion();
      if (!files.length) window.setTimeout(() => setStage("READY"), 180);
    } catch (e) {
      setStage("FAILED");
      setError(e instanceof Error ? e.message : "Submission failed");
    }
  }

  async function retryExtraction() {
    if (!result?.enrichment_url || busy) return;
    setStage("PROCESSING");
    setError(null);
    try {
      const res = await fetch(result.enrichment_url, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Extraction retry failed (${res.status})`);
      setServerDraft(data.mapped_draft?.profile ?? null);
      setVerification(data.verification_result ?? null);
      setStage(data.verification_result?.processing_state === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "READY");
      flashCompletion();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction retry failed");
      setStage("REVIEW_REQUIRED");
    }
  }

  function reset() {
    setFiles([]); setNotes(""); setError(null); setResult(null); setServerDraft(null); setVerification(null); setStage("DRAFT"); setCompletionPulse(false);
    sessionStart.current = Date.now(); idempotencyKey.current = crypto.randomUUID(); setElapsed(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  const pipeline = [
    ["CAPTURE", submitted ? "COMPLETE" : stage === "CAPTURING" ? "RUNNING" : "WAITING"],
    ["LOCAL EXTRACTION", localEvidence.length ? "COMPLETE" : notes.trim() ? "REVIEW REQUIRED" : "WAITING"],
    ["DOCUMENT OCR", files.length ? (aiState === "FAILED" ? "FAILED" : aiState === "COMPLETE" ? "COMPLETE" : aiState === "PARTIAL" ? "REVIEW REQUIRED" : submitted ? "PROCESSING" : "WAITING") : "NOT REQUIRED"],
    ["AI ENRICHMENT", files.length ? (aiState === "FAILED" ? "FAILED" : aiState === "COMPLETE" ? "COMPLETE" : aiState === "PARTIAL" ? "REVIEW REQUIRED" : submitted ? "PROCESSING" : "WAITING") : "NOT REQUIRED"],
    ["STAGING", submitted ? "COMPLETE" : "WAITING"],
  ] as const;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#03060d] px-3 py-4 text-slate-200 sm:px-4 lg:px-6">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,#03060d_0%,#05080f_46%,#08101b_100%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[.11] [background-image:linear-gradient(rgba(148,163,184,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.055)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_at_top,rgba(0,242,254,.035),transparent_68%)]" />

      <section className="relative mx-auto max-w-[1480px] space-y-3">
        <header className={`${surface} relative p-4 sm:p-5`}>
          <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-[#b8934a]/55 to-transparent" />
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px overflow-hidden">
            <span className={`block h-px w-1/4 bg-[#00F2FE] shadow-[0_0_14px_rgba(0,242,254,.55)] transition-transform duration-700 ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none ${completionPulse ? "translate-x-[400%]" : "-translate-x-full"}`} />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#b8934a]">CAREER GATE · EXECUTIVE INTAKE</p>
              <h1 className="mt-1 text-xl font-semibold tracking-[-.025em] text-white sm:text-2xl">SMART CLIENT IMPORT</h1>
              <p className="mt-1 text-[11px] text-slate-500">Secure Internal Intake · Deterministic Intelligence · Vision/OCR</p>
            </div>
            <div className={`${subSurface} grid min-w-[340px] grid-cols-5 gap-4 px-3 py-2.5`}>
              <Meta label="Staff" value={result?.uploaded_by_name ?? staff.display_name} />
              <Meta label="Files" value={String(files.length)} />
              <Meta label="Session" value={submitted ? "SUBMITTED" : "DRAFT"} />
              <Meta label="Time" value={fmtElapsed(elapsed)} tone="cyan" />
              <div><div className="text-[9px] font-semibold uppercase tracking-[.16em] text-slate-600">Status</div><span className={`mt-1 inline-flex rounded-md border px-1.5 py-1 font-mono text-[9px] ${stageTone(stage)}`}>{stage.replaceAll("_", " ")}</span></div>
            </div>
          </div>
          {result && <div className="mt-3 grid gap-2 border-t border-white/[.07] pt-3 sm:grid-cols-4" aria-live="polite"><Meta label="Case" value={result.case_number} tone="gold" /><Meta label="Uploaded" value={fmtDate(result.created_at)} /><Meta label="Processing" value={processingState} tone="cyan" /><Meta label="Accepted" value={result.acceptance_duration_ms == null ? "MEASURE PENDING" : `${result.acceptance_duration_ms} ms`} /></div>}
        </header>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.28fr)_minmax(360px,.72fr)]">
          <div className="space-y-3">
            <section className={`${surface} p-4`}>
              <div className="mb-3 flex items-center justify-between"><div><span className="font-mono text-[9px] text-[#b8934a]">02</span><h2 className="ml-2 inline text-[11px] font-semibold uppercase tracking-[.14em] text-slate-300">Source</h2></div><span className="font-mono text-[9px] tabular-nums text-slate-600">{files.length} files · {fmtBytes(totalBytes)}</span></div>
              <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || submitted} className={`${control} flex w-full items-center justify-between px-4 py-3 text-left hover:border-[#b8934a]/35 disabled:cursor-not-allowed disabled:opacity-45`}>
                <span><span className="block text-[12px] font-semibold text-slate-200">TAKE PHOTO / ADD FILES</span><span className="mt-1 block text-[9px] font-mono text-slate-600">PDF · JPG · PNG · WEBP · MAX 10 FILES · 25 MB TOTAL</span></span><span className="text-lg font-light text-[#d4b06a]">+</span>
              </button>
              <input ref={inputRef} className="sr-only" type="file" accept={ACCEPT} multiple onChange={(event) => addFiles(event.currentTarget.files)} />
              {files.length > 0 && <div className="mt-2 space-y-1.5">{files.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className={`${subSurface} flex items-center gap-3 px-3 py-2`}><div className="min-w-0 flex-1"><div className="truncate text-[11px] text-slate-200">{file.name}</div><div className="mt-0.5 font-mono text-[9px] text-slate-600">{file.type || "FILE"} · {fmtBytes(file.size)} · {submitted ? "STORED" : "STAGED"}</div></div>{!submitted && <button type="button" className={`${control} px-2 py-1 text-[9px] text-slate-500 hover:border-red-300/30 hover:text-red-200`} onClick={() => setFiles((current) => current.filter((_, item) => item !== index))}>REMOVE</button>}</div>)}</div>}
            </section>

            <section className={`${surface} p-4`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><span className="font-mono text-[9px] text-[#b8934a]">03</span><h2 className="ml-2 inline text-[11px] font-semibold uppercase tracking-[.14em] text-slate-300">Client Source Data</h2><span className="ml-2 text-[9px] text-slate-600">Immutable review source after submit</span></div><div className="flex gap-4"><Meta label="Uploaded by" value={result?.uploaded_by_name ?? staff.display_name} /><Meta label="Uploaded at" value={result ? fmtDate(result.created_at) : "PENDING"} /></div></div>
              <textarea ref={textareaRef} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={submitted} maxLength={10000} aria-label="Client Source Data" placeholder="Paste the client's known information here. Missing facts remain unresolved; the system does not invent them." className={`${control} min-h-[250px] w-full resize-y p-3 font-mono text-[12px] leading-6 text-slate-200 placeholder:text-slate-700 disabled:opacity-80`} />
              <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-slate-600"><span className="tabular-nums">{notes.length.toLocaleString()} / 10,000</span><span>Source is preserved independently of AI availability.</span></div>
            </section>
          </div>

          <aside className="space-y-3">
            <section className={`${surface} p-4`}>
              <div className="mb-3 flex items-center justify-between"><div><span className="h-1.5 w-1.5 rounded-full bg-[#00F2FE] inline-block" /><h2 className="ml-2 inline text-[11px] font-semibold uppercase tracking-[.14em] text-slate-300">Live Intelligence</h2></div><span className="font-mono text-[9px] text-[#8cf8ff]">{serverDraft ? "SERVER AUTHORITATIVE" : "LOCAL PREVIEW"}</span></div>
              {extractedEntries.length === 0 ? <div className={`${subSurface} flex min-h-32 items-center justify-center px-4 text-center text-[10px] text-slate-600`}>{notes.trim() ? "No supported deterministic facts detected yet. Source remains available for review." : "Awaiting recognizable client information."}</div> : <div className="divide-y divide-white/[.055]">{extractedEntries.map(([key, value]) => { const ev = localEvidence.find((item) => item.field_key === key); return <div key={key} className="grid grid-cols-[118px_minmax(0,1fr)_72px] items-center gap-2 py-2"><span className="text-[9px] uppercase tracking-[.12em] text-slate-600">{FIELD_LABELS[key]}</span><span className="truncate font-mono text-[11px] text-slate-200">{text(value)}</span><span className={`text-right font-mono text-[9px] ${ev?.strength === "HIGH" ? "text-emerald-300" : ev?.strength === "MEDIUM" ? "text-[#8cf8ff]" : "text-amber-300"}`}>{serverDraft ? "SERVER" : ev?.strength ?? "REVIEW"}</span></div>; })}</div>}
              <div className="mt-3 border-t border-white/[.06] pt-2 font-mono text-[9px] text-slate-600">LOCAL FIELDS <span className="ml-1 text-slate-300">{localEvidence.length}</span></div>
            </section>

            <section className={`${surface} p-4`}>
              <div className="mb-3 flex items-center justify-between"><h2 className="text-[11px] font-semibold uppercase tracking-[.14em] text-slate-300">Processing Pipeline</h2><span className="font-mono text-[9px] text-slate-600">Actual operational state</span></div>
              <div className="space-y-2">{pipeline.map(([label, state]) => { const tone = pipelineTone(state); return <div key={label} className="grid grid-cols-[10px_minmax(0,1fr)_110px] items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${tone.split(" ")[0]}`} /><span className="text-[10px] text-slate-400">{label}</span><span className={`text-right font-mono text-[9px] ${tone.split(" ")[1]}`}>{state}</span></div>; })}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[.06] pt-3"><Meta label="Outbox" value={outboxState} tone={outboxState === "QUEUED" || outboxState === "RUNNING" ? "cyan" : "neutral"} /><Meta label="AI" value={aiState} tone={aiState === "PROCESSING" || aiState === "QUEUED" ? "cyan" : "neutral"} /></div>
            </section>
          </aside>
        </div>

        {(error || extractionErrors.length > 0) && <section className={`${surface} border-${stage === "FAILED" ? "red" : "amber"}-300/20 p-4`} role="alert"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className={`text-[11px] font-semibold ${stage === "FAILED" ? "text-red-200" : "text-amber-200"}`}>{stage === "FAILED" ? "Submission failed" : "Review required"}</h2><p className="mt-1 text-[10px] text-slate-500">{error ?? `${extractionErrors.length} extraction issue(s). Local source and deterministic fields remain preserved.`}</p></div>{result?.enrichment_url && <button type="button" onClick={() => void retryExtraction()} className={`${control} border-amber-300/25 px-3 py-2 text-[10px] font-semibold text-amber-200 hover:bg-amber-300/[.06]`}>RETRY EXTRACTION</button>}</div></section>}

        <section className={`${surface} flex flex-wrap items-center justify-between gap-3 p-3`}>
          <div className="flex items-center gap-3 font-mono text-[9px] text-slate-600"><span>⌘/Ctrl + Enter · Submit</span><span className="h-3 w-px bg-white/[.08]" /><button type="button" onClick={() => setCommandOpen(true)} className="hover:text-[#8cf8ff]">⌘/Ctrl + K · Commands</button></div>
          <div className="flex items-center gap-2">{!submitted ? <><button type="button" onClick={reset} disabled={busy} className={`${control} px-3 py-2 text-[10px] text-slate-500 hover:text-slate-200 disabled:opacity-40`}>CLEAR</button><button type="button" onClick={() => void submit()} disabled={busy || (!notes.trim() && files.length === 0)} className="rounded-md border border-[#b8934a]/45 bg-[#b8934a]/[.105] px-4 py-2 text-[10px] font-semibold tracking-[.08em] text-[#e2c37c] shadow-[inset_0_1px_0_rgba(255,255,255,.045)] transition-colors duration-150 hover:bg-[#b8934a]/[.16] disabled:cursor-not-allowed disabled:opacity-35">{stage === "CAPTURING" ? "CAPTURING…" : "SUBMIT"}</button></> : <><button type="button" onClick={reset} className={`${control} px-3 py-2 text-[10px] text-slate-400`}>START ANOTHER</button><Link href={`/staff/import?open=${encodeURIComponent(result.case_id)}`} className="rounded-md border border-[#b8934a]/45 bg-[#b8934a]/[.105] px-4 py-2 text-[10px] font-semibold tracking-[.08em] text-[#e2c37c] hover:bg-[#b8934a]/[.16]">OPEN IN SMART CAREER COLLECT CLIENT</Link></>}</div>
        </section>
      </section>

      {commandOpen && <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 px-4 pt-[14vh] backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandOpen(false); }}><div ref={commandRef} role="dialog" aria-modal="true" aria-label="Smart Import commands" className={`${surface} w-full max-w-lg p-2`}><div className="flex items-center justify-between border-b border-white/[.07] px-3 py-2"><span className="text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">Command Drawer</span><button type="button" onClick={() => setCommandOpen(false)} className={`${control} px-2 py-1 text-[9px] text-slate-500`}>ESC</button></div><div className="p-1"><button type="button" onClick={() => { setCommandOpen(false); textareaRef.current?.focus(); }} className="block w-full rounded-md px-3 py-2 text-left text-[11px] text-slate-300 hover:bg-white/[.04]">Focus Client Source Data</button><button type="button" onClick={() => { setCommandOpen(false); inputRef.current?.click(); }} disabled={submitted} className="block w-full rounded-md px-3 py-2 text-left text-[11px] text-slate-300 hover:bg-white/[.04] disabled:opacity-35">Add Source Document</button><Link href="/staff/import" onClick={() => setCommandOpen(false)} className="block rounded-md px-3 py-2 text-[11px] text-slate-300 hover:bg-white/[.04]">Open Import Queue</Link>{result?.enrichment_url && <button type="button" onClick={() => { setCommandOpen(false); void retryExtraction(); }} className="block w-full rounded-md px-3 py-2 text-left text-[11px] text-slate-300 hover:bg-white/[.04]">Retry Extraction</button>}</div></div></div>}
    </main>
  );
}
