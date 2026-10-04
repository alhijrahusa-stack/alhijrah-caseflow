"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStaff } from "@/components/staff/StaffContext";
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
  if (stage === "READY") return "border-emerald-400/30 bg-emerald-400/[.07] text-emerald-300";
  if (stage === "REVIEW_REQUIRED") return "border-amber-400/30 bg-amber-400/[.07] text-amber-300";
  if (stage === "CAPTURING" || stage === "ENRICHING") return "border-cyan-400/30 bg-cyan-400/[.07] text-cyan-300";
  return "border-white/10 bg-white/[.025] text-slate-400";
}

export function MobileSmartImportForm() {
  const { me } = useStaff();
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionStart = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [stage, setStage] = useState<Stage>("DRAFT");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [serverDraft, setServerDraft] = useState<Record<string, unknown> | null>(null);
  const [verification, setVerification] = useState<Record<string, unknown> | null>(null);
  const local = useMemo(() => extractDeterministicClient(notes), [notes]);
  const totalMb = useMemo(() => files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024, [files]);
  const busy = stage === "CAPTURING";
  const submitted = Boolean(result);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - sessionStart.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
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
        uploaded_by_name: data.uploaded_by_name ?? me.display_name,
        mapped_draft: data.mapped_draft,
        verification_result: data.verification_result,
        enrichment_url: data.enrichment_url,
      };
      setResult(captured);
      setServerDraft(data.mapped_draft?.profile ?? null);
      setVerification(data.verification_result ?? null);
      setStage("CAPTURED");
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
    sessionStart.current = Date.now();
    setElapsed(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  const extracted = serverDraft ?? local.row;
  const issues = Array.isArray(verification?.extraction_errors) ? verification?.extraction_errors.length : 0;
  const localFields = local.evidence.length;

  return (
    <main className="min-h-screen bg-[#03060d] px-3 py-4 text-slate-200 sm:px-5 lg:px-6">
      <div className="pointer-events-none fixed inset-0 opacity-30 [background-image:radial-gradient(circle_at_1px_1px,rgba(148,163,184,.08)_1px,transparent_0)] [background-size:24px_24px]" />
      <section className="relative mx-auto max-w-[1380px] space-y-3">
        <header className="rounded-xl border border-white/[.08] bg-[#05080f]/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.025)] backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold tracking-[.22em] text-[#b8934a]">CAREER GATE · EXECUTIVE INTAKE</p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">SMART CLIENT IMPORT</h1>
              <p className="mt-1 text-xs text-slate-500">Secure Internal Intake · Local Intelligence · Vision/OCR</p>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-[10px] sm:grid-cols-5">
              <Meta label="STAFF" value={result?.uploaded_by_name ?? me.display_name} />
              <Meta label="FILES" value={String(files.length)} mono />
              <Meta label="SESSION" value={submitted ? "SUBMITTED" : "DRAFT"} />
              <Meta label="TIME" value={formatElapsed(elapsed)} mono tone="cyan" />
              <div><span className="block tracking-[.14em] text-slate-600">STATUS</span><span className={`mt-1 inline-flex rounded-md border px-2 py-1 font-mono text-[9px] ${statusTone(stage)}`}>{stage.replaceAll("_", " ")}</span></div>
            </div>
          </div>
          {result && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-white/[.06] pt-3 text-[10px] text-slate-500"><span>CASE <b className="font-mono font-medium text-slate-300">{result.case_id}</b></span><span>UPLOADED <b className="font-mono font-medium text-slate-300">{formatDate(result.created_at)}</b></span></div>}
        </header>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
          <div className="space-y-3">
            <section className="rounded-xl border border-white/[.08] bg-[#05080f]/85 p-4 backdrop-blur-sm">
              <SectionTitle number="02" title="SOURCE" meta={`${files.length} files · ${totalMb.toFixed(2)} MB`} />
              <input ref={inputRef} className="hidden" type="file" accept={ACCEPT} multiple disabled={busy || submitted} onChange={(e) => addFiles(e.target.files)} />
              <button type="button" disabled={busy || submitted} onClick={() => inputRef.current?.click()} className="mt-3 flex min-h-20 w-full items-center justify-between rounded-lg border border-dashed border-white/10 bg-white/[.02] px-4 text-left transition hover:border-[#b8934a]/35 hover:bg-white/[.035] disabled:cursor-not-allowed disabled:opacity-50"><span><strong className="block text-sm text-slate-200">TAKE PHOTO / ADD FILES</strong><span className="mt-1 block text-[10px] text-slate-600">PDF · JPG · PNG · WebP · max 10 files · 25 MB total</span></span><span className="text-lg text-[#b8934a]">＋</span></button>
              {files.length > 0 && <div className="mt-3 space-y-1.5">{files.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-white/[.06] bg-black/20 px-3 py-2"><div className="min-w-0"><strong className="block truncate text-xs font-medium text-slate-200">{file.name}</strong><span className="text-[10px] font-mono text-slate-600">{file.type || "file"} · {(file.size / 1024 / 1024).toFixed(2)} MB · {submitted ? "STORED" : "STAGED"}</span></div>{!submitted && <button type="button" className="text-[10px] text-red-300" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>REMOVE</button>}</div>)}</div>}
            </section>

            <section className="rounded-xl border border-white/[.08] bg-[#05080f]/85 p-4 backdrop-blur-sm">
              <div className="flex flex-wrap items-center justify-between gap-3"><SectionTitle number="03" title="CLIENT SOURCE DATA" meta="Raw submitted information" /><div className="flex gap-4 text-[9px] text-slate-600"><span>UPLOADED BY <b className="ml-1 text-slate-400">{result?.uploaded_by_name ?? me.display_name}</b></span><span>UPLOADED AT <b className="ml-1 font-mono text-slate-400">{result ? formatDate(result.created_at) : "pending"}</b></span></div></div>
              <textarea className="mt-3 min-h-56 w-full resize-y rounded-lg border border-white/[.08] bg-[#02050a] p-3.5 font-mono text-[12px] leading-6 text-slate-200 outline-none transition focus:border-cyan-400/35 disabled:opacity-70" maxLength={10000} value={notes} disabled={submitted} onChange={(e) => setNotes(e.target.value)} placeholder="Paste the client's known information here. Missing facts remain unresolved; the system does not invent them." />
              <div className="mt-2 flex items-center justify-between text-[10px] text-slate-600"><span>{notes.length.toLocaleString()} / 10,000</span><span>Raw source remains visible even when AI is unavailable.</span></div>
            </section>
          </div>

          <aside className="space-y-3">
            <section className="rounded-xl border border-cyan-400/15 bg-[#05080f]/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.025)]">
              <SectionTitle number="05" title="LIVE INTELLIGENCE" meta={serverDraft ? "SERVER AUTHORITATIVE" : "LOCAL PREVIEW"} tone="cyan" />
              <div className="mt-3 space-y-1">{Object.entries(extracted).filter(([key, value]) => key in FIELD_LABELS && value != null && String(value).trim()).map(([key, value]) => {
                const ev = local.evidence.find((item) => item.field_key === key);
                return <div key={key} className="grid grid-cols-[110px_1fr_auto] items-center gap-2 border-b border-white/[.055] py-2 last:border-0"><span className="text-[9px] tracking-[.11em] text-slate-600">{FIELD_LABELS[key]}</span><span className="min-w-0 truncate font-mono text-[11px] text-slate-200">{String(value)}</span><span className={`text-[9px] font-mono ${ev?.strength === "HIGH" ? "text-emerald-300" : "text-amber-300"}`}>{serverDraft ? "SERVER" : ev?.strength ?? "REVIEW"}</span></div>;
              })}</div>
              {Object.entries(extracted).filter(([key, value]) => key in FIELD_LABELS && value != null && String(value).trim()).length === 0 && <div className="py-8 text-center text-xs text-slate-600">Awaiting recognizable client information.</div>}
              <div className="mt-3 border-t border-white/[.06] pt-3 text-[10px] text-slate-600">LOCAL FIELDS <span className="font-mono text-slate-300">{localFields}</span></div>
            </section>

            <section className="rounded-xl border border-white/[.08] bg-[#05080f]/85 p-4">
              <SectionTitle number="04" title="PROCESSING PIPELINE" meta="Actual operational state" />
              <div className="mt-3 space-y-2">
                <Pipeline label="CAPTURE" state={submitted ? "COMPLETE" : stage === "CAPTURING" ? "RUNNING" : "WAITING"} />
                <Pipeline label="LOCAL EXTRACTION" state={notes.trim() ? "COMPLETE" : "WAITING"} />
                <Pipeline label="DOCUMENT OCR" state={!files.length ? "WAITING" : stage === "ENRICHING" ? "RUNNING" : stage === "REVIEW_REQUIRED" ? "REVIEW REQUIRED" : stage === "READY" ? "COMPLETE" : "WAITING"} />
                <Pipeline label="AI ENRICHMENT" state={!files.length ? "WAITING" : stage === "ENRICHING" ? "RUNNING" : stage === "REVIEW_REQUIRED" ? "REVIEW REQUIRED" : stage === "READY" ? "COMPLETE" : "WAITING"} />
                <Pipeline label="STAGING" state={submitted ? "COMPLETE" : "WAITING"} />
              </div>
            </section>

            {(error || issues > 0 || stage === "REVIEW_REQUIRED") && <section className="rounded-xl border border-amber-400/20 bg-amber-400/[.035] p-4"><SectionTitle number="06" title="ISSUES & RESOLUTION" meta={`${issues || 1} item requires review`} tone="amber" />{error && <p className="mt-3 text-xs leading-5 text-amber-200">{error}</p>}<p className="mt-2 text-[10px] text-slate-500">Local data, raw source, files, Staff identity and timestamp remain preserved.</p>{result && <button type="button" onClick={() => void enrich(result)} disabled={stage === "ENRICHING"} className="mt-3 rounded-md border border-amber-400/30 px-3 py-2 text-[10px] font-semibold text-amber-300 hover:bg-amber-400/[.07] disabled:opacity-50">RETRY EXTRACTION</button>}</section>}
          </aside>
        </div>

        <section className="sticky bottom-3 rounded-xl border border-white/[.08] bg-[#05080f]/95 p-3 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[10px] text-slate-600"><span className="font-mono">⌘/Ctrl + Enter</span> · Submit <span className="mx-2 text-slate-800">|</span> Source-first capture</div>
            <div className="flex flex-wrap gap-2">{submitted ? <><button type="button" onClick={reset} className="rounded-md border border-white/10 px-4 py-2.5 text-[10px] font-semibold tracking-[.12em] text-slate-300 hover:bg-white/[.04]">START ANOTHER</button><Link className="rounded-md border border-[#b8934a]/45 bg-[#b8934a]/10 px-4 py-2.5 text-[10px] font-semibold tracking-[.12em] text-[#d4b06a] hover:bg-[#b8934a]/15" href="/staff/import">OPEN SMART CAREER COLLECT CLIENT</Link></> : <><button type="button" onClick={reset} disabled={busy || (!notes && files.length === 0)} className="rounded-md border border-white/10 px-4 py-2.5 text-[10px] font-semibold tracking-[.12em] text-slate-400 disabled:opacity-35">CLEAR</button><button type="button" onClick={() => void submit()} disabled={busy || (!notes.trim() && files.length === 0)} className="rounded-md border border-[#b8934a]/50 bg-[#b8934a]/10 px-5 py-2.5 text-[10px] font-semibold tracking-[.14em] text-[#d4b06a] hover:bg-[#b8934a]/16 disabled:cursor-not-allowed disabled:opacity-35">{busy ? "CAPTURING…" : "SUBMIT"}</button></>}</div>
          </div>
        </section>
      </section>
    </main>
  );
}

function Meta({ label, value, mono = false, tone = "neutral" }: { label: string; value: string; mono?: boolean; tone?: "neutral" | "cyan" }) {
  return <div><span className="block tracking-[.14em] text-slate-600">{label}</span><strong className={`mt-1 block text-[10px] font-medium ${mono ? "font-mono tabular-nums" : ""} ${tone === "cyan" ? "text-cyan-300" : "text-slate-300"}`}>{value}</strong></div>;
}

function SectionTitle({ number, title, meta, tone = "gold" }: { number: string; title: string; meta?: string; tone?: "gold" | "cyan" | "amber" }) {
  const color = tone === "cyan" ? "text-cyan-300" : tone === "amber" ? "text-amber-300" : "text-[#b8934a]";
  return <div className="flex flex-wrap items-center gap-2"><span className={`font-mono text-[9px] font-bold ${color}`}>{number}</span><h2 className="text-[10px] font-semibold tracking-[.16em] text-slate-400">{title}</h2>{meta && <><span className="text-slate-800">·</span><span className="text-[9px] text-slate-600">{meta}</span></>}</div>;
}

function Pipeline({ label, state }: { label: string; state: "WAITING" | "RUNNING" | "COMPLETE" | "REVIEW REQUIRED" | "FAILED" }) {
  const tone = state === "COMPLETE" ? "bg-emerald-400 text-emerald-300" : state === "RUNNING" ? "bg-cyan-400 text-cyan-300" : state === "REVIEW REQUIRED" ? "bg-amber-400 text-amber-300" : state === "FAILED" ? "bg-red-400 text-red-300" : "bg-slate-700 text-slate-600";
  const [dot, text] = tone.split(" ");
  return <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-[10px] text-slate-400"><span className={`h-1.5 w-1.5 rounded-full ${dot} ${state === "RUNNING" ? "animate-pulse" : ""}`} />{label}</span><span className={`font-mono text-[9px] ${text}`}>{state}</span></div>;
}
