"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { extractDeterministicClient } from "@/lib/smart-client-local";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";
type Stage = "DRAFT" | "CAPTURING" | "CAPTURED" | "ENRICHING" | "REVIEW_REQUIRED" | "READY";
type SubmitResult = {
  case_id: string;
  created_at: string;
  uploaded_by_name: string;
  mapped_draft?: { profile?: Record<string, unknown> };
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
  appointment_availability: "AVAILABILITY",
  site_code: "SITE",
  job_id: "JOB",
  shift_code: "SHIFT",
};

function formatElapsed(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

function statusTone(stage: Stage) {
  if (stage === "READY") return "border-emerald-300/30 bg-emerald-300/[.08] text-emerald-200";
  if (stage === "REVIEW_REQUIRED") return "border-amber-300/30 bg-amber-300/[.08] text-amber-200";
  if (stage === "CAPTURING" || stage === "ENRICHING") return "border-cyan-300/30 bg-cyan-300/[.08] text-cyan-200";
  if (stage === "CAPTURED") return "border-emerald-300/25 bg-emerald-300/[.06] text-emerald-200";
  return "border-white/10 bg-white/[.025] text-slate-400";
}

const glassPanel = "rounded-2xl border border-white/[.075] bg-[linear-gradient(145deg,rgba(10,18,32,.82),rgba(4,9,18,.68))] shadow-[0_18px_60px_rgba(0,0,0,.28),inset_0_1px_0_rgba(255,255,255,.045)] backdrop-blur-xl";

export function MobileSmartImportForm({ staff }: { staff: { display_name: string } }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionStart = useRef(Date.now());
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
  const local = useMemo(() => extractDeterministicClient(notes), [notes]);
  const totalMb = useMemo(() => files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024, [files]);
  const busy = stage === "CAPTURING";
  const submitted = Boolean(result);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - sessionStart.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (completionTimer.current) window.clearTimeout(completionTimer.current);
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

  function flashCompletion() {
    setCompletionPulse(true);
    if (completionTimer.current) window.clearTimeout(completionTimer.current);
    completionTimer.current = window.setTimeout(() => setCompletionPulse(false), 1300);
  }

  function addFiles(list: FileList | null) {
    if (!list || busy || submitted) return;
    setFiles((current) => [...current, ...Array.from(list)].slice(0, 10));
    setError(null);
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
      setServerDraft(data.mapped_draft?.profile ?? null);
      setVerification(data.verification_result ?? null);
      setStage(data.verification_result?.processing_state === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "READY");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI enrichment unavailable; local data remains preserved.");
      setStage("REVIEW_REQUIRED");
    }
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
      setServerDraft(data.mapped_draft?.profile ?? null);
      setVerification(data.verification_result ?? null);
      setStage("CAPTURED");
      flashCompletion();
      void enrich(captured);
    } catch (e) {
      setStage("DRAFT");
      setError(e instanceof Error ? e.message : "Submission failed");
    }
  }

  function reset() {
    setFiles([]);
    setNotes("");
    setError(null);
    setResult(null);
    setServerDraft(null);
    setVerification(null);
    setStage("DRAFT");
    setCompletionPulse(false);
    sessionStart.current = Date.now();
    setElapsed(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  const extracted = serverDraft ?? local.row;
  const issues = Array.isArray(verification?.extraction_errors) ? verification.extraction_errors.length : 0;
  const localFields = local.evidence.length;
  const extractedEntries = Object.entries(extracted).filter(([key, value]) => key in FIELD_LABELS && value != null && String(value).trim());

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#02050b] px-3 py-4 text-slate-200 sm:px-5 lg:px-7">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_-10%,rgba(34,211,238,.08),transparent_30%),radial-gradient(circle_at_85%_10%,rgba(184,147,74,.06),transparent_24%),linear-gradient(180deg,#030711_0%,#02050b_55%,#03060d_100%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[.18] [background-image:radial-gradient(circle_at_1px_1px,rgba(148,163,184,.12)_1px,transparent_0)] [background-size:28px_28px]" />

      <section className="relative mx-auto max-w-[1420px] space-y-4">
        <header className={`${glassPanel} relative overflow-hidden p-5 sm:p-6`}>
          <div className={`pointer-events-none absolute -top-px left-1/2 h-[2px] w-2/3 -translate-x-1/2 rounded-full bg-gradient-to-r from-transparent via-emerald-300 to-transparent blur-[1px] transition-all duration-700 ${completionPulse ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"}`} />
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#b8934a]/45 to-transparent" />
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-2xl">
              <p className="text-[10px] font-bold tracking-[.23em] text-[#d4b06a]">CAREER GATE · EXECUTIVE INTAKE</p>
              <h1 className="mt-1.5 text-2xl font-semibold tracking-[-.025em] text-white sm:text-[28px]">SMART CLIENT IMPORT</h1>
              <p className="mt-1.5 text-xs text-slate-500">Secure Internal Intake · Local Intelligence · Vision/OCR</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-white/[.055] bg-black/15 px-4 py-3 text-[10px] sm:grid-cols-5">
              <Meta label="STAFF" value={result?.uploaded_by_name ?? staff.display_name} />
              <Meta label="FILES" value={String(files.length)} mono />
              <Meta label="SESSION" value={submitted ? "SUBMITTED" : "DRAFT"} />
              <Meta label="TIME" value={formatElapsed(elapsed)} mono tone="cyan" />
              <div><span className="block tracking-[.14em] text-slate-600">STATUS</span><span className={`mt-1 inline-flex rounded-md border px-2 py-1 font-mono text-[9px] ${statusTone(stage)}`}>{stage.replaceAll("_", " ")}</span></div>
            </div>
          </div>
          {result && <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/[.06] pt-3 text-[10px] text-slate-500"><span>CASE <b className="ml-1 font-mono font-medium text-slate-300">{result.case_id}</b></span><span>UPLOADED <b className="ml-1 font-mono font-medium text-slate-300">{formatDate(result.created_at)}</b></span><span className="inline-flex items-center gap-1.5 text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />SOURCE CAPTURED</span></div>}
        </header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(370px,.82fr)]">
          <div className="space-y-4">
            <section className={`${glassPanel} p-4 sm:p-5`}>
              <SectionTitle number="02" title="SOURCE" meta={`${files.length} files · ${totalMb.toFixed(2)} MB`} />
              <input ref={inputRef} className="hidden" type="file" accept={ACCEPT} multiple disabled={busy || submitted} onChange={(e) => addFiles(e.target.files)} />
              <button type="button" disabled={busy || submitted} onClick={() => inputRef.current?.click()} className="group mt-3 flex min-h-24 w-full items-center justify-between overflow-hidden rounded-xl border border-dashed border-white/[.11] bg-[linear-gradient(135deg,rgba(255,255,255,.035),rgba(255,255,255,.012))] px-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,.035)] transition-all duration-150 hover:-translate-y-px hover:border-[#b8934a]/45 hover:bg-white/[.045] hover:shadow-[0_12px_30px_rgba(0,0,0,.22),inset_0_1px_0_rgba(255,255,255,.05)] disabled:cursor-not-allowed disabled:opacity-50"><span><strong className="block text-sm font-semibold tracking-[-.01em] text-slate-100">TAKE PHOTO / ADD FILES</strong><span className="mt-1.5 block text-[10px] text-slate-600">PDF · JPG · PNG · WebP · max 10 files · 25 MB total</span></span><span className="grid h-9 w-9 place-items-center rounded-lg border border-[#b8934a]/25 bg-[#b8934a]/[.06] text-lg text-[#d4b06a] transition group-hover:border-[#b8934a]/45 group-hover:bg-[#b8934a]/[.11]">＋</span></button>
              {files.length > 0 && <div className="mt-3 space-y-2">{files.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-white/[.06] bg-black/20 px-3.5 py-2.5"><div className="min-w-0"><strong className="block truncate text-xs font-medium text-slate-200">{file.name}</strong><span className="mt-0.5 block text-[10px] font-mono text-slate-600">{file.type || "file"} · {(file.size / 1024 / 1024).toFixed(2)} MB · {submitted ? "STORED" : "STAGED"}</span></div>{!submitted && <button type="button" className="rounded-md border border-red-300/15 px-2 py-1 text-[9px] font-semibold text-red-300 transition hover:bg-red-300/[.06]" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>REMOVE</button>}</div>)}</div>}
            </section>

            <section className={`${glassPanel} p-4 sm:p-5`}>
              <div className="flex flex-wrap items-center justify-between gap-3"><SectionTitle number="03" title="CLIENT SOURCE DATA" meta="Raw submitted information" /><div className="flex flex-wrap gap-4 text-[9px] text-slate-600"><span>UPLOADED BY <b className="ml-1 text-slate-400">{result?.uploaded_by_name ?? staff.display_name}</b></span><span>UPLOADED AT <b className="ml-1 font-mono text-slate-400">{result ? formatDate(result.created_at) : "pending"}</b></span></div></div>
              <div className="relative mt-3 overflow-hidden rounded-xl border border-white/[.075] bg-[#01040a]/80 shadow-[inset_0_1px_8px_rgba(0,0,0,.32)] focus-within:border-cyan-300/30">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/25 to-transparent" />
                <textarea className="min-h-64 w-full resize-y bg-transparent p-4 font-mono text-[12px] leading-6 text-slate-100 outline-none placeholder:text-slate-700 disabled:opacity-70" maxLength={10000} value={notes} disabled={submitted} onChange={(e) => setNotes(e.target.value)} placeholder="Paste the client's known information here. Every supported fact is scanned locally; missing facts remain unresolved." />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-600"><span className="font-mono tabular-nums">{notes.length.toLocaleString()} / 10,000</span><span>Raw source remains visible even when AI is unavailable.</span></div>
            </section>
          </div>

          <aside className="space-y-4">
            <section className={`${glassPanel} relative overflow-hidden p-4 sm:p-5`}>
              <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/35 to-transparent" />
              <SectionTitle number="05" title="LIVE INTELLIGENCE" meta={serverDraft ? "SERVER AUTHORITATIVE" : "LOCAL PREVIEW"} tone="cyan" />
              <div className="mt-3 space-y-0.5">{extractedEntries.map(([key, value]) => {
                const ev = local.evidence.find((item) => item.field_key === key);
                return <div key={key} className="grid grid-cols-[108px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-white/[.025]"><span className="text-[9px] tracking-[.11em] text-slate-600">{FIELD_LABELS[key]}</span><span className="min-w-0 truncate font-mono text-[11px] text-slate-200">{String(value)}</span><span className={`rounded-md border px-1.5 py-0.5 text-[8px] font-mono ${serverDraft ? "border-cyan-300/20 text-cyan-200" : ev?.strength === "HIGH" ? "border-emerald-300/20 text-emerald-200" : "border-amber-300/20 text-amber-200"}`}>{serverDraft ? "SERVER" : ev?.strength ?? "REVIEW"}</span></div>;
              })}</div>
              {extractedEntries.length === 0 && <div className="grid min-h-32 place-items-center rounded-xl border border-white/[.05] bg-black/10 px-4 text-center text-xs text-slate-600">Awaiting recognizable client information.</div>}
              <div className="mt-3 flex items-center justify-between border-t border-white/[.06] pt-3 text-[10px] text-slate-600"><span>LOCAL FIELDS</span><span className="rounded-md border border-white/[.06] bg-black/15 px-2 py-1 font-mono text-slate-300">{localFields}</span></div>
            </section>

            <section className={`${glassPanel} p-4 sm:p-5`}>
              <SectionTitle number="04" title="PROCESSING PIPELINE" meta="Actual operational state" />
              <div className="mt-3 space-y-2.5">
                <Pipeline label="CAPTURE" state={submitted ? "COMPLETE" : stage === "CAPTURING" ? "RUNNING" : "WAITING"} />
                <Pipeline label="LOCAL EXTRACTION" state={notes.trim() ? "COMPLETE" : "WAITING"} />
                <Pipeline label="DOCUMENT OCR" state={!files.length ? "WAITING" : stage === "ENRICHING" ? "RUNNING" : stage === "REVIEW_REQUIRED" ? "REVIEW REQUIRED" : stage === "READY" ? "COMPLETE" : "WAITING"} />
                <Pipeline label="AI ENRICHMENT" state={!files.length ? "WAITING" : stage === "ENRICHING" ? "RUNNING" : stage === "REVIEW_REQUIRED" ? "REVIEW REQUIRED" : stage === "READY" ? "COMPLETE" : "WAITING"} />
                <Pipeline label="STAGING" state={submitted ? "COMPLETE" : "WAITING"} />
              </div>
            </section>

            {(error || issues > 0 || stage === "REVIEW_REQUIRED") && <section className="rounded-2xl border border-amber-300/20 bg-[linear-gradient(145deg,rgba(77,54,10,.16),rgba(12,10,6,.66))] p-4 shadow-[0_16px_45px_rgba(0,0,0,.24)] backdrop-blur-xl"><SectionTitle number="06" title="ISSUES & RESOLUTION" meta={`${issues || 1} item requires review`} tone="amber" />{error && <p className="mt-3 text-xs leading-5 text-amber-100">{error}</p>}<p className="mt-2 text-[10px] text-slate-500">Local data, raw source, files, Staff identity and timestamp remain preserved.</p>{result && <button type="button" onClick={() => void enrich(result)} disabled={stage === "ENRICHING"} className="mt-3 rounded-lg border border-amber-300/30 bg-amber-300/[.045] px-3 py-2 text-[10px] font-semibold tracking-[.08em] text-amber-200 transition hover:-translate-y-px hover:bg-amber-300/[.08] disabled:opacity-50">RETRY EXTRACTION</button>}</section>}
          </aside>
        </div>

        <section className={`${glassPanel} sticky bottom-3 z-20 overflow-hidden p-3.5`}>
          <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/80 to-transparent transition-all duration-700 ${completionPulse ? "opacity-100" : "opacity-0"}`} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-600"><span className="rounded-md border border-white/[.06] bg-black/15 px-2 py-1 font-mono">⌘/Ctrl + Enter</span><span>Submit</span><span className="text-slate-800">|</span><span>Source-first capture</span>{completionPulse && <span className="ml-1 inline-flex items-center gap-1.5 text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />CAPTURE COMPLETE</span>}</div>
            <div className="flex flex-wrap gap-2">{submitted ? <><button type="button" onClick={reset} className="rounded-lg border border-white/10 bg-white/[.02] px-4 py-2.5 text-[10px] font-semibold tracking-[.12em] text-slate-300 transition hover:-translate-y-px hover:bg-white/[.045]">START ANOTHER</button><Link className="rounded-lg border border-[#b8934a]/45 bg-[#b8934a]/10 px-4 py-2.5 text-[10px] font-semibold tracking-[.12em] text-[#e3c884] shadow-[inset_0_1px_0_rgba(255,255,255,.04)] transition hover:-translate-y-px hover:bg-[#b8934a]/[.16]" href="/staff/import">OPEN SMART CAREER COLLECT CLIENT</Link></> : <><button type="button" onClick={reset} disabled={busy || (!notes && files.length === 0)} className="rounded-lg border border-white/10 bg-white/[.015] px-4 py-2.5 text-[10px] font-semibold tracking-[.12em] text-slate-400 transition hover:bg-white/[.04] disabled:opacity-35">CLEAR</button><button type="button" onClick={() => void submit()} disabled={busy || (!notes.trim() && files.length === 0)} className="rounded-lg border border-[#b8934a]/50 bg-[linear-gradient(180deg,rgba(184,147,74,.16),rgba(184,147,74,.08))] px-5 py-2.5 text-[10px] font-semibold tracking-[.14em] text-[#e5ca8a] shadow-[0_8px_24px_rgba(184,147,74,.08),inset_0_1px_0_rgba(255,255,255,.05)] transition duration-150 hover:-translate-y-px hover:border-[#d4b06a]/65 hover:bg-[#b8934a]/[.18] disabled:cursor-not-allowed disabled:opacity-35">{busy ? "CAPTURING…" : "SUBMIT"}</button></>}</div>
          </div>
        </section>
      </section>
    </main>
  );
}

function Meta({ label, value, mono = false, tone = "neutral" }: { label: string; value: string; mono?: boolean; tone?: "neutral" | "cyan" }) {
  return <div><span className="block tracking-[.14em] text-slate-600">{label}</span><strong className={`mt-1 block max-w-28 truncate text-[10px] font-medium ${mono ? "font-mono tabular-nums" : ""} ${tone === "cyan" ? "text-cyan-200" : "text-slate-300"}`}>{value}</strong></div>;
}

function SectionTitle({ number, title, meta, tone = "gold" }: { number: string; title: string; meta?: string; tone?: "gold" | "cyan" | "amber" }) {
  const color = tone === "cyan" ? "text-cyan-200" : tone === "amber" ? "text-amber-200" : "text-[#d4b06a]";
  return <div className="flex flex-wrap items-center gap-2"><span className={`font-mono text-[9px] font-bold ${color}`}>{number}</span><h2 className="text-[10px] font-semibold tracking-[.16em] text-slate-300">{title}</h2>{meta && <><span className="text-slate-800">·</span><span className="text-[9px] text-slate-600">{meta}</span></>}</div>;
}

function Pipeline({ label, state }: { label: string; state: "WAITING" | "RUNNING" | "COMPLETE" | "REVIEW REQUIRED" | "FAILED" }) {
  const tone = state === "COMPLETE" ? "bg-emerald-300 text-emerald-200" : state === "RUNNING" ? "bg-cyan-300 text-cyan-200" : state === "REVIEW REQUIRED" ? "bg-amber-300 text-amber-200" : state === "FAILED" ? "bg-red-300 text-red-200" : "bg-slate-700 text-slate-600";
  const [dot, text] = tone.split(" ");
  return <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-white/[.02]"><span className="flex items-center gap-2 text-[10px] text-slate-400"><span className={`h-1.5 w-1.5 rounded-full ${dot} ${state === "RUNNING" ? "animate-pulse" : ""}`} />{label}</span><span className={`font-mono text-[9px] ${text}`}>{state}</span></div>;
}
