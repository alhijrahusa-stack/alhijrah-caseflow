"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

type RowStatus = "VALID" | "IMPORTED" | "DUPLICATE" | "REJECTED";
type ResultRow = {
  row: number;
  status: RowStatus;
  ok?: boolean;
  ref?: string;
  client_id?: string;
  existing_ref?: string;
  full_name?: string;
  phone?: string;
  email?: string | null;
  site_code?: string | null;
  shift_code?: string | null;
  staff_code?: string | null;
  code?: string;
  message?: string;
};
type PreviewResult = { mode: "preview"; source: string; total: number; valid: number; duplicates: number; rejected: number; results: ResultRow[] };
type ImportResult = { mode: "import"; source: string; total: number; created: number; duplicates: number; failed: number; results: ResultRow[] };
type IntakeResponse = PreviewResult | ImportResult;

const ACCEPT = ".csv,.xlsx,.pdf,.jpg,.jpeg,.png,.webp,text/csv,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function statusClass(status: RowStatus) {
  if (status === "VALID" || status === "IMPORTED") return "border-emerald-400/20 bg-emerald-400/[.06] text-emerald-300";
  if (status === "DUPLICATE") return "border-amber-400/20 bg-amber-400/[.06] text-amber-300";
  return "border-red-400/20 bg-red-400/[.06] text-red-300";
}

export function UniversalIntakePanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IntakeResponse | null>(null);

  const ready = Boolean(file) !== Boolean(sheetUrl.trim());
  const canImport = result?.mode === "preview" && result.valid > 0;
  const summary = useMemo(() => {
    if (!result) return [];
    return result.mode === "preview"
      ? [["Rows", result.total], ["Valid", result.valid], ["Duplicates", result.duplicates], ["Rejected", result.rejected]] as const
      : [["Rows", result.total], ["Imported", result.created], ["Duplicates", result.duplicates], ["Rejected", result.failed]] as const;
  }, [result]);

  async function submit(mode: "preview" | "import") {
    if (!ready || busy || (mode === "import" && !canImport)) return;
    setBusy(mode);
    setError(null);
    try {
      const form = new FormData();
      form.set("mode", mode);
      if (file) form.set("file", file);
      else form.set("google_sheet_url", sheetUrl.trim());
      const res = await fetch("/api/staff/universal-intake", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `${mode === "preview" ? "Preview" : "Import"} failed (${res.status})`);
      setResult(data as IntakeResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  function resetResult() {
    setResult(null);
    setError(null);
  }

  function selectFile(next: File | null) {
    setFile(next);
    if (next) setSheetUrl("");
    resetResult();
  }

  return (
    <div className="ops-page">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · UNIVERSAL INTAKE</p>
          <h1>Import Applications</h1>
          <p>Parse → Validate → Normalize → Preview → Detect Duplicates → Confirm → Batch Import → Verify</p>
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
          <p className="text-sm font-semibold text-slate-100">Drag &amp; drop a source file</p>
          <p className="mt-1 text-xs text-slate-500">Maximum 10 MB · up to 1,000 spreadsheet rows</p>
          <button type="button" className="ops-primary-button mt-4" disabled={Boolean(busy)} onClick={() => inputRef.current?.click()}>Choose file</button>
          {file && (
            <div className="mx-auto mt-4 max-w-xl rounded-xl border border-emerald-400/20 bg-emerald-400/[.05] px-4 py-3 text-left text-xs text-emerald-200">
              <strong>{file.name}</strong> · {(file.size / 1024 / 1024).toFixed(2)} MB
              <button type="button" disabled={Boolean(busy)} className="ml-3 text-slate-400 underline" onClick={() => selectFile(null)}>Remove</button>
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
            disabled={Boolean(busy)}
            onChange={(e) => { setSheetUrl(e.target.value); if (e.target.value.trim()) setFile(null); resetResult(); }}
          />
          <p className="mt-1 text-[11px] text-slate-600">Google Sheets is read through the configured official Google API integration; credentials remain server-side.</p>
        </div>

        <div className="rounded-xl border border-amber-400/15 bg-amber-400/[.04] p-4 text-xs text-slate-400">
          <strong className="text-amber-200">Deterministic import:</strong> unknown columns or ambiguous Amazon location/job/shift values are rejected instead of guessed. Existing phone/email identities are marked DUPLICATE before confirmation.
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="button" className="ops-primary-button" disabled={!ready || Boolean(busy)} onClick={() => void submit("preview")}>
            {busy === "preview" ? "Validating…" : "Preview & validate"}
          </button>
          {canImport && (
            <button type="button" className="ops-primary-button" disabled={Boolean(busy)} onClick={() => void submit("import")}>
              {busy === "import" ? "Importing…" : `Confirm import (${result.valid})`}
            </button>
          )}
        </div>
        {error && <div className="rounded-xl border border-red-400/20 bg-red-400/[.05] p-3 text-sm text-red-300">{error}</div>}
      </section>

      {result && (
        <section className="ops-glass-card space-y-4" data-testid="import-result">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="ops-kicker">{result.mode === "preview" ? "PREVIEW" : "IMPORT VERIFIED"}</p>
              <h2 className="text-lg font-semibold text-slate-100">{result.source}</h2>
            </div>
          </div>
          <div className="ops-metric-grid">
            {summary.map(([label, value]) => <div key={label} className="ops-metric"><span>{label}</span><strong>{value}</strong></div>)}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="text-slate-500"><tr className="border-b border-white/[.07]"><th className="p-3">Source row</th><th className="p-3">Status</th><th className="p-3">Client</th><th className="p-3">Location / Shift</th><th className="p-3">File</th><th className="p-3">Details</th></tr></thead>
              <tbody>
                {result.results.map((row, i) => (
                  <tr key={`${row.row}-${i}`} className="border-b border-white/[.05]">
                    <td className="p-3 font-mono text-slate-500">{row.row}</td>
                    <td className="p-3"><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusClass(row.status)}`}>{row.status}</span></td>
                    <td className="p-3 text-slate-300"><div>{row.full_name ?? "—"}</div><div className="text-slate-600">{row.phone ?? row.email ?? ""}</div></td>
                    <td className="p-3 text-slate-400">{[row.site_code, row.shift_code].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="p-3">{row.client_id ? <Link className="text-cyan-300 hover:text-cyan-200" href={`/staff/client/${row.client_id}`}>{row.ref}</Link> : row.existing_ref ?? "—"}</td>
                    <td className="p-3 text-slate-400">{row.message ?? (row.status === "VALID" ? "Ready to import" : row.status === "IMPORTED" ? "Imported and verified" : row.code ?? "—")}</td>
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
