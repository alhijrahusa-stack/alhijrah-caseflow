"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { extractDeterministicClient } from "@/lib/smart-client-local";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const AUDIO_PREF_KEY = "career-gate-smart-import-audio";

type Stage = "DRAFT" | "CAPTURING" | "CAPTURED" | "ENRICHING" | "REVIEW_REQUIRED" | "READY";
type SubmitResult = {
  case_id: string;
  created_at: string;
  uploaded_by_name: string;
  mapped_draft?: { profile?: Record<string, unknown>; review_fields?: Record<string, unknown> };
  verification_result?: Record<string, unknown>;
  enrichment_url?: string;
};

const FIELD_LABELS: Record<string, string> = {
  full_name: "FULL NAME",
  phone: "PHONE",
  email: "EMAIL",
  date_of_birth: "DATE OF BIRTH",
  street: "STREET",
  city: "CITY",
  state: "STATE",
  zip: "ZIP",
  preferred_language: "LANGUAGE",
  english_proficiency: "ENGLISH PROFICIENCY",
  appointment_availability: "AVAILABILITY",
  site_code: "PREFERRED LOCATION",
  preferred_location: "PREFERRED LOCATION",
  location_option_1: "LOCATION OPTION 1",
  backup_site_code: "LOCATION OPTION 2",
  location_option_2: "LOCATION OPTION 2",
  job_id: "JOB",
  shift_code: "SHIFT",
  shift_days: "SHIFT DAYS",
  shift_start_time: "SHIFT START",
  shift_end_time: "SHIFT END",
};

const GROUPS = [
  { title: "IDENTITY", keys: ["full_name", "phone", "email", "date_of_birth"] },
  { title: "ADDRESS", keys: ["street", "city", "state", "zip"] },
  { title: "LANGUAGE", keys: ["preferred_language", "english_proficiency"] },
  { title: "JOB PREFERENCES", keys: ["site_code", "preferred_location", "location_option_1", "backup_site_code", "location_option_2", "job_id", "shift_code", "shift_days", "shift_start_time", "shift_end_time"] },
] as const;

