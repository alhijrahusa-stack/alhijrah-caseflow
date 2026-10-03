"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

export function MobileSmartImportForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ case_id: string } | null>(null);
  const totalMb = useMemo(() => files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024, [files]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, 10);
    setFiles(next);
    setError(null);
  }

  async function submit() {
    if (busy || (!notes.trim() && files.length === 0)) return;
    setBusy(true);
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
      setSuccess({ case_id: data.case_id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setFiles([]);
    setNotes("");
    setError(null);
    setSuccess(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  if (success) {
    return (
      <main className="min-h-screen bg-[#06101d] px-4 py-8 text-slate-100">
        <section className="mx-auto max-w-xl rounded-3xl border border-emerald-300/20 bg-white/[.045] p-6 shadow-2xl backdrop-blur-md">
          <p className="text-[11px] font-bold tracking-[.22em] text-emerald-300">CAREER GATE</p>
          <h1 className="mt-3 text-2xl font-semibold">IMPORT RECEIVED</h1>
          <p className="mt-2 text-sm text-slate-400">STATUS: <span className="font-semibold text-amber-300">PENDING</span></p>
          <p className="mt-4 break-all rounded-xl border border-white/10 bg-black/15 p-3 font-mono text-xs text-slate-400">{success.case_id}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button className="ops-primary-button min-h-12" type="button" onClick={reset}>START ANOTHER</button>
            <Link className="ops-secondary-button flex min-h-12 items-center justify-center" href="/staff/import">OPEN SMART CAREER COLLECT CLIENT</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#06101d] px-4 py-6 text-slate-100">
      <section className="mx-auto max-w-xl space-y-5">
        <header className="rounded-3xl border border-amber-200/15 bg-white/[.045] p-5 shadow-2xl backdrop-blur-md">
          <p className="text-[10px] font-bold tracking-[.22em] text-amber-300">CAREER GATE</p>
          <h1 className="mt-2 text-2xl font-semibold">SMART CLIENT IMPORT</h1>
          <p className="mt-1 text-sm text-slate-400">Secure Internal Intake</p>
        </header>

        <section className="rounded-3xl border border-white/10 bg-white/[.04] p-5 backdrop-blur-md">
          <input ref={inputRef} className="hidden" type="file" accept={ACCEPT} multiple onChange={(e) => addFiles(e.target.files)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <button className="ops-primary-button min-h-12" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>TAKE PHOTO / ADD FILES</button>
            <button className="ops-secondary-button min-h-12" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>UPLOAD DOCUMENTS</button>
          </div>
          <p className="mt-3 text-xs text-slate-500">PDF · JPG · PNG · WebP · up to 10 files · 25 MB total</p>
          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400"><span>{files.length} attached</span><span>{totalMb.toFixed(2)} MB</span></div>
              {files.map((file, index) => (
                <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-xs">
                  <span className="min-w-0 truncate pr-3">{file.name}</span>
                  <button type="button" className="text-red-300" disabled={busy} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[.04] p-5 backdrop-blur-md">
          <label className="mb-2 block text-xs font-semibold tracking-wide text-slate-300" htmlFor="smart-import-notes">CLIENT INFORMATION / NOTES</label>
          <textarea id="smart-import-notes" className="ops-input min-h-40 w-full resize-y" maxLength={10000} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} placeholder="Enter available client information. Missing facts may remain missing; the system will not invent them." />
          <div className="mt-2 text-right text-[11px] text-slate-600">{notes.length}/10000</div>
        </section>

        {error && <div role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/[.06] p-4 text-sm text-red-200">{error}</div>}

        <button type="button" className="ops-primary-button sticky bottom-4 min-h-14 w-full shadow-2xl" disabled={busy || (!notes.trim() && files.length === 0)} onClick={submit}>
          {busy ? "PROCESSING SECURE IMPORT…" : "SUBMIT"}
        </button>
      </section>
    </main>
  );
}
