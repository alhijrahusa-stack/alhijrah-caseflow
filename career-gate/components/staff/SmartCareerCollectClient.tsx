"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStaff } from "@/components/staff/StaffContext";

type Status = "PENDING" | "UNDER_REVIEW" | "MISSING_DOCUMENT" | "APPROVED_FILE";
type Workspace = "sheet" | "mobile";
type PreviewRow = {
  row: number;
  result: "VALID" | "DUPLICATE" | "INVALID";
  identity: "NEW" | "POSSIBLE_DUPLICATE" | "EXISTING_CLIENT";
  full_name: string | null;
  phone: string | null;
  email: string | null;
  site: string | null;
  job: string | null;
  shift: string | null;
  message: string | null;
  raw: Record<string, string | null>;
};
type Preview = { source: string; metadata: Record<string, unknown>; total: number; valid: number; duplicate: number; invalid: number; rows: PreviewRow[] };
type QueueRow = {
  id: string;
  source_type: string;
  source_row: number | null;
  status: Status;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
  document_count: number;
  issue_count: number;
  created_at: string;
  created_client_id: string | null;
};
type Evidence = {
  field_key?: string;
  value?: unknown;
  source_type?: string;
  source_document_id?: string | null;
  source_page?: number | null;
  source_text_reference?: string | null;
  verification_state?: string;
  match_score?: number;
  confidence?: number;
};
type CaseDetail = {
  case: {
    id: string;
    status: Status;
    source_type: string;
    source_row: number | null;
    mapped_draft: Record<string, any>;
    missing_fields: unknown[];
    conflicts: Record<string, any>[];
    field_evidence: Evidence[];
    verification_result: Record<string, any>;
    reviewer_id: string | null;
    reviewer_name: string | null;
    review_started_at: string | null;
    reviewed_at: string | null;
    document_match_confirmed: boolean;
    information_match_confirmed: boolean;
    created_at: string;
    created_client_id: string | null;
  };
  documents: { id: string; original_filename: string; mime_type: string; size_bytes: number; detected_document_type: string | null; extraction_metadata: Record<string, unknown>; created_at: string }[];
};

const STATUSES: Status[] = ["PENDING", "UNDER_REVIEW", "MISSING_DOCUMENT", "APPROVED_FILE"];
const STATUS_LABEL: Record<Status, string> = {
  PENDING: "PENDING",
  UNDER_REVIEW: "UNDER REVIEW",
  MISSING_DOCUMENT: "MISSING DOCUMENT",
  APPROVED_FILE: "APPROVED",
};
const ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PROFILE_FIELDS = [
  ["full_name", "FULL NAME"], ["phone", "PHONE"], ["email", "EMAIL"], ["date_of_birth", "DATE OF BIRTH"],
  ["street", "STREET"], ["city", "CITY"], ["state", "STATE"], ["zip", "ZIP"],
] as const;

function errMessage(data: any, fallback: string) { return data?.error?.message ?? fallback; }
function asText(value: unknown) { return typeof value === "string" ? value : value == null ? "" : String(value); }
function phoneIsValid(value: unknown) { const digits = asText(value).replace(/\D/g, ""); return digits.length === 10 || (digits.length === 11 && digits.startsWith("1")); }
function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }

function operationalState(row: QueueRow) {
  if (row.status === "APPROVED_FILE") return "APPROVED";
  if (row.status === "MISSING_DOCUMENT") return "REVIEW REQUIRED";
  if (row.status === "UNDER_REVIEW" && row.issue_count === 0) return "READY FOR APPROVAL";
  if (row.status === "UNDER_REVIEW") return "UNDER REVIEW";
  return "PENDING";
}

function queueReadiness(row: QueueRow) {
  if (row.status === "APPROVED_FILE") return 100;
  let score = 20;
  if (row.full_name?.trim()) score += 25;
  if (phoneIsValid(row.phone)) score += 25;
  if (row.reviewer_id) score += 10;
  if (row.document_count > 0) score += 5;
  score += Math.max(0, 15 - row.issue_count * 8);
  return clamp(score);
}

