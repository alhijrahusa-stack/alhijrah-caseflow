"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type QueueCase = {
  id: string;
  source_type: string;
  source_row: number | null;
  status: "PENDING" | "UNDER_REVIEW" | "MISSING_DOCUMENT" | "APPROVED_FILE";
  mapped_draft: {
    profile?: { full_name?: string; phone?: string; email?: string | null; [key: string]: unknown };
    primary?: unknown[];
    backup?: unknown[];
    status?: string;
    nextStep?: string | null;
    staffCode?: string | null;
  };
  missing_fields: unknown[];
  conflicts: unknown[];
  verification_result: { ready?: boolean; state?: string; missing_document?: boolean; duplicate_client?: { id: string; ref: string } | null };
  reviewer_id: string | null;
  reviewer_name: string | null;
  review_started_at: string | null;
  reviewed_at: string | null;
  document_match_confirmed: boolean;
  information_match_confirmed: boolean;
  approved_at: string | null;
  created_client_id: string | null;
  document_count: number;
  created_at: string;
  updated_at: string;
};

type Staff = { id: string; display_name: string; staff_code: string | null };
type QueuePayload = { counters: Record<string, number>; staff: Staff[]; cases: QueueCase[] };
type ApiResult = { ok?: boolean; client_id?: string; error?: { message?: string }; [key: string]: unknown };

type StageResult = {
  total: number;
  valid: number;
  duplicate: number;
  invalid: number;
  results: { row: number; case_id: string; status: "VALID" | "DUPLICATE" | "INVALID"; message: string | null }[];
};

const FILTERS = ["ALL", "PENDING", "UNDER_REVIEW", "MISSING_DOCUMENT", "APPROVED_FILE"] as const;

function labelStatus(value: string) {
  return value.replaceAll("_", " ");
}

