"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

type ResultRow = { row: number; ok: boolean; ref?: string; client_id?: string; code?: string; message?: string };
type ImportResult = { source: string; total: number; created: number; failed: number; results: ResultRow[] };

const ACCEPT = ".csv,.xlsx,.pdf,.jpg,.jpeg,.png,.webp,text/csv,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function UniversalIntakePanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const ready = Boolean(file) !== Boolean(sheetUrl.trim());
  const summary = useMemo(() => result ? [
    ["Rows", result.total], ["Created", result.created], ["Failed", result.failed], ["Source", result.source],
  ] as const : [], [result]);

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      if (file) form.set("file", file);
      else form.set("google_sheet_url", sheetUrl.trim());
      const res = await fetch("/api/staff/universal-intake", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Import failed (${res.status})`);
      setResult(data as ImportResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  function selectFile(next: File | null) {
    setFile(next);
    if (next) setSheetUrl("");
    setResult(null);
    setError(null);
  }

  return (
    <div className="ops-page">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · UNIVERSAL INTAKE</p>
          <h1>Import Applications</h1>
          <p>CSV · Excel XLSX · Google Sheets · PDF · Images</p>
        </div>
      </header>

      <section className="ops-glass-card space-y-5">
        <div
          className={`rounded-2xl border border-dashed p-8 text-center transition ${dragging ? "border-cyan-300 bg-cyan-300/[.06]" : "border-white/15 bg-white/[.02]"}`}
          onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            selectFile(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <input ref={inputRef} className="hidden" type="file" accept={ACCEPT} onChange={(e) => selectFile(e.target.files?.[0] ?? null)} />
          <p className="text-sm font-semibold text-slate-100">Drag & drop a source file</p>
          <p className="mt-1 text-xs text-slate-500">Maximum 10 MB · up to 1,000 spreadsheet rows</p>
          <button type="button" className="ops-primary-button mt-4" onClick={() => inputRef.current?.click()}>Choose file</button>
          {file && (
            <div className="mx-auto mt-4 max-w-xl rounded-xl border border-emerald-400/20 bg-emerald-400/[.05] px-4 py-3 text-left text-xs text-emerald-200">
              <strong>{file.name}</strong> · {(file.size / 1024 / 1024).toFixed(2)} MB
              <button type="button" className="ml-3 text-slate-400 underline" onClick={() => selectFile(null)}>Remove</button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-[10px] uppercase tracking-[.18em] text-slate-600"><span className="h-px flex-1 bg-white/[.06]" />or Google Sheets<span className="h-px flex-1 bg-white/[.06]" /></div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-300" htmlFor="google_sheet_url">Google Sheets URL</label>
          <input
            id="google_sheet_url"
            className="ops-input w-full"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={sheetUrl}
            onChange={(e) => { setSheetUrl(e.target.value); if (e.target.value.trim()) setFile(null); setResult(null); setError(null); }}
          />
          <p className="mt-1 text-[11px] text-slate-600">The sheet must be accessible through the provided link. Only visible source values are imported.</p>
        </div>

        <div className="rounded-xl border border-amber-400/15 bg-amber-400/[.04] p-4 text-xs text-slate-400">
          <strong className="text-amber-200">Required per client:</strong> full name + 10-digit U.S. phone. Auto-dispatch occurs only when the imported Amazon location/job/shift resolves to exactly one active catalog option. No guessed values are inserted.
        </div>

        <button type="button" className="ops-primary-button" disabled={!ready || busy} onClick={submit}>{busy ? "Importing…" : "Import applications"}</button>
        {error && <div className="rounded-xl border border-red-400/20 bg-red-400/[.05] p-3 text-sm text-red-300">{error}</div>}
      </section>

      {result && (
        <section className="ops-glass-card space-y-4">
          <div className="ops-metric-grid">
            {summary.map(([label, value]) => <div key={label} className="ops-metric"><span>{label}</span><strong>{value}</strong></div>)}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="text-slate-500"><tr className="border-b border-white/[.07]"><th className="p-3">Source row</th><th className="p-3">Result</th><th className="p-3">File</th><th className="p-3">Details</th></tr></thead>
              <tbody>
                {result.results.map((row, i) => (
                  <tr key={`${row.row}-${i}`} className="border-b border-white/[.05]">
                    <td className="p-3 font-mono text-slate-500">{row.row}</td>
                    <td className="p-3"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${row.ok ? "border-emerald-400/20 bg-emerald-400/[.06] text-emerald-300" : "border-red-400/20 bg-red-400/[.06] text-red-300"}`}>{row.ok ? "CREATED" : "NOT IMPORTED"}</span></td>
                    <td className="p-3">{row.ok && row.client_id ? <Link className="text-cyan-300 hover:text-cyan-200" href={`/staff/client/${row.client_id}`}>{row.ref}</Link> : "—"}</td>
                    <td className="p-3 text-slate-400">{row.ok ? "Imported" : `${row.code ?? "error"}: ${row.message ?? "Import failed"}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
