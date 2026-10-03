"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StaffPicker } from "@/components/staff/StaffPicker";
import { useStaff } from "@/components/staff/StaffContext";

type Status = "PENDING" | "UNDER_REVIEW" | "MISSING_DOCUMENT" | "APPROVED_FILE";
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
  id: string; source_type: string; source_row: number | null; status: Status; full_name: string | null; phone: string | null; email: string | null;
  reviewer_id: string | null; reviewer_name: string | null; document_count: number; issue_count: number; created_at: string; created_client_id: string | null;
};
type CaseDetail = {
  case: {
    id: string; status: Status; source_type: string; source_row: number | null; mapped_draft: Record<string, any>; missing_fields: unknown[]; conflicts: unknown[];
    field_evidence: Record<string, any>[]; verification_result: Record<string, any>; reviewer_id: string | null; reviewer_name: string | null;
    review_started_at: string | null; reviewed_at: string | null; document_match_confirmed: boolean; information_match_confirmed: boolean;
    created_at: string; created_client_id: string | null;
  };
  documents: { id: string; original_filename: string; mime_type: string; size_bytes: number; detected_document_type: string | null; created_at: string }[];
};

const STATUSES: Status[] = ["PENDING", "UNDER_REVIEW", "MISSING_DOCUMENT", "APPROVED_FILE"];
const LABEL: Record<Status, string> = { PENDING: "PENDING", UNDER_REVIEW: "UNDER REVIEW", MISSING_DOCUMENT: "MISSING DOCUMENT", APPROVED_FILE: "APPROVED FILE" };
const badge: Record<Status, string> = {
  PENDING: "border-cyan-300/20 bg-cyan-300/[.07] text-cyan-200",
  UNDER_REVIEW: "border-amber-300/20 bg-amber-300/[.07] text-amber-200",
  MISSING_DOCUMENT: "border-orange-300/20 bg-orange-300/[.07] text-orange-200",
  APPROVED_FILE: "border-emerald-300/20 bg-emerald-300/[.07] text-emerald-200",
};
const ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function errMessage(data: any, fallback: string) { return data?.error?.message ?? fallback; }
function text(value: unknown) { return typeof value === "string" ? value : value == null ? "" : String(value); }