export function SmartCareerCollectClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stageResult, setStageResult] = useState<StageResult | null>(null);
  const [queue, setQueue] = useState<QueuePayload>({ counters: {}, staff: [], cases: [] });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<QueueCase | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mobilePath = "/staff/smart-client-import/new";
  const mobileUrl = typeof window === "undefined" ? mobilePath : `${window.location.origin}${mobilePath}`;

  const loadQueue = useCallback(async (caseId?: string) => {
    const params = new URLSearchParams();
    if (filter !== "ALL") params.set("status", filter);
    if (search.trim()) params.set("q", search.trim());
    if (caseId) params.set("case_id", caseId);
    const res = await fetch(`/api/staff/smart-import?${params.toString()}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) throw new Error(body?.error?.message ?? "Could not load import queue");
    const data = body as QueuePayload & { ok: true };
    if (caseId) setSelected(data.cases[0] ?? null);
    else setQueue({ counters: data.counters, staff: data.staff, cases: data.cases });
  }, [filter, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadQueue().catch((e) => setError(e instanceof Error ? e.message : "Could not load queue")), 120);
    return () => window.clearTimeout(timer);
  }, [loadQueue]);

  const ready = Boolean(file) !== Boolean(sheetUrl.trim());

  async function stageSheet() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    setStageResult(null);
    try {
      const form = new FormData();
      if (file) form.set("file", file);
      else form.set("google_sheet_url", sheetUrl.trim());
      const res = await fetch("/api/staff/universal-intake", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error?.message ?? `Import failed (${res.status})`);
      setStageResult(body as StageResult);
      await loadQueue();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function act(payload: Record<string, unknown>): Promise<ApiResult | null> {
    const action = String(payload.action ?? "action");
    setActionBusy(action);
    setActionError(null);
    try {
      const res = await fetch("/api/staff/smart-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await res.json().catch(() => null)) as ApiResult | null;
      if (!res.ok || !body?.ok) throw new Error(body?.error?.message ?? `Action failed (${res.status})`);
      if (selected) await loadQueue(selected.id);
      await loadQueue();
      return body;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
      return null;
    } finally {
      setActionBusy(null);
    }
  }

  async function copyMobileLink() {
    await navigator.clipboard.writeText(mobileUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  const counters = useMemo(() => ({
    PENDING: queue.counters.PENDING ?? 0,
    UNDER_REVIEW: queue.counters.UNDER_REVIEW ?? 0,
    MISSING_DOCUMENT: queue.counters.MISSING_DOCUMENT ?? 0,
    APPROVED_FILE: queue.counters.APPROVED_FILE ?? 0,
  }), [queue.counters]);

  return (
    <div className="ops-page space-y-5">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · INTELLIGENT INTAKE</p>
          <h1>SMART CAREER COLLECT CLIENT</h1>
          <p>Intelligent Intake · Verification · Approval</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="ops-primary-button" type="button" onClick={() => inputRef.current?.click()}>NEW IMPORT BY SHEET</button>
          <Link className="ops-primary-button" href={mobilePath}>SMART CLIENT IMPORT BY LINK</Link>
          <button className="staff-button" type="button" onClick={copyMobileLink}>{copied ? "COPIED" : "COPY MOBILE LINK"}</button>
          <a className="staff-button" href={`https://quickchart.io/qr?size=260&text=${encodeURIComponent(mobileUrl)}`} target="_blank" rel="noreferrer">QR</a>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Import status">
        {(["PENDING", "UNDER_REVIEW", "MISSING_DOCUMENT", "APPROVED_FILE"] as const).map((status) => (
          <button key={status} type="button" onClick={() => setFilter(status)} className={`ops-glass-card text-left transition ${filter === status ? "ring-1 ring-cyan-300/50" : ""}`}>
            <span className="text-[10px] font-semibold tracking-[.15em] text-slate-400">{labelStatus(status)}</span>
            <strong className="mt-2 block text-2xl text-white">{counters[status]}</strong>
          </button>
        ))}
      </section>

      <section className="ops-glass-card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div><p className="ops-kicker">01</p><h2 className="text-lg font-semibold text-white">NEW IMPORT BY SHEET</h2></div>
          <a className="staff-button" href="/api/staff/smart-import/template">DOWNLOAD CURRENT TEMPLATE</a>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[.02] p-6 text-center">
            <input ref={inputRef} className="hidden" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setFile(e.target.files?.[0] ?? null); if (e.target.files?.[0]) setSheetUrl(""); }} />
            <p className="text-sm font-semibold text-slate-100">Drag & Drop or choose XLSX / CSV</p>
            <p className="mt-1 text-xs text-slate-500">Maximum 10 MB · 1,000 rows</p>
            <button className="ops-primary-button mt-4" type="button" onClick={() => inputRef.current?.click()}>CHOOSE FILE</button>
            {file && <p className="mt-3 text-xs text-emerald-300">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
          </div>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-300" htmlFor="sheet-url">GOOGLE SHEET</label>
            <input id="sheet-url" className="ops-input w-full" value={sheetUrl} onChange={(e) => { setSheetUrl(e.target.value); if (e.target.value.trim()) setFile(null); }} placeholder="https://docs.google.com/spreadsheets/d/..." />
            <button type="button" className="ops-primary-button w-full" disabled={!ready || busy} onClick={stageSheet}>{busy ? "STAGING…" : "STAGE IMPORT"}</button>
            {error && <div className="rounded-xl border border-red-400/20 bg-red-400/[.05] p-3 text-sm text-red-300">{error}</div>}
          </div>
        </div>
        {stageResult && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[['TOTAL',stageResult.total],['VALID',stageResult.valid],['DUPLICATE',stageResult.duplicate],['INVALID',stageResult.invalid]].map(([label,value]) => <div key={String(label)} className="ops-metric"><span>{label}</span><strong>{value}</strong></div>)}
          </div>
        )}
      </section>

      <section className="ops-glass-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="ops-kicker">QUEUE</p><h2 className="text-lg font-semibold text-white">IMPORT QUEUE</h2></div>
          <div className="flex flex-wrap gap-2">
            <input className="ops-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Client / Phone / Email / Import ID" />
            <select className="ops-input" value={filter} onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])}>
              {FILTERS.map((f) => <option key={f} value={f}>{labelStatus(f)}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-xs">
            <thead className="text-slate-500"><tr className="border-b border-white/[.07]"><th className="p-3">CLIENT / IMPORT</th><th className="p-3">SOURCE</th><th className="p-3">STATUS</th><th className="p-3">REVIEWER</th><th className="p-3">DOCUMENTS</th><th className="p-3">ISSUES</th><th className="p-3">CREATED</th><th className="p-3">ACTION</th></tr></thead>
            <tbody>
              {queue.cases.map((item) => (
                <tr key={item.id} className="border-b border-white/[.05]">
                  <td className="p-3"><strong className="block text-slate-100">{item.mapped_draft?.profile?.full_name || "Unresolved client"}</strong><span className="font-mono text-[10px] text-slate-600">{item.id.slice(0, 8)}</span></td>
                  <td className="p-3 text-slate-400">{item.source_type}</td>
                  <td className="p-3"><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[.05] px-2 py-1 text-[10px] text-cyan-200">{labelStatus(item.status)}</span></td>
                  <td className="p-3 text-slate-400">{item.reviewer_name ?? "—"}</td>
                  <td className="p-3 text-slate-300">{item.document_count}</td>
                  <td className="p-3 text-amber-300">{(item.missing_fields?.length ?? 0) + (item.conflicts?.length ?? 0)}</td>
                  <td className="p-3 text-slate-500">{new Date(item.created_at).toLocaleString()}</td>
                  <td className="p-3"><button className="staff-button" type="button" onClick={async () => { await loadQueue(item.id); }}>REVIEW</button></td>
                </tr>
              ))}
              {!queue.cases.length && <tr><td colSpan={8} className="p-8 text-center text-slate-500">No import cases match this view.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <ReviewWorkspace
          key={`${selected.id}:${selected.updated_at}`}
          item={selected}
          staff={queue.staff}
          busy={actionBusy}
          error={actionError}
          close={() => setSelected(null)}
          act={act}
        />
      )}
    </div>
  );
}