function caseReadiness(detail: CaseDetail | null, draft: Record<string, any> | null) {
  if (!detail || !draft) return 0;
  if (detail.case.status === "APPROVED_FILE") return 100;
  const profile = draft.profile ?? {};
  let score = 0;
  if (asText(profile.full_name).trim().length >= 2) score += 30;
  if (phoneIsValid(profile.phone)) score += 30;
  if (detail.case.review_started_at && detail.case.reviewer_id) score += 10;
  if (detail.case.verification_result?.checked_at) score += 15;
  if (detail.case.document_match_confirmed) score += 5;
  if (detail.case.information_match_confirmed) score += 5;
  if (detail.documents.length > 0) score += 5;
  const conflicts = Array.isArray(detail.case.conflicts) ? detail.case.conflicts.length : 0;
  score -= conflicts * 25;
  return clamp(score);
}

function fieldState(detail: CaseDetail, key: string, value: unknown) {
  const missing = detail.case.missing_fields.some((item) => String(item) === key);
  const conflict = detail.case.conflicts.some((item) => item?.field_key === key || item?.field === key);
  const evidence = detail.case.field_evidence.find((item) => item.field_key === key);
  if (conflict) return { state: "CONFLICT", score: Number(evidence?.match_score ?? 0), evidence };
  if (missing || !asText(value).trim()) return { state: "MISSING", score: 0, evidence };
  const raw = String(evidence?.verification_state ?? "").toUpperCase();
  if (["MATCHED", "VERIFIED"].includes(raw)) return { state: "VERIFIED", score: Number(evidence?.confidence ?? evidence?.match_score ?? 100), evidence };
  if (raw === "CONFLICT") return { state: "CONFLICT", score: Number(evidence?.match_score ?? 0), evidence };
  return { state: "REVIEW REQUIRED", score: Number(evidence?.confidence ?? evidence?.match_score ?? 80), evidence };
}