export function UniversalIntakePanel() {
  const { activeStaff, me } = useStaff();
  const fileRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => { const timer = window.setTimeout(() => void loadQueue(), 150); return () => window.clearTimeout(timer); }, [loadQueue]);

  async function openCase(id: string) {
    setError(null); setNotice(null); setActionBusy("open");
    try {
      const res = await fetch(`/api/staff/smart-client-import?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, "Unable to open import"));
      const next = { case: data.case, documents: data.documents } as CaseDetail;
      setDetail(next); setDraft(structuredClone(next.case.mapped_draft)); setReviewerId(next.case.reviewer_id ?? "");
      setDocumentConfirmed(Boolean(next.case.document_match_confirmed)); setInformationConfirmed(Boolean(next.case.information_match_confirmed));
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
        body: JSON.stringify({
          mode: "stage", rows: preview.rows.map((row) => row.raw), source: preview.source,
          selected_rows: [...selectedRows], idempotency_key: crypto.randomUUID(), metadata: preview.metadata,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, `Staging failed (${res.status})`));
      setNotice(`${data.staged} import case${data.staged === 1 ? "" : "s"} staged.`);
      setPreview(null); setFile(null); setSheetUrl(""); if (fileRef.current) fileRef.current.value = "";
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
      if (action === "approve" && data.client_id) { window.location.href = `/staff/client/${data.client_id}`; return data; }
      await Promise.all([openCase(detail.case.id), loadQueue()]);
      return data;
    } catch (e) { setError(e instanceof Error ? e.message : `${action} failed`); return null; }
    finally { setActionBusy(null); }
  }

  const profile = draft?.profile ?? {};
  const setProfile = (key: string, value: string) => setDraft((current) => current ? { ...current, profile: { ...(current.profile ?? {}), [key]: value || null } } : current);
  const canApprove = Boolean(detail && draft && reviewerId && detail.case.review_started_at && documentConfirmed && informationConfirmed && detail.case.verification_result?.approval_ready);
  const issueText = useMemo(() => [...(detail?.case.missing_fields ?? []), ...(detail?.case.conflicts ?? [])].map((value) => typeof value === "string" ? value : JSON.stringify(value)), [detail]);

  async function copyMobileLink() {
    const url = `${window.location.origin}${mobilePath}`;
    try { await navigator.clipboard.writeText(url); setNotice("Mobile import link copied."); }
    catch { setError("Unable to copy the mobile link."); }
  }

  return (
    <div className="ops-page space-y-5">
      <header className="ops-hero border border-amber-200/10 bg-gradient-to-br from-[#0a1728]/95 to-[#07111f]/95">
        <div>
          <p className="ops-kicker">CAREER GATE · INTELLIGENT OPERATIONS</p>
          <h1>SMART CAREER COLLECT CLIENT</h1>
          <p>Intelligent Intake · Verification · Approval</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="ops-primary-button" type="button" onClick={() => document.getElementById("sheet-import")?.scrollIntoView({ behavior: "smooth" })}>NEW IMPORT BY SHEET</button>
          <Link className="ops-primary-button" href={mobilePath}>SMART CLIENT IMPORT BY LINK</Link>
          <button className="ops-secondary-button" type="button" onClick={copyMobileLink}>COPY MOBILE LINK</button>
          <button className="ops-secondary-button" type="button" onClick={() => setShowQr((value) => !value)}>QR</button>
        </div>
      </header>

      {showQr && <section className="ops-glass-card flex items-center gap-4"><img className="h-36 w-36 rounded-xl bg-white p-2" src="/api/staff/smart-client-import/qr" alt="QR code for secure Smart Client Import" /><div><strong className="text-slate-100">Secure mobile intake</strong><p className="mt-1 text-xs text-slate-400">Authenticated Career Gate staff only.</p></div></section>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Import status filters">
        {STATUSES.map((status) => <button key={status} type="button" onClick={() => setFilter(status)} className={`rounded-2xl border p-4 text-left transition ${filter === status ? "border-amber-300/35 bg-amber-300/[.08]" : "border-white/10 bg-white/[.035] hover:bg-white/[.055]"}`}><span className="text-[10px] font-semibold tracking-[.14em] text-slate-500">{LABEL[status]}</span><strong className="mt-2 block text-2xl text-slate-100">{counters[status]}</strong></button>)}
      </section>

      {notice && <div role="status" className="rounded-xl border border-emerald-300/20 bg-emerald-300/[.06] p-3 text-sm text-emerald-200">{notice}</div>}
      {error && <div role="alert" className="rounded-xl border border-red-300/20 bg-red-300/[.06] p-3 text-sm text-red-200">{error}</div>}

      <section id="sheet-import" className="ops-glass-card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[.18em] text-cyan-300">01</p><h2 className="text-lg font-semibold text-slate-100">NEW IMPORT BY SHEET</h2><p className="text-xs text-slate-500">CSV · XLSX · Google Sheets → Preview → Stage</p></div><div className="flex flex-wrap gap-2"><a className="ops-secondary-button" href="/api/staff/smart-client-import/template">DOWNLOAD CURRENT TEMPLATE</a><button className={`ops-secondary-button ${legacy ? "ring-1 ring-amber-300/40" : ""}`} type="button" onClick={() => setLegacy((value) => !value)}>CONVERT LEGACY SHEET</button></div></div>
        <input ref={fileRef} className="hidden" type="file" accept={ACCEPT} onChange={(e) => { setFile(e.target.files?.[0] ?? null); if (e.target.files?.[0]) setSheetUrl(""); setPreview(null); }} />
        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <button type="button" className="min-h-24 rounded-2xl border border-dashed border-white/15 bg-white/[.025] px-4 text-left hover:border-cyan-300/30" onClick={() => fileRef.current?.click()}><strong className="block text-sm text-slate-200">{file ? file.name : "Drag & Drop or Choose XLSX / CSV"}</strong><span className="mt-1 block text-xs text-slate-500">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Maximum 10 MB · 1,000 rows"}</span></button>
          <button className="ops-primary-button min-w-36" type="button" disabled={previewBusy || (!file && !sheetUrl.trim())} onClick={previewSheet}>{previewBusy ? "VALIDATING…" : "PREVIEW"}</button>
        </div>
        <div><label className="mb-1 block text-xs text-slate-400" htmlFor="google-sheet">Google Sheets URL</label><input id="google-sheet" className="ops-input w-full" value={sheetUrl} placeholder="https://docs.google.com/spreadsheets/d/..." onChange={(e) => { setSheetUrl(e.target.value); if (e.target.value.trim()) setFile(null); setPreview(null); }} /></div>
        {legacy && <div className="rounded-xl border border-amber-300/20 bg-amber-300/[.05] p-3 text-xs text-amber-100">Legacy conversion uses the canonical Career Gate alias registry, shows proposed normalized results, and requires staging/review before Client creation.</div>}

        {preview && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{[["TOTAL",preview.total],["VALID",preview.valid],["DUPLICATE",preview.duplicate],["INVALID",preview.invalid]].map(([label,value]) => <div key={label} className="rounded-xl border border-white/10 bg-black/10 p-3"><span className="text-[10px] text-slate-500">{label}</span><strong className="mt-1 block text-xl text-slate-100">{value}</strong></div>)}</div>
          <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-black/15 text-slate-500"><tr><th className="p-3">STAGE</th><th className="p-3">ROW</th><th className="p-3">STATUS</th><th className="p-3">FULL NAME</th><th className="p-3">PHONE</th><th className="p-3">EMAIL</th><th className="p-3">SITE</th><th className="p-3">JOB</th><th className="p-3">SHIFT</th><th className="p-3">DETAIL</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.row} className="border-t border-white/[.06]"><td className="p-3"><input type="checkbox" disabled={row.result === "INVALID"} checked={selectedRows.has(row.row)} onChange={(e) => setSelectedRows((current) => { const next = new Set(current); if (e.target.checked) next.add(row.row); else next.delete(row.row); return next; })} /></td><td className="p-3 font-mono text-slate-500">{row.row}</td><td className="p-3"><span className={`rounded-full border px-2 py-1 text-[10px] ${row.result === "VALID" ? "border-emerald-300/20 text-emerald-200" : row.result === "DUPLICATE" ? "border-amber-300/20 text-amber-200" : "border-red-300/20 text-red-200"}`}>{row.result}</span></td><td className="p-3">{row.full_name ?? "—"}</td><td className="p-3">{row.phone ?? "—"}</td><td className="p-3">{row.email ?? "—"}</td><td className="p-3">{row.site ?? "—"}</td><td className="p-3">{row.job ?? "—"}</td><td className="p-3">{row.shift ?? "—"}</td><td className="max-w-xs p-3 text-slate-500">{row.message ?? row.identity}</td></tr>)}</tbody></table></div>
          <button className="ops-primary-button" type="button" disabled={stageBusy || selectedRows.size === 0} onClick={stagePreview}>{stageBusy ? "STAGING…" : `STAGE SELECTED CASES (${selectedRows.size})`}</button>
        </div>}
      </section>

      <section className="ops-glass-card space-y-4">
        <div><p className="text-[10px] font-bold tracking-[.18em] text-cyan-300">02</p><h2 className="text-lg font-semibold text-slate-100">SMART CLIENT IMPORT BY LINK</h2><p className="text-xs text-slate-500">Mobile text + photos + documents → extraction → staging.</p></div>
        <div className="flex flex-wrap gap-2"><Link className="ops-primary-button" href={mobilePath}>OPEN MOBILE FORM</Link><button className="ops-secondary-button" type="button" onClick={copyMobileLink}>COPY LINK</button><button className="ops-secondary-button" type="button" onClick={() => setShowQr(true)}>QR</button></div>
      </section>

      <section className="ops-glass-card space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-100">IMPORT QUEUE</h2><p className="text-xs text-slate-500">Staged Client imports only. Canonical Client creation occurs after approval.</p></div><div className="flex gap-2"><button className={`ops-secondary-button ${filter === "ALL" ? "ring-1 ring-cyan-300/30" : ""}`} type="button" onClick={() => setFilter("ALL")}>ALL</button><input className="ops-input min-w-56" aria-label="Search imports" placeholder="Name, phone, email, Import ID" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
        <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-black/15 text-slate-500"><tr><th className="p-3">CLIENT / IMPORT</th><th className="p-3">SOURCE</th><th className="p-3">STATUS</th><th className="p-3">REVIEWER</th><th className="p-3">DOCUMENTS</th><th className="p-3">ISSUES</th><th className="p-3">CREATED</th><th className="p-3">ACTION</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-white/[.06]"><td className="p-3"><strong className="block text-slate-200">{row.full_name || "Unidentified client"}</strong><span className="font-mono text-[10px] text-slate-600">{row.id}</span></td><td className="p-3 uppercase text-slate-400">{row.source_type}</td><td className="p-3"><span className={`rounded-full border px-2 py-1 text-[10px] ${badge[row.status]}`}>{LABEL[row.status]}</span></td><td className="p-3">{row.reviewer_name ?? "—"}</td><td className="p-3">{row.document_count}</td><td className="p-3">{row.issue_count}</td><td className="p-3 text-slate-500">{new Date(row.created_at).toLocaleString()}</td><td className="p-3">{row.created_client_id ? <Link className="text-cyan-300" href={`/staff/client/${row.created_client_id}`}>OPEN CLIENT</Link> : <button className="ops-secondary-button" type="button" disabled={actionBusy === "open"} onClick={() => openCase(row.id)}>OPEN / REVIEW</button>}</td></tr>)}</tbody></table></div>
        {queueBusy && <p className="text-xs text-slate-500">Refreshing queue…</p>}
        {!queueBusy && rows.length === 0 && <p className="rounded-xl border border-white/10 p-6 text-center text-sm text-slate-500">No imports match this view.</p>}
        {nextCursor && <button className="ops-secondary-button" type="button" disabled={queueBusy} onClick={() => loadQueue(nextCursor, true)}>LOAD MORE</button>}
      </section>

      {detail && draft && <section className="ops-glass-card space-y-5" id="smart-review">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[.18em] text-amber-300">SMART CLIENT REVIEW</p><h2 className="text-lg font-semibold text-slate-100">{text(profile.full_name) || "Unidentified client"}</h2><span className={`mt-2 inline-block rounded-full border px-2 py-1 text-[10px] ${badge[detail.case.status]}`}>{LABEL[detail.case.status]}</span></div><button className="ops-secondary-button" type="button" onClick={() => { setDetail(null); setDraft(null); }}>CLOSE</button></div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/10 p-4 space-y-3"><h3 className="text-sm font-semibold text-slate-200">CLIENT DATA</h3>{[["full_name","Full Name"],["phone","Phone"],["email","Email"],["date_of_birth","Date of Birth"],["street","Street"],["city","City"],["state","State"],["zip","ZIP"]].map(([key,label]) => <label key={key} className="block text-xs text-slate-400">{label}<input className="ops-input mt-1 w-full" value={text(profile[key])} onChange={(e) => setProfile(key,e.target.value)} /></label>)}</div>
          <div className="rounded-2xl border border-white/10 bg-black/10 p-4 space-y-4"><div><h3 className="text-sm font-semibold text-slate-200">SOURCE / DOCUMENTS</h3>{detail.documents.length ? <div className="mt-2 space-y-2">{detail.documents.map((doc) => <a key={doc.id} target="_blank" rel="noreferrer" href={`/api/staff/smart-client-import/document/${doc.id}`} className="flex items-center justify-between rounded-xl border border-white/10 p-3 text-xs text-cyan-200"><span className="truncate pr-3">{doc.original_filename}</span><span>{(doc.size_bytes/1024).toFixed(0)} KB</span></a>)}</div> : <p className="mt-2 text-xs text-amber-300">No source documents are attached.</p>}</div><div><h3 className="text-sm font-semibold text-slate-200">ISSUES</h3>{issueText.length ? <ul className="mt-2 space-y-1 text-xs text-amber-200">{issueText.map((issue,i) => <li key={i} className="rounded-lg border border-amber-300/10 bg-amber-300/[.04] p-2">{issue}</li>)}</ul> : <p className="mt-2 text-xs text-emerald-300">No recorded blocking issues.</p>}</div><div><h3 className="text-sm font-semibold text-slate-200">VERIFICATION</h3><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/20 p-3 text-[11px] text-slate-400">{JSON.stringify(detail.case.verification_result ?? {}, null, 2)}</pre></div></div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/10 p-4 space-y-3"><label className="text-xs font-semibold text-slate-300">REVIEWED BY</label><StaffPicker value={reviewerId} staff={activeStaff} onChange={setReviewerId} disabled={detail.case.status === "APPROVED_FILE"} /><div className="flex flex-wrap gap-2"><button className="ops-primary-button" type="button" disabled={!reviewerId || Boolean(actionBusy) || detail.case.status === "APPROVED_FILE"} onClick={() => mutate("start_review", { reviewer_id: reviewerId })}>{actionBusy === "start_review" ? "STARTING…" : "REVIEW"}</button><button className="ops-secondary-button" type="button" disabled={!reviewerId || Boolean(actionBusy) || detail.case.status === "APPROVED_FILE"} onClick={() => mutate("save", { reviewer_id: reviewerId, draft, document_match_confirmed: documentConfirmed, information_match_confirmed: informationConfirmed })}>{actionBusy === "save" ? "SAVING…" : "SAVE"}</button><button className="ops-primary-button" type="button" disabled={!detail.case.review_started_at || Boolean(actionBusy) || detail.case.status === "APPROVED_FILE"} onClick={() => mutate("verify")}>{actionBusy === "verify" ? "VERIFYING…" : "CHECK & VERIFY"}</button></div></div>

        <div className="grid gap-3 md:grid-cols-2"><label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-xs text-slate-300"><input type="checkbox" className="mt-0.5" checked={documentConfirmed} disabled={detail.case.status === "APPROVED_FILE"} onChange={(e) => setDocumentConfirmed(e.target.checked)} /><span><strong className="block">CURRENT DOCUMENT STATUS REVIEWED</strong><span className="text-slate-500">Missing documents may remain outstanding after approval.</span></span></label><label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-xs text-slate-300"><input type="checkbox" className="mt-0.5" checked={informationConfirmed} disabled={detail.case.status === "APPROVED_FILE"} onChange={(e) => setInformationConfirmed(e.target.checked)} /><span><strong className="block">INFORMATION MATCH CONFIRMED</strong><span className="text-slate-500">Approved values match reviewed source evidence.</span></span></label></div>

        <button className="ops-primary-button w-full min-h-12" type="button" disabled={!canApprove || Boolean(actionBusy)} onClick={() => mutate("approve", { reviewer_id: reviewerId, draft, document_match_confirmed: documentConfirmed, information_match_confirmed: informationConfirmed })}>{actionBusy === "approve" ? "CREATING CANONICAL CLIENT…" : "APPROVE FILE"}</button>
        {!canApprove && detail.case.status !== "APPROVED_FILE" && <p className="text-xs text-slate-500">Approval requires reviewer, completed verification, both confirmations, valid minimum Client data, and no blocking conflict. Missing documents alone do not block approval.</p>}
      </section>}

      <footer className="pb-4 text-center text-[10px] tracking-[.14em] text-slate-700">SMART CAREER COLLECT CLIENT · {me.role.toUpperCase()} · DETERMINISTIC STAGING</footer>
    </div>
  );
}
