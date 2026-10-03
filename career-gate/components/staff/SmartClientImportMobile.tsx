"use client";

import Link from "next/link";
import { useRef, useState } from "react";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf";

export function SmartClientImportMobile() {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);

  function addFiles(next: FileList | null) {
    if (!next) return;
    setFiles((current) => {
      const byKey = new Map(current.map((f) => [`${f.name}:${f.size}:${f.lastModified}`, f]));
      for (const file of Array.from(next)) byKey.set(`${file.name}:${file.size}:${file.lastModified}`, file);
      return [...byKey.values()].slice(0, 10);
    });
    setError(null);
  }

  async function submit() {
    if (busy || (!notes.trim() && files.length === 0)) return;
    setBusy(true);
    setError(null);
    setProgress("Uploading and staging…");
    try {
      const form = new FormData();
      form.set("notes", notes);
      for (const file of files) form.append("files", file);
      const res = await fetch("/api/staff/smart-import/mobile", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error?.message ?? `Submission failed (${res.status})`);
      setCaseId(body.case_id);
      setProgress(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  if (caseId) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <section className="ops-glass-card text-center space-y-4">
          <p className="ops-kicker">CAREER GATE</p>
          <h1 className="text-2xl font-semibold text-white">IMPORT RECEIVED</h1>
          <p className="text-sm text-emerald-300">STATUS: PENDING</p>
          <p className="font-mono text-[11px] text-slate-500">{caseId}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" className="ops-primary-button" onClick={() => { setCaseId(null); setFiles([]); setNotes(""); }}>START ANOTHER</button>
            <Link className="staff-button" href="/staff/import">OPEN SMART CAREER COLLECT CLIENT</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:py-10">
      <header className="mb-5">
        <p className="ops-kicker">CAREER GATE</p>
        <h1 className="text-2xl font-semibold tracking-tight text-white">SMART CLIENT IMPORT</h1>
        <p className="mt-1 text-sm text-slate-400">Secure Internal Intake</p>
      </header>

      <section className="ops-glass-card space-y-5">
        <div className="grid grid-cols-2 gap-2">
          <input ref={cameraRef} className="hidden" type="file" accept="image/*" capture="environment" multiple onChange={(e) => addFiles(e.target.files)} />
          <input ref={inputRef} className="hidden" type="file" accept={ACCEPT} multiple onChange={(e) => addFiles(e.target.files)} />
          <button type="button" className="ops-primary-button min-h-12" onClick={() => cameraRef.current?.click()}>TAKE PHOTO</button>
          <button type="button" className="staff-button min-h-12" onClick={() => inputRef.current?.click()}>ADD FILES</button>
        </div>

        <label className="block text-xs font-semibold tracking-wide text-slate-300" htmlFor="smart-notes">CLIENT INFORMATION / NOTES</label>
        <textarea id="smart-notes" className="ops-input min-h-40 w-full resize-y" maxLength={12000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Paste or type the client information exactly as provided. Missing values may be left missing." />
        <div className="flex justify-between text-[11px] text-slate-500"><span>{notes.length.toLocaleString()} / 12,000</span><span>{files.length} / 10 files</span></div>

        <div className="space-y-2">
          <h2 className="text-xs font-semibold tracking-wide text-slate-300">ATTACHED FILES</h2>
          {files.map((file, index) => (
            <div key={`${file.name}:${file.size}:${file.lastModified}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/[.08] bg-white/[.02] px-3 py-3 text-xs">
              <div className="min-w-0"><strong className="block truncate text-slate-200">{file.name}</strong><span className="text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</span></div>
              <button type="button" className="text-red-300 underline" disabled={busy} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>Remove</button>
            </div>
          ))}
          {!files.length && <div className="rounded-xl border border-dashed border-white/[.08] p-5 text-center text-xs text-slate-600">No files attached.</div>}
        </div>

        {progress && <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[.05] p-3 text-sm text-cyan-200" role="status">{progress}</div>}
        {error && <div className="rounded-xl border border-red-400/20 bg-red-400/[.05] p-3 text-sm text-red-300" role="alert">{error}</div>}

        <button type="button" className="ops-primary-button sticky bottom-3 w-full min-h-12" disabled={busy || (!notes.trim() && files.length === 0)} onClick={submit}>{busy ? "SUBMITTING…" : "SUBMIT"}</button>
      </section>
    </div>
  );
}