function formatElapsed(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

function statusLabel(stage: Stage, hasSource: boolean) {
  if (stage === "CAPTURING") return "SUBMITTING";
  if (stage === "CAPTURED" || stage === "ENRICHING") return "PROCESSING";
  if (stage === "REVIEW_REQUIRED") return "REVIEW REQUIRED";
  if (stage === "READY") return "READY TO REVIEW";
  return hasSource ? "READY TO SUBMIT" : "CAPTURING";
}

function statusTone(stage: Stage, hasSource: boolean) {
  if (stage === "READY") return "border-emerald-300/30 bg-emerald-300/[.08] text-emerald-200";
  if (stage === "REVIEW_REQUIRED") return "border-amber-300/30 bg-amber-300/[.08] text-amber-200";
  if (stage === "CAPTURING" || stage === "CAPTURED" || stage === "ENRICHING") return "border-cyan-300/30 bg-cyan-300/[.08] text-cyan-200";
  return hasSource ? "border-[#b8934a]/30 bg-[#b8934a]/[.08] text-[#e3c884]" : "border-white/10 bg-white/[.025] text-slate-400";
}

const glassPanel = "relative overflow-hidden rounded-[22px] border border-[#b8934a]/[.14] bg-[linear-gradient(145deg,rgba(12,35,68,.76),rgba(4,11,25,.72))] shadow-[0_24px_70px_-30px_rgba(0,0,0,.78),inset_0_1px_0_rgba(255,255,255,.065),0_0_0_1px_rgba(34,211,238,.018)] backdrop-blur-2xl transition-[border-color,box-shadow,transform] duration-200 motion-reduce:transition-none hover:-translate-y-[2px] hover:border-[#d4b06a]/25 hover:shadow-[0_30px_80px_-32px_rgba(0,0,0,.82),inset_0_1px_0_rgba(255,255,255,.08)] focus-within:translate-y-0";

export function MobileSmartImportForm({ staff }: { staff: { display_name: string } }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionStart = useRef(Date.now());
  const completionTimer = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<Stage>("DRAFT");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [serverDraft, setServerDraft] = useState<Record<string, unknown> | null>(null);
  const [verification, setVerification] = useState<Record<string, unknown> | null>(null);
  const [completionPulse, setCompletionPulse] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const deferredNotes = useDeferredValue(notes);
  const local = useMemo(() => extractDeterministicClient(deferredNotes), [deferredNotes]);
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const totalMb = totalBytes / 1024 / 1024;
  const busy = stage === "CAPTURING" || stage === "ENRICHING";
  const submitted = Boolean(result);
  const localUpdating = deferredNotes !== notes;
  const hasSource = Boolean(notes.trim() || files.length);

  useEffect(() => {
    const stored = window.localStorage.getItem(AUDIO_PREF_KEY);
    setAudioEnabled(stored === "on");
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - sessionStart.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (completionTimer.current) window.clearTimeout(completionTimer.current);
    void audioContextRef.current?.close().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        const target = event.target as HTMLElement | null;
        if (target?.tagName === "INPUT") return;
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function ensureAudioContext() {
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    if (!audioContextRef.current) audioContextRef.current = new AudioCtor();
    if (audioContextRef.current.state === "suspended") await audioContextRef.current.resume();
    return audioContextRef.current;
  }

  async function playTone(kind: "capture" | "detect" | "submit" | "error") {
    if (!audioEnabled) return;
    const context = await ensureAudioContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    const frequencies = { capture: 620, detect: 760, submit: 520, error: 220 } as const;
    oscillator.frequency.setValueAtTime(frequencies[kind], now);
    oscillator.type = kind === "error" ? "triangle" : "sine";
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === "error" ? 0.018 : 0.012, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(now); oscillator.stop(now + 0.13);
  }

  async function toggleAudio() {
    const next = !audioEnabled;
    if (next) await ensureAudioContext();
    setAudioEnabled(next);
    window.localStorage.setItem(AUDIO_PREF_KEY, next ? "on" : "off");
  }

  function flashCompletion() {
    setCompletionPulse(false);
    window.requestAnimationFrame(() => setCompletionPulse(true));
    if (completionTimer.current) window.clearTimeout(completionTimer.current);
    completionTimer.current = window.setTimeout(() => setCompletionPulse(false), 850);
  }

  function addFiles(list: FileList | null) {
    if (!list || busy || submitted) return;
    const next = [...files, ...Array.from(list)].slice(0, MAX_FILES);
    const nextBytes = next.reduce((sum, file) => sum + file.size, 0);
    if (nextBytes > MAX_TOTAL_BYTES) {
      setError("Files exceed the 25 MB total limit.");
      void playTone("error");
      return;
    }
    setFiles(next);
    setError(null);
  }

  function combineDraft(mapped?: SubmitResult["mapped_draft"]) {
    return { ...(mapped?.profile ?? {}), ...(mapped?.review_fields ?? {}) };
  }

  async function enrich(captured: SubmitResult) {
    if (!captured.enrichment_url || files.length === 0) {
      setStage("READY");
      return;
    }
    setStage("ENRICHING");
    try {
      const res = await fetch(captured.enrichment_url, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Extraction failed (${res.status})`);
      setServerDraft(combineDraft(data.mapped_draft));
      setVerification(data.verification_result ?? null);
      setStage(data.verification_result?.processing_state === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "READY");
      flashCompletion();
      void playTone("detect");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI enrichment unavailable; local data remains preserved.");
      setStage("REVIEW_REQUIRED");
      void playTone("error");
    }
  }

  async function submit() {
    if (busy || submitted || !hasSource) return;
    setStage("CAPTURING");
    setError(null);
    try {
      const form = new FormData();
      form.set("notes", notes.trim());
      for (const file of files) form.append("files", file, file.name);
      const res = await fetch("/api/staff/smart-client-import/mobile", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Submission failed (${res.status})`);
      const captured: SubmitResult = {
        case_id: data.case_id,
        created_at: data.created_at,
        uploaded_by_name: data.uploaded_by_name ?? staff.display_name,
        mapped_draft: data.mapped_draft,
        verification_result: data.verification_result,
        enrichment_url: data.enrichment_url,
      };
      setResult(captured);
      setServerDraft(combineDraft(data.mapped_draft));
      setVerification(data.verification_result ?? null);
      setStage("CAPTURED");
      flashCompletion();
      void playTone("capture");
      void enrich(captured);
    } catch (e) {
      setStage("DRAFT");
      setError(e instanceof Error ? e.message : "Submission failed");
      void playTone("error");
    }
  }

  function reset() {
    setFiles([]); setNotes(""); setError(null); setResult(null); setServerDraft(null); setVerification(null);
    setStage("DRAFT"); setCompletionPulse(false); sessionStart.current = Date.now(); setElapsed(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  const extracted = serverDraft ?? local.row;
  const issues = Array.isArray(verification?.extraction_errors) ? verification.extraction_errors.length : 0;
  const localFields = local.evidence.length;
  const extractedEntries = Object.entries(extracted).filter(([key, value]) => key in FIELD_LABELS && value != null && String(value).trim());

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#03101f] px-3 py-4 text-slate-200 sm:px-5 lg:px-7">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_-8%,rgba(26,124,183,.22),transparent_30%),radial-gradient(circle_at_84%_9%,rgba(184,147,74,.11),transparent_24%),linear-gradient(180deg,#061a31_0%,#041226_52%,#020b18_100%)]" />
      <div className="pointer-events-none fixed -left-20 top-24 h-80 w-80 rounded-full bg-cyan-300/[.035] blur-3xl motion-safe:animate-[pulse_9s_ease-in-out_infinite] motion-reduce:hidden" />
      <div className="pointer-events-none fixed -right-24 top-1/3 h-96 w-96 rounded-full bg-[#b8934a]/[.035] blur-3xl motion-safe:animate-[pulse_11s_ease-in-out_infinite] motion-reduce:hidden" />
      <div className="pointer-events-none fixed inset-0 opacity-[.12] [background-image:radial-gradient(circle_at_1px_1px,rgba(214,225,238,.16)_1px,transparent_0)] [background-size:31px_31px]" />
      <div className="pointer-events-none fixed left-[14%] top-[17%] h-1 w-1 rounded-full bg-cyan-200/35 shadow-[0_0_10px_rgba(165,243,252,.2)] motion-safe:animate-pulse motion-reduce:hidden" />
      <div className="pointer-events-none fixed right-[18%] top-[42%] h-1 w-1 rounded-full bg-[#e3c884]/35 shadow-[0_0_10px_rgba(227,200,132,.18)] motion-safe:animate-pulse motion-reduce:hidden" />
      <div className="pointer-events-none fixed left-[37%] bottom-[24%] h-1 w-1 rounded-full bg-cyan-200/25 motion-safe:animate-pulse motion-reduce:hidden" />

      <section className="relative mx-auto max-w-[1480px] space-y-4">
        <header className={`${glassPanel} p-5 sm:p-6`}>
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#e3c884]/60 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden" aria-hidden="true">
            <span className={`block h-full w-1/3 bg-gradient-to-r from-transparent via-[#f0d99d] to-cyan-100 shadow-[0_0_16px_rgba(227,200,132,.45)] transition-transform duration-[550ms] ease-out motion-reduce:duration-150 ${completionPulse ? "translate-x-[300%]" : "-translate-x-full"}`} />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#e3c884] shadow-[0_0_10px_rgba(227,200,132,.42)]" /><p className="text-[10px] font-bold tracking-[.23em] text-[#e3c884]">CAREER GATE · EXECUTIVE INTAKE</p></div>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-.03em] text-white sm:text-[30px]">SMART CLIENT IMPORT</h1>
              <p className="mt-1.5 text-xs text-slate-400">Secure Internal Intake · Local Intelligence · Server Authoritative</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-[#b8934a]/20 bg-[#03101f]/55 px-4 py-3 text-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,.045)] sm:grid-cols-6">
              <Meta label="STAFF" value={result?.uploaded_by_name ?? staff.display_name} />
              <Meta label="FILES" value={String(files.length)} mono />
              <Meta label="SESSION" value={submitted ? "SUBMITTED" : "ACTIVE"} />
              <Meta label="TIME" value={formatElapsed(elapsed)} mono tone="cyan" />
              <div><span className="block tracking-[.14em] text-slate-500">STATUS</span><span className={`mt-1 inline-flex rounded-md border px-2 py-1 font-mono text-[9px] ${statusTone(stage, hasSource)}`}>{statusLabel(stage, hasSource)}</span></div>
              <div><span className="block tracking-[.14em] text-slate-500">AUDIO</span><button type="button" aria-label={audioEnabled ? "Disable audio" : "Enable audio"} aria-pressed={audioEnabled} onClick={() => void toggleAudio()} className="mt-1 min-h-7 rounded-md border border-[#b8934a]/25 px-2 font-mono text-[9px] text-[#e3c884] transition hover:bg-[#b8934a]/10">{audioEnabled ? "Volume2 · ON" : "VolumeX · OFF"}</button></div>
            </div>
          </div>
          {result && <div aria-live="polite" className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/[.06] pt-3 text-[10px] text-slate-500"><span>CASE <b className="ml-1 font-mono font-medium text-slate-300">{result.case_id}</b></span><span>UPLOADED <b className="ml-1 font-mono font-medium text-slate-300">{formatDate(result.created_at)}</b></span><span className="inline-flex items-center gap-1.5 text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,.5)]" />SOURCE CAPTURED</span></div>}
        </header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(410px,.88fr)]">
          <div className="space-y-4">
            <section className={`${glassPanel} p-4 sm:p-5`}>
              <SectionTitle number="02" title="SOURCE CAPTURE" meta={`${files.length} files · ${totalMb.toFixed(2)} MB`} />
              <input ref={inputRef} className="hidden" type="file" accept={ACCEPT} multiple disabled={busy || submitted} onChange={(e) => addFiles(e.target.files)} />
              <button type="button" disabled={busy || submitted} onClick={() => inputRef.current?.click()} className="group relative mt-3 flex min-h-24 w-full items-center justify-between overflow-hidden rounded-2xl border border-dashed border-[#b8934a]/30 bg-[linear-gradient(135deg,rgba(255,255,255,.05),rgba(8,27,52,.2))] px-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,.055)] transition-all duration-200 motion-reduce:transition-none hover:-translate-y-0.5 hover:border-[#e3c884]/55 hover:bg-white/[.065] disabled:cursor-not-allowed disabled:opacity-50"><span><strong className="block text-sm font-semibold text-white">TAKE PHOTO / ADD FILES</strong><span className="mt-1.5 block text-[10px] text-slate-500">PDF · JPG · PNG · WebP · max 10 files · 25 MB total</span></span><span className="grid h-10 w-10 place-items-center rounded-xl border border-[#d4b06a]/40 bg-[#b8934a]/[.09] text-lg text-[#f0d99d]">＋</span></button>
              {files.length > 0 && <div className="mt-3 space-y-2">{files.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-white/[.08] bg-black/20 px-3.5 py-2.5"><div className="min-w-0"><strong className="block truncate text-xs font-medium text-slate-200">{file.name}</strong><span className="mt-0.5 block text-[10px] font-mono text-slate-500">{file.type || "file"} · {(file.size / 1024 / 1024).toFixed(2)} MB · {submitted ? "STORED" : "STAGED"}</span></div>{!submitted && <button type="button" className="rounded-md border border-red-300/15 px-2 py-1 text-[9px] font-semibold text-red-300" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>REMOVE</button>}</div>)}</div>}
            </section>

            <section className={`${glassPanel} p-4 sm:p-5`}>
              <div className="flex flex-wrap items-center justify-between gap-3"><SectionTitle number="03" title="CLIENT SOURCE DATA" meta="Visible source truth" /><div className="flex flex-wrap gap-4 text-[9px] text-slate-500"><span>UPLOADED BY <b className="ml-1 text-slate-300">{result?.uploaded_by_name ?? staff.display_name}</b></span><span>UPLOADED AT <b className="ml-1 font-mono text-slate-300">{result ? formatDate(result.created_at) : "pending"}</b></span></div></div>
              <div className="relative mt-3 overflow-hidden rounded-2xl border border-[#b8934a]/20 bg-[#010918]/88 shadow-[inset_0_1px_14px_rgba(0,0,0,.4)] transition-colors focus-within:border-cyan-300/35">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/30 to-transparent" />
                <textarea className="min-h-72 w-full resize-y bg-transparent p-4 font-mono text-[12px] leading-6 text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-70" maxLength={10000} value={notes} disabled={submitted} onChange={(e) => setNotes(e.target.value)} placeholder="Paste client information here. Source remains visible while Career Gate extracts and structures supported facts." />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500"><span className="font-mono tabular-nums">{notes.length.toLocaleString()} / 10,000</span><span className="inline-flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${localUpdating ? "bg-cyan-300 motion-safe:animate-pulse" : notes.trim() ? "bg-emerald-300" : "bg-slate-700"}`} />{localUpdating ? "Scanning source…" : notes.trim() ? "Full source scanned locally" : "Awaiting source"}</span></div>
            </section>
          </div>

          <aside className="space-y-4">
            <section className={`${glassPanel} p-4 sm:p-5`}>
              <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/45 to-transparent" />
              <SectionTitle number="04" title="LIVE INTELLIGENCE" meta={serverDraft ? "SERVER AUTHORITATIVE" : localUpdating ? "SCANNING SOURCE" : "LOCAL PREVIEW"} tone="cyan" />
              <div className="mt-3 space-y-3">{GROUPS.map((group) => {
                const entries = extractedEntries.filter(([key]) => (group.keys as readonly string[]).includes(key));
                if (!entries.length) return null;
                return <div key={group.title}><div className="mb-1.5 flex items-center gap-2"><span className="text-[8px] font-bold tracking-[.17em] text-[#e3c884]">{group.title}</span><span className="h-px flex-1 bg-gradient-to-r from-[#b8934a]/20 to-transparent" /></div><div className="space-y-0.5">{entries.map(([key, value]) => { const ev = local.evidence.find((item) => item.field_key === key); return <div key={key} className="grid grid-cols-[118px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-transparent px-2 py-2 transition hover:border-cyan-200/[.08] hover:bg-cyan-200/[.025]"><span className="text-[9px] tracking-[.1em] text-slate-500">{FIELD_LABELS[key]}</span><span className="min-w-0 truncate font-mono text-[11px] text-slate-100">{Array.isArray(value) ? value.join(", ") : String(value)}</span><span className={`rounded-md border px-1.5 py-0.5 text-[8px] font-mono ${serverDraft ? "border-cyan-300/20 text-cyan-200" : ev?.strength === "HIGH" ? "border-emerald-300/20 text-emerald-200" : "border-amber-300/20 text-amber-200"}`}>{serverDraft ? "SERVER" : ev?.strength ?? "REVIEW"}</span></div>; })}</div></div>;
              })}</div>
              {extractedEntries.length === 0 && <div className="grid min-h-36 place-items-center rounded-2xl border border-white/[.06] bg-black/15 px-4 text-center text-xs text-slate-500">Awaiting recognizable client information.</div>}
              <div className="mt-3 flex items-center justify-between border-t border-white/[.06] pt-3 text-[10px] text-slate-500"><span>DETECTED FIELDS</span><span className="rounded-md border border-white/[.08] bg-black/20 px-2 py-1 font-mono text-slate-200">{serverDraft ? extractedEntries.length : localFields}</span></div>
            </section>

            <section className={`${glassPanel} p-4 sm:p-5`}>
              <SectionTitle number="05" title="PROCESSING PIPELINE" meta="Actual operational state" />
              <div className="mt-3 space-y-2.5">
                <Pipeline label="SOURCE CAPTURE" state={submitted ? "COMPLETE" : stage === "CAPTURING" ? "RUNNING" : hasSource ? "COMPLETE" : "WAITING"} />
                <Pipeline label="LOCAL EXTRACTION" state={notes.trim() ? "COMPLETE" : "WAITING"} />
                <Pipeline label="DOCUMENT PROCESSING" state={!files.length ? "WAITING" : stage === "ENRICHING" ? "RUNNING" : stage === "REVIEW_REQUIRED" ? "REVIEW REQUIRED" : stage === "READY" ? "COMPLETE" : "WAITING"} />
                <Pipeline label="ENRICHMENT" state={!files.length ? "WAITING" : stage === "ENRICHING" ? "RUNNING" : stage === "REVIEW_REQUIRED" ? "REVIEW REQUIRED" : stage === "READY" ? "COMPLETE" : "WAITING"} />
                <Pipeline label="STAGING" state={submitted ? "COMPLETE" : "WAITING"} />
                <Pipeline label="REVIEW READINESS" state={stage === "READY" ? "COMPLETE" : stage === "REVIEW_REQUIRED" ? "REVIEW REQUIRED" : "WAITING"} />
              </div>
            </section>

            {(error || issues > 0 || stage === "REVIEW_REQUIRED") && <section className="relative overflow-hidden rounded-[22px] border border-amber-300/25 bg-[linear-gradient(145deg,rgba(77,54,10,.18),rgba(8,18,34,.76))] p-4 shadow-[0_20px_55px_-30px_rgba(0,0,0,.8)] backdrop-blur-2xl"><SectionTitle number="06" title="ISSUES & RESOLUTION" meta={`${issues || 1} item requires review`} tone="amber" />{error && <p className="mt-3 text-xs leading-5 text-amber-100">{error}</p>}<p className="mt-2 text-[10px] text-slate-500">Source, staged data and staff context remain preserved.</p>{result && <button type="button" onClick={() => void enrich(result)} disabled={stage === "ENRICHING"} className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/[.05] px-3 py-2 text-[10px] font-semibold tracking-[.08em] text-amber-200">RETRY EXTRACTION</button>}</section>}
          </aside>
        </div>

        <section className={`${glassPanel} sticky bottom-3 z-20 p-3.5`}>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden" aria-hidden="true"><span className={`block h-full w-1/3 bg-gradient-to-r from-transparent via-[#f0d99d] to-cyan-100 shadow-[0_0_16px_rgba(227,200,132,.4)] transition-transform duration-[550ms] ease-out motion-reduce:duration-150 ${completionPulse ? "translate-x-[300%]" : "-translate-x-full"}`} /></div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500"><span className="rounded-md border border-white/[.08] bg-black/20 px-2 py-1 font-mono">⌘/Ctrl + Enter</span><span>Submit</span><span className="text-slate-700">|</span><span>{hasSource ? `${localFields} fields detected` : "Source-first capture"}</span>{completionPulse && <span aria-live="polite" className="ml-1 inline-flex items-center gap-1.5 text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />AUTHORITATIVE UPDATE COMPLETE</span>}</div>
            <div className="flex flex-wrap gap-2">{submitted ? <><button type="button" onClick={reset} className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-2.5 text-[10px] font-semibold tracking-[.12em] text-slate-300">START ANOTHER</button><Link className="rounded-xl border border-[#d4b06a]/55 bg-[linear-gradient(180deg,rgba(184,147,74,.22),rgba(184,147,74,.1))] px-4 py-2.5 text-[10px] font-semibold tracking-[.12em] text-[#f0d99d] shadow-[0_10px_26px_-16px_rgba(184,147,74,.6)]" href="/staff/import">OPEN SMART CAREER COLLECT CLIENT</Link></> : <><button type="button" onClick={reset} disabled={busy || !hasSource} className="rounded-xl border border-white/10 bg-white/[.02] px-4 py-2.5 text-[10px] font-semibold tracking-[.12em] text-slate-400 disabled:opacity-35">CLEAR</button><button type="button" onClick={() => void submit()} disabled={busy || !hasSource} className="rounded-xl border border-[#d4b06a]/65 bg-[linear-gradient(180deg,rgba(184,147,74,.24),rgba(184,147,74,.11))] px-5 py-2.5 text-[10px] font-semibold tracking-[.14em] text-[#f3dda4] shadow-[0_12px_30px_-18px_rgba(184,147,74,.75)] transition active:translate-y-px active:scale-[.985] disabled:opacity-35">{stage === "CAPTURING" ? "SUBMITTING…" : "SUBMIT"}</button></>}</div>
          </div>
        </section>
      </section>
    </main>
  );
}

function Meta({ label, value, mono = false, tone = "neutral" }: { label: string; value: string; mono?: boolean; tone?: "neutral" | "cyan" }) {
  return <div><span className="block tracking-[.14em] text-slate-500">{label}</span><strong className={`mt-1 block max-w-28 truncate text-[10px] font-medium ${mono ? "font-mono tabular-nums" : ""} ${tone === "cyan" ? "text-cyan-200" : "text-slate-200"}`}>{value}</strong></div>;
}

function SectionTitle({ number, title, meta, tone = "gold" }: { number: string; title: string; meta?: string; tone?: "gold" | "cyan" | "amber" }) {
  const color = tone === "cyan" ? "text-cyan-200" : tone === "amber" ? "text-amber-200" : "text-[#e3c884]";
  return <div className="flex flex-wrap items-center gap-2"><span className={`font-mono text-[9px] font-bold ${color}`}>{number}</span><h2 className="text-[10px] font-semibold tracking-[.16em] text-slate-200">{title}</h2>{meta && <><span className="text-slate-700">·</span><span className="text-[9px] text-slate-500">{meta}</span></>}</div>;
}

function Pipeline({ label, state }: { label: string; state: "WAITING" | "RUNNING" | "COMPLETE" | "REVIEW REQUIRED" | "FAILED" }) {
  const tone = state === "COMPLETE" ? "bg-emerald-300 text-emerald-200" : state === "RUNNING" ? "bg-cyan-300 text-cyan-200" : state === "REVIEW REQUIRED" ? "bg-amber-300 text-amber-200" : state === "FAILED" ? "bg-red-300 text-red-200" : "bg-slate-700 text-slate-500";
  const [dot, text] = tone.split(" ");
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-transparent px-2 py-1.5 transition hover:border-white/[.04] hover:bg-white/[.02]"><span className="flex items-center gap-2 text-[10px] text-slate-300"><span className={`h-1.5 w-1.5 rounded-full ${dot} ${state === "RUNNING" ? "motion-safe:animate-pulse" : ""}`} />{label}</span><span className={`font-mono text-[9px] ${text}`}>{state}</span></div>;
}