function ReviewWorkspace({ item, staff, busy, error, close, act }: { item: QueueCase; staff: Staff[]; busy: string | null; error: string | null; close: () => void; act: (payload: Record<string, unknown>) => Promise<ApiResult | null> }) {
  const router = useRouter();
  const [draft, setDraft] = useState(item.mapped_draft);
  const [reviewer, setReviewer] = useState(item.reviewer_id ?? "");
  const [docConfirmed, setDocConfirmed] = useState(item.document_match_confirmed);
  const [infoConfirmed, setInfoConfirmed] = useState(item.information_match_confirmed);
  const approved = item.status === "APPROVED_FILE";

  const profile = draft.profile ?? {};
  const setProfile = (name: string, value: string) => setDraft((d) => ({ ...d, profile: { ...(d.profile ?? {}), [name]: value || null } }));

  return (
    <section className="ops-glass-card space-y-5" aria-label="Smart Client Review">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="ops-kicker">SMART CLIENT REVIEW</p><h2 className="text-xl font-semibold text-white">{String(profile.full_name || "Unresolved client")}</h2></div>
        <div className="flex gap-2"><span className="rounded-full border border-cyan-300/20 px-3 py-2 text-xs text-cyan-200">{labelStatus(item.status)}</span><button className="staff-button" type="button" onClick={close}>CLOSE</button></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-white/[.08] bg-white/[.02] p-4">
          <h3 className="text-sm font-semibold text-white">CLIENT DATA</h3>
          <Field label="Full Name" value={String(profile.full_name ?? "")} onChange={(v) => setProfile("full_name", v)} disabled={approved} />
          <Field label="Phone" value={String(profile.phone ?? "")} onChange={(v) => setProfile("phone", v)} disabled={approved} />
          <Field label="Email" value={String(profile.email ?? "")} onChange={(v) => setProfile("email", v)} disabled={approved} />
          {!approved && <button className="staff-button" disabled={Boolean(busy)} type="button" onClick={() => act({ action: "save", case_id: item.id, mapped_draft: draft })}>{busy === "save" ? "SAVING…" : "SAVE"}</button>}
        </div>
        <div className="space-y-3 rounded-2xl border border-white/[.08] bg-white/[.02] p-4">
          <h3 className="text-sm font-semibold text-white">SOURCE / VERIFICATION</h3>
          <p className="text-xs text-slate-400">Documents: <strong className="text-slate-100">{item.document_count}</strong></p>
          <p className="text-xs text-slate-400">Missing: <strong className="text-amber-300">{item.missing_fields?.length ?? 0}</strong></p>
          <p className="text-xs text-slate-400">Conflicts: <strong className="text-red-300">{item.conflicts?.length ?? 0}</strong></p>
          {item.verification_result?.state && <p className="text-xs text-slate-300">Verification: <strong>{item.verification_result.state}</strong></p>}
          {item.verification_result?.duplicate_client && <Link className="text-xs text-red-300 underline" href={`/staff/client/${item.verification_result.duplicate_client.id}`}>Existing client {item.verification_result.duplicate_client.ref}</Link>}
          <label className="block text-xs font-medium text-slate-300">REVIEWED BY
            <select className="ops-input mt-1 w-full" disabled={approved} value={reviewer} onChange={(e) => setReviewer(e.target.value)}><option value="">Select reviewer</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.display_name}{s.staff_code ? ` · ${s.staff_code}` : ""}</option>)}</select>
          </label>
          {!approved && <div className="flex flex-wrap gap-2">
            <button className="staff-button" disabled={!reviewer || Boolean(busy)} type="button" onClick={() => act({ action: "review", case_id: item.id, reviewer_id: reviewer })}>{busy === "review" ? "STARTING…" : "REVIEW"}</button>
            <button className="ops-primary-button" disabled={!item.reviewer_id || Boolean(busy)} type="button" onClick={() => act({ action: "verify", case_id: item.id })}>{busy === "verify" ? "VERIFYING…" : "CHECK & VERIFY"}</button>
          </div>}
        </div>
      </div>

      {!approved && (
        <div className="rounded-2xl border border-white/[.08] bg-white/[.02] p-4 space-y-3">
          <label className="flex items-center gap-3 text-sm text-slate-200"><input type="checkbox" checked={docConfirmed} onChange={(e) => setDocConfirmed(e.target.checked)} /> CURRENT DOCUMENT STATUS REVIEWED</label>
          <label className="flex items-center gap-3 text-sm text-slate-200"><input type="checkbox" checked={infoConfirmed} onChange={(e) => setInfoConfirmed(e.target.checked)} /> INFORMATION MATCH CONFIRMED</label>
          <div className="flex flex-wrap gap-2">
            <button className="staff-button" disabled={Boolean(busy)} type="button" onClick={() => act({ action: "confirm", case_id: item.id, document_match_confirmed: docConfirmed, information_match_confirmed: infoConfirmed })}>SAVE CONFIRMATIONS</button>
            <button className="ops-primary-button" disabled={!item.reviewed_at || !docConfirmed || !infoConfirmed || !item.verification_result?.ready || Boolean(busy)} type="button" onClick={async () => { const result = await act({ action: "approve", case_id: item.id }); if (typeof result?.client_id === "string") router.push(`/staff/client/${result.client_id}`); }}>{busy === "approve" ? "APPROVING…" : "APPROVE FILE"}</button>
          </div>
        </div>
      )}
      {approved && item.created_client_id && <Link className="ops-primary-button inline-flex" href={`/staff/client/${item.created_client_id}`}>OPEN CLIENT FILE</Link>}
      {error && <div className="rounded-xl border border-red-400/20 bg-red-400/[.05] p-3 text-sm text-red-300">{error}</div>}
    </section>
  );
}

function Field({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return <label className="block text-xs font-medium text-slate-300">{label}<input className="ops-input mt-1 w-full" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></label>;
}