export function SmartCareerCollectClient() {
  const { activeStaff, me } = useStaff();
  const fileRef = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState<Workspace>("sheet");
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [legacy, setLegacy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [stageBusy, setStageBusy] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [filter, setFilter] = useState<Status | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [counters, setCounters] = useState<Record<Status, number>>({ PENDING: 0, UNDER_REVIEW: 0, MISSING_DOCUMENT: 0, APPROVED_FILE: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [reviewerId, setReviewerId] = useState("");
  const [documentConfirmed, setDocumentConfirmed] = useState(false);
  const [informationConfirmed, setInformationConfirmed] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);

  const mobilePath = "/staff/smart-client-import/new";
  const loadQueue = useCallback(async (cursor?: string | null, append = false) => {
    setQueueBusy(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "ALL") params.set("status", filter);
      if (search.trim()) params.set("q", search.trim());
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/staff/smart-client-import?${params}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, `Queue failed (${res.status})`));
      setRows((current) => append ? [...current, ...data.rows] : data.rows);
      setCounters(data.counters);
      setNextCursor(data.next_cursor ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "Queue failed"); }
    finally { setQueueBusy(false); }
  }, [filter, search]);

  useEffect(() => {
    const debounce = window.setTimeout(() => void loadQueue(), 140);
    return () => window.clearTimeout(debounce);
  }, [loadQueue]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void loadQueue(); };
    const timer = window.setInterval(refresh, 8000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadQueue]);

  async function openCase(id: string) {
    setError(null); setActionBusy("open");
    try {
      const res = await fetch(`/api/staff/smart-client-import?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, "Unable to open import"));
      const next = { case: data.case, documents: data.documents } as CaseDetail;
      setDetail(next);
      setDraft(structuredClone(next.case.mapped_draft));
      setReviewerId(next.case.reviewer_id ?? "");
      setDocumentConfirmed(Boolean(next.case.document_match_confirmed));
      setInformationConfirmed(Boolean(next.case.information_match_confirmed));
      setActiveDocumentId(next.documents[0]?.id ?? null);
      window.setTimeout(() => document.getElementById("smart-review")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to open import"); }
    finally { setActionBusy(null); }
  }

  async function previewSheet() {
    if (previewBusy || (!file && !sheetUrl.trim())) return;
    setPreviewBusy(true); setError(null); setNotice(null); setPreview(null);
    try {
      const form = new FormData();
      if (file) form.set("file", file); else form.set("google_sheet_url", sheetUrl.trim());
      if (legacy) form.set("legacy", "1");
      const res = await fetch("/api/staff/universal-intake", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, `Preview failed (${res.status})`));
      const next = data as Preview;
      setPreview(next);
      setSelectedRows(new Set(next.rows.filter((row) => row.result === "VALID").map((row) => row.row)));
    } catch (e) { setError(e instanceof Error ? e.message : "Preview failed"); }
    finally { setPreviewBusy(false); }
  }

  async function stagePreview() {
    if (!preview || stageBusy || selectedRows.size === 0) return;
    setStageBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/staff/universal-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "stage", rows: preview.rows.map((row) => row.raw), source: preview.source, selected_rows: [...selectedRows], idempotency_key: crypto.randomUUID(), metadata: preview.metadata }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, `Staging failed (${res.status})`));
      setNotice(`${data.staged} import case${data.staged === 1 ? "" : "s"} staged.`);
      setPreview(null); setFile(null); setSheetUrl("");
      if (fileRef.current) fileRef.current.value = "";
      await loadQueue();
    } catch (e) { setError(e instanceof Error ? e.message : "Staging failed"); }
    finally { setStageBusy(false); }
  }

  async function mutate(action: string, extra: Record<string, unknown> = {}) {
    if (!detail || actionBusy) return null;
    setActionBusy(action); setError(null); setNotice(null);
    try {
      const body: Record<string, unknown> = { action, id: detail.case.id, ...extra };
      const res = await fetch("/api/staff/smart-client-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, `${action} failed (${res.status})`));
      if (action === "approve" && data.client_id) {
        setNotice("Canonical client created.");
        window.location.href = `/staff/client/${data.client_id}`;
        return data;
      }
      await Promise.all([openCase(detail.case.id), loadQueue()]);
      setNotice(action === "verify" ? "Verification complete." : action === "save" ? "Review saved." : "Review started.");
      return data;
    } catch (e) { setError(e instanceof Error ? e.message : `${action} failed`); return null; }
    finally { setActionBusy(null); }
  }

  const profile = draft?.profile ?? {};
  const setProfile = (key: string, value: string) => setDraft((current) => current ? { ...current, profile: { ...(current.profile ?? {}), [key]: value || null } } : current);
  const canApprove = Boolean(detail && draft && reviewerId && detail.case.review_started_at && documentConfirmed && informationConfirmed && detail.case.verification_result?.approval_ready);
  const readiness = caseReadiness(detail, draft);
  const activeDocument = detail?.documents.find((doc) => doc.id === activeDocumentId) ?? detail?.documents[0] ?? null;

  async function copyMobileLink() {
    const url = `${window.location.origin}${mobilePath}`;
    try { await navigator.clipboard.writeText(url); setNotice("Mobile import link copied."); }
    catch { setError("Unable to copy the mobile link."); }
  }

  function focusField(key: string) {
    document.getElementById(`smart-field-${key}`)?.focus();
  }

  function jumpToEvidence(evidence?: Evidence) {
    if (!evidence?.source_document_id) return;
    setActiveDocumentId(evidence.source_document_id);
    document.getElementById("smart-document-viewer")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="ops-page space-y-5">
      <header className="ops-hero border border-amber-200/10 bg-gradient-to-br from-[#071525]/95 via-[#0a1c31]/95 to-[#07111f]/95">
        <div>
          <p className="ops-kicker">CAREER GATE · INTELLIGENT OPERATIONS</p>
          <h1>SMART CAREER COLLECT CLIENT</h1>
          <p>Intelligent Intake · Extraction · Verification · Approval</p>
        </div>
        <div className="text-right text-[10px] tracking-[.16em] text-slate-500">{me.role.toUpperCase()} · LIVE SYNC</div>
      </header>

      <section className="grid gap-3 lg:grid-cols-2" aria-label="Smart Career Collect Client workspaces">
        <button type="button" onClick={() => setWorkspace("sheet")} className={`rounded-3xl border p-5 text-left transition ${workspace === "sheet" ? "border-amber-300/35 bg-amber-300/[.08] shadow-[0_0_0_1px_rgba(212,175,55,.08)]" : "border-white/10 bg-white/[.035] hover:bg-white/[.055]"}`}>
          <span className="text-[10px] font-bold tracking-[.18em] text-amber-300">01</span><strong className="mt-2 block text-lg text-slate-100">NEW IMPORT BY SHEET</strong><span className="mt-1 block text-xs text-slate-500">Structured Import · XLSX / CSV / Google Sheets</span><span className="mt-4 inline-block text-xs font-semibold text-cyan-300">OPEN →</span>
        </button>
        <button type="button" onClick={() => setWorkspace("mobile")} className={`rounded-3xl border p-5 text-left transition ${workspace === "mobile" ? "border-amber-300/35 bg-amber-300/[.08] shadow-[0_0_0_1px_rgba(212,175,55,.08)]" : "border-white/10 bg-white/[.035] hover:bg-white/[.055]"}`}>
          <span className="text-[10px] font-bold tracking-[.18em] text-amber-300">02</span><strong className="mt-2 block text-lg text-slate-100">SMART CLIENT IMPORT BY LINK</strong><span className="mt-1 block text-xs text-slate-500">AI Document Intake · Mobile / QR / Photo / PDF / Text</span><span className="mt-4 inline-block text-xs font-semibold text-cyan-300">OPEN →</span>
        </button>
      </section>

      {notice && <div role="status" className="rounded-xl border border-emerald-300/20 bg-emerald-300/[.06] p-3 text-sm text-emerald-200">{notice}</div>}
      {error && <div role="alert" className="rounded-xl border border-red-300/20 bg-red-300/[.06] p-3 text-sm text-red-200">{error}</div>}

      {workspace === "sheet" ? (
        <section className="ops-glass-card space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[.18em] text-cyan-300">STRUCTURED IMPORT</p><h2 className="text-lg font-semibold text-slate-100">NEW IMPORT BY SHEET</h2><p className="text-xs text-slate-500">Ingest → Preview → Normalize → Validate → Stage → Review → Approve</p></div><div className="flex flex-wrap gap-2"><a className="ops-secondary-button" href="/api/staff/smart-client-import/template">DOWNLOAD TEMPLATE</a><button className={`ops-secondary-button ${legacy ? "ring-1 ring-amber-300/40" : ""}`} type="button" onClick={() => setLegacy((value) => !value)}>CONVERT LEGACY SHEET</button></div></div>
          <input ref={fileRef} className="hidden" type="file" accept={ACCEPT} onChange={(e) => { setFile(e.target.files?.[0] ?? null); if (e.target.files?.[0]) setSheetUrl(""); setPreview(null); }} />
          <div className="grid gap-3 lg:grid-cols-[1fr_auto]"><button type="button" className="min-h-24 rounded-2xl border border-dashed border-white/15 bg-white/[.025] px-4 text-left hover:border-cyan-300/30" onClick={() => fileRef.current?.click()}><strong className="block text-sm text-slate-200">{file ? file.name : "Choose XLSX / CSV"}</strong><span className="mt-1 block text-xs text-slate-500">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Maximum 10 MB · 1,000 rows"}</span></button><button className="ops-primary-button min-w-36" type="button" disabled={previewBusy || (!file && !sheetUrl.trim())} onClick={previewSheet}>{previewBusy ? "VALIDATING…" : "PREVIEW"}</button></div>
          <label className="block text-xs text-slate-400" htmlFor="google-sheet">GOOGLE SHEETS URL<input id="google-sheet" className="ops-input mt-1 w-full" value={sheetUrl} placeholder="https://docs.google.com/spreadsheets/d/..." onChange={(e) => { setSheetUrl(e.target.value); if (e.target.value.trim()) setFile(null); setPreview(null); }} /></label>
          {preview && <div className="space-y-3"><div className="grid grid-cols-2 gap-2 md:grid-cols-4">{[["TOTAL",preview.total],["VALID",preview.valid],["DUPLICATE",preview.duplicate],["INVALID",preview.invalid]].map(([label,value]) => <div key={label} className="rounded-xl border border-white/10 bg-black/10 p-3"><span className="text-[10px] text-slate-500">{label}</span><strong className="mt-1 block text-xl text-slate-100">{value}</strong></div>)}</div><div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-black/15 text-slate-500"><tr><th className="p-3">STAGE</th><th className="p-3">ROW</th><th className="p-3">STATUS</th><th className="p-3">FULL NAME</th><th className="p-3">PHONE</th><th className="p-3">EMAIL</th><th className="p-3">SITE</th><th className="p-3">JOB</th><th className="p-3">SHIFT</th><th className="p-3">ISSUE</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.row} className="border-t border-white/[.06]"><td className="p-3"><input type="checkbox" disabled={row.result === "INVALID"} checked={selectedRows.has(row.row)} onChange={(e) => setSelectedRows((current) => { const next = new Set(current); if (e.target.checked) next.add(row.row); else next.delete(row.row); return next; })} /></td><td className="p-3 font-mono text-slate-500">{row.row}</td><td className="p-3">{row.result}</td><td className="p-3">{row.full_name ?? "—"}</td><td className="p-3">{row.phone ?? "—"}</td><td className="p-3">{row.email ?? "—"}</td><td className="p-3">{row.site ?? "—"}</td><td className="p-3">{row.job ?? "—"}</td><td className="p-3">{row.shift ?? "—"}</td><td className="p-3 text-slate-500">{row.message ?? row.identity}</td></tr>)}</tbody></table></div><button className="ops-primary-button" type="button" disabled={stageBusy || selectedRows.size === 0} onClick={stagePreview}>{stageBusy ? "STAGING…" : `STAGE SELECTED (${selectedRows.size})`}</button></div>}
        </section>
      ) : (
        <section className="ops-glass-card space-y-4">
          <div><p className="text-[10px] font-bold tracking-[.18em] text-cyan-300">AI DOCUMENT INTAKE</p><h2 className="text-lg font-semibold text-slate-100">SMART CLIENT IMPORT BY LINK</h2><p className="text-xs text-slate-500">Photo / PDF / Text → Vision extraction → normalization → evidence → staged review.</p></div>
          <div className="flex flex-wrap gap-2"><Link className="ops-primary-button" href={mobilePath}>OPEN MOBILE FORM</Link><button className="ops-secondary-button" type="button" onClick={copyMobileLink}>COPY LINK</button><button className="ops-secondary-button" type="button" onClick={() => setShowQr((value) => !value)}>QR</button></div>
          {showQr && <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-black/10 p-4"><img className="h-40 w-40 rounded-xl bg-white p-2" src="/api/staff/smart-client-import/qr" alt="Smart Client Import QR" /><div><strong className="text-slate-100">Secure mobile intake</strong><p className="mt-1 text-xs text-slate-500">Authenticated staff session required.</p></div></div>}
        </section>
      )}

      <section className="ops-glass-card space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-100">IMPORT QUEUE</h2><p className="text-xs text-slate-500">Live staged files · canonical Client created only after approval.</p></div><div className="flex flex-wrap gap-2"><button className={`ops-secondary-button ${filter === "ALL" ? "ring-1 ring-cyan-300/30" : ""}`} type="button" onClick={() => setFilter("ALL")}>ALL</button><input className="ops-input min-w-56" aria-label="Search imports" placeholder="Name, phone, email, Import ID" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
        <div className="flex flex-wrap gap-2">{STATUSES.map((status) => <button key={status} type="button" onClick={() => setFilter(status)} className={`rounded-full border px-3 py-2 text-[10px] font-semibold ${filter === status ? "border-amber-300/35 bg-amber-300/[.08] text-amber-200" : "border-white/10 text-slate-500"}`}>{STATUS_LABEL[status]} · {counters[status]}</button>)}</div>
        <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full min-w-[960px] text-left text-xs"><thead className="bg-black/15 text-slate-500"><tr><th className="p-3">CLIENT</th><th className="p-3">SOURCE</th><th className="p-3">STATUS</th><th className="p-3">READY</th><th className="p-3">ISSUES</th><th className="p-3">REVIEWER</th><th className="p-3">ACTION</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-white/[.06]"><td className="p-3"><strong className="block text-slate-200">{row.full_name || "Unidentified client"}</strong><span className="font-mono text-[10px] text-slate-600">{row.id}</span></td><td className="p-3 uppercase text-slate-400">{row.source_type}</td><td className="p-3 text-slate-300">{operationalState(row)}</td><td className="p-3"><div className="w-24"><div className="mb-1 text-[10px] text-slate-400">{queueReadiness(row)}%</div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-300/70" style={{ width: `${queueReadiness(row)}%` }} /></div></div></td><td className="p-3">{row.issue_count}</td><td className="p-3">{row.reviewer_name ?? "—"}</td><td className="p-3">{row.created_client_id ? <Link className="text-cyan-300" href={`/staff/client/${row.created_client_id}`}>OPEN CLIENT</Link> : <button className="ops-secondary-button" type="button" disabled={actionBusy === "open"} onClick={() => openCase(row.id)}>OPEN / REVIEW</button>}</td></tr>)}</tbody></table></div>
        {queueBusy && <p className="text-xs text-slate-500">Live sync…</p>}
        {!queueBusy && rows.length === 0 && <p className="rounded-xl border border-white/10 p-6 text-center text-sm text-slate-500">No imports match this view.</p>}
        {nextCursor && <button className="ops-secondary-button" type="button" disabled={queueBusy} onClick={() => loadQueue(nextCursor, true)}>LOAD MORE</button>}
      </section>

      {detail && draft && <section id="smart-review" className="ops-glass-card space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[.18em] text-amber-300">SMART CLIENT REVIEW</p><h2 className="text-xl font-semibold text-slate-100">{asText(profile.full_name) || "Unidentified client"}</h2><p className="mt-1 text-xs text-slate-500">{detail.case.id}</p></div><button className="ops-secondary-button" type="button" onClick={() => { setDetail(null); setDraft(null); }}>CLOSE</button></div>

        <div className="rounded-2xl border border-white/10 bg-black/10 p-4"><div className="flex items-center justify-between"><div><span className="text-[10px] font-semibold tracking-[.16em] text-slate-500">FILE READINESS</span><strong className="mt-1 block text-2xl text-slate-100">{readiness}% READY</strong></div><div className="text-right text-xs text-slate-500"><div>{detail.case.missing_fields.length} missing</div><div>{detail.case.conflicts.length} conflicts</div></div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-300/70 transition-[width] duration-150" style={{ width: `${readiness}%` }} /></div></div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
          <div id="smart-document-viewer" className="rounded-2xl border border-white/10 bg-black/10 p-4"><h3 className="text-sm font-semibold text-slate-200">DOCUMENT VIEWER</h3>{activeDocument ? <><div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-[#02070d]">{activeDocument.mime_type.startsWith("image/") ? <img className="max-h-[560px] w-full object-contain" src={`/api/staff/smart-client-import/document/${activeDocument.id}`} alt={activeDocument.original_filename} /> : <iframe title={activeDocument.original_filename} className="h-[560px] w-full" src={`/api/staff/smart-client-import/document/${activeDocument.id}`} />}</div><div className="mt-3 flex flex-wrap gap-2">{detail.documents.map((doc) => <button key={doc.id} className={`rounded-lg border px-2 py-1 text-[10px] ${activeDocument.id === doc.id ? "border-cyan-300/30 text-cyan-200" : "border-white/10 text-slate-500"}`} type="button" onClick={() => setActiveDocumentId(doc.id)}>{doc.original_filename}</button>)}</div></> : <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-4 text-xs text-amber-200">No source document attached. Missing documents remain follow-up items and are not fabricated.</p>}</div>

          <div className="rounded-2xl border border-white/10 bg-black/10 p-4"><h3 className="text-sm font-semibold text-slate-200">CLIENT DATA · VALIDATION MATRIX</h3><div className="mt-3 space-y-2">{PROFILE_FIELDS.map(([key,label]) => { const info = fieldState(detail, key, profile[key]); return <div key={key} className="rounded-xl border border-white/[.08] bg-white/[.02] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="text-[10px] font-semibold tracking-[.12em] text-slate-500">{label}</span><input id={`smart-field-${key}`} className="ops-input mt-1 w-full min-w-[240px]" value={asText(profile[key])} onChange={(e) => setProfile(key, e.target.value)} /></div><div className="text-right"><strong className={info.state === "VERIFIED" ? "text-emerald-300" : info.state === "CONFLICT" ? "text-red-300" : info.state === "MISSING" ? "text-amber-300" : "text-cyan-300"}>{info.state}</strong><span className="mt-1 block text-[10px] text-slate-500">{clamp(info.score)}% · {info.evidence?.source_type ?? "manual/staged"}</span></div></div><div className="mt-2 flex flex-wrap gap-2"><button className="ops-secondary-button" type="button" onClick={() => focusField(key)}>EDIT</button>{info.evidence?.source_document_id && <button className="ops-secondary-button" type="button" onClick={() => jumpToEvidence(info.evidence)}>VIEW SOURCE</button>}</div></div>; })}</div></div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/10 p-4 space-y-3"><label className="text-xs font-semibold text-slate-300" htmlFor="smart-reviewer">REVIEWED BY</label><select id="smart-reviewer" className="ops-input w-full" value={reviewerId} disabled={detail.case.status === "APPROVED_FILE"} onChange={(e) => setReviewerId(e.target.value)}><option value="">Unassigned</option>{activeStaff.map((member) => <option key={member.id} value={member.id}>{member.display_name} · {member.staff_code ?? member.role}</option>)}</select><div className="flex flex-wrap gap-2"><button className="ops-primary-button" type="button" disabled={!reviewerId || Boolean(actionBusy) || detail.case.status === "APPROVED_FILE"} onClick={() => mutate("start_review", { reviewer_id: reviewerId })}>{actionBusy === "start_review" ? "STARTING…" : "REVIEW"}</button><button className="ops-secondary-button" type="button" disabled={!reviewerId || Boolean(actionBusy) || detail.case.status === "APPROVED_FILE"} onClick={() => mutate("save", { reviewer_id: reviewerId, draft, document_match_confirmed: documentConfirmed, information_match_confirmed: informationConfirmed })}>{actionBusy === "save" ? "SAVING…" : "SAVE"}</button><button className="ops-primary-button" type="button" disabled={!detail.case.review_started_at || Boolean(actionBusy) || detail.case.status === "APPROVED_FILE"} onClick={() => mutate("verify")}>{actionBusy === "verify" ? "VERIFYING…" : "CHECK & VERIFY"}</button></div></div>

        <div className="grid gap-3 md:grid-cols-2"><label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-xs text-slate-300"><input type="checkbox" className="mt-0.5" checked={documentConfirmed} disabled={detail.case.status === "APPROVED_FILE"} onChange={(e) => setDocumentConfirmed(e.target.checked)} /><span><strong className="block">CURRENT DOCUMENT STATUS REVIEWED</strong><span className="text-slate-500">Missing documents may remain outstanding after approval.</span></span></label><label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-xs text-slate-300"><input type="checkbox" className="mt-0.5" checked={informationConfirmed} disabled={detail.case.status === "APPROVED_FILE"} onChange={(e) => setInformationConfirmed(e.target.checked)} /><span><strong className="block">INFORMATION MATCH CONFIRMED</strong><span className="text-slate-500">Approved values match reviewed source evidence.</span></span></label></div>

        <button className="ops-primary-button min-h-12 w-full" type="button" disabled={!canApprove || Boolean(actionBusy)} onClick={() => mutate("approve", { reviewer_id: reviewerId, draft, document_match_confirmed: documentConfirmed, information_match_confirmed: informationConfirmed })}>{actionBusy === "approve" ? "CREATING CANONICAL CLIENT…" : "APPROVE FILE"}</button>
        {!canApprove && detail.case.status !== "APPROVED_FILE" && <p className="text-xs text-slate-500">Approval requires reviewer, completed verification, both confirmations, valid minimum Client data, and no blocking conflict. Missing documents alone do not block approval.</p>}
      </section>}
    </div>
  );
}
