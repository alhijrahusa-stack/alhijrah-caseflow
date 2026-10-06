"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStaff } from "@/components/staff/StaffContext";
import { DigitalHandshake, useDigitalHandshake } from "@/components/staff/smart/DigitalHandshake";
import {
  SMART_FIELDS,
  smartFieldText,
  smartRequiredReadiness,
  type SmartEvidence,
  type SmartField,
} from "@/components/staff/smart/field-contract";
import { ValidationMatrix, type MatrixCommit } from "@/components/staff/smart/ValidationMatrix";

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
type Evidence = SmartEvidence;
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
const STATUS_LABEL: Record<Status, string> = { PENDING: "PENDING", UNDER_REVIEW: "UNDER REVIEW", MISSING_DOCUMENT: "MISSING DOCUMENT", APPROVED_FILE: "APPROVED" };
const ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const REATTACH_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

function errMessage(data: any, fallback: string) { return data?.error?.message ?? fallback; }
function asText(value: unknown) { return Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : value == null ? "" : String(value); }
function operationalState(row: QueueRow) {
  if (row.status === "APPROVED_FILE") return "APPROVED";
  if (row.status === "MISSING_DOCUMENT") return "REVIEW REQUIRED";
  if (row.status === "UNDER_REVIEW" && row.issue_count === 0) return "READY FOR VERIFICATION";
  if (row.status === "UNDER_REVIEW") return "UNDER REVIEW";
  return "PENDING";
}
function detailState(detail: CaseDetail, dirty: boolean) {
  if (detail.case.status === "APPROVED_FILE") return "APPROVED";
  if (!detail.case.review_started_at) return "START REVIEW";
  if (dirty) return "CHANGES NEED VERIFICATION";
  if (detail.case.verification_result?.approval_ready) return "READY FOR APPROVAL";
  if (detail.case.conflicts.length || detail.case.missing_fields.length) return "REVIEW REQUIRED";
  return "CHECK & VERIFY";
}

export function SmartCareerCollectClient() {
  const { activeStaff, me } = useStaff();
  const fileRef = useRef<HTMLInputElement>(null);
  const reattachRef = useRef<HTMLInputElement>(null);
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
  const [draftDirty, setDraftDirty] = useState(false);
  const [reviewerId, setReviewerId] = useState("");
  const [documentConfirmed, setDocumentConfirmed] = useState(false);
  const [informationConfirmed, setInformationConfirmed] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const queueRequest = useRef(0);
  const caseRequest = useRef(0);
  const { sweep, trigger: handshake } = useDigitalHandshake();

  const mobilePath = "/staff/smart-client-import/new";
  const loadQueue = useCallback(async (cursor?: string | null, append = false) => {
    const request = (queueRequest.current += 1);
    setQueueBusy(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "ALL") params.set("status", filter);
      if (search.trim()) params.set("q", search.trim());
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/staff/smart-client-import?${params}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, `Queue failed (${res.status})`));
      if (request !== queueRequest.current) return;
      setRows((current) => append ? [...current, ...data.rows] : data.rows);
      setCounters(data.counters);
      setNextCursor(data.next_cursor ?? null);
    } catch (e) { if (request === queueRequest.current) setError(e instanceof Error ? e.message : "Queue failed"); }
    finally { if (request === queueRequest.current) setQueueBusy(false); }
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
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [loadQueue]);

  async function openCase(id: string) {
    const request = (caseRequest.current += 1);
    setError(null); setActionBusy("open");
    try {
      const res = await fetch(`/api/staff/smart-client-import?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, "Unable to open import"));
      if (request !== caseRequest.current) return;
      const next = { case: data.case, documents: data.documents } as CaseDetail;
      setDetail(next); setDraft(structuredClone(next.case.mapped_draft)); setDraftDirty(false);
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
      setPreview(next); setSelectedRows(new Set(next.rows.filter((row) => row.result === "VALID").map((row) => row.row)));
    } catch (e) { setError(e instanceof Error ? e.message : "Preview failed"); }
    finally { setPreviewBusy(false); }
  }

  async function stagePreview() {
    if (!preview || stageBusy || selectedRows.size === 0) return;
    setStageBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/staff/universal-intake", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "stage", rows: preview.rows.map((row) => row.raw), source: preview.source, selected_rows: [...selectedRows], idempotency_key: crypto.randomUUID(), metadata: preview.metadata }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, `Staging failed (${res.status})`));
      setNotice(`${data.staged} import case${data.staged === 1 ? "" : "s"} staged.`);
      setPreview(null); setFile(null); setSheetUrl(""); if (fileRef.current) fileRef.current.value = "";
      await loadQueue();
    } catch (e) { setError(e instanceof Error ? e.message : "Staging failed"); }
    finally { setStageBusy(false); }
  }

  async function postAction(action: string, extra: Record<string, unknown> = {}) {
    if (!detail) return null;
    const res = await fetch("/api/staff/smart-client-import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id: detail.case.id, ...extra }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(errMessage(data, `${action} failed (${res.status})`));
    return data;
  }

  async function mutate(action: string, extra: Record<string, unknown> = {}) {
    if (!detail || actionBusy) return null;
    setActionBusy(action); setError(null); setNotice(null);
    try {
      const data = await postAction(action, extra);
      if (action === "approve" && data?.client_id) {
        handshake("emerald");
        window.location.assign(`/staff/client/${data.client_id}`);
        return data;
      }
      if (action === "save") { setDraftDirty(false); handshake("gold"); }
      await Promise.all([openCase(detail.case.id), loadQueue()]);
      setNotice(action === "save" ? "Review saved." : action === "start_review" ? "Review started." : "Action completed.");
      return data;
    } catch (e) { setError(e instanceof Error ? e.message : `${action} failed`); return null; }
    finally { setActionBusy(null); }
  }

  async function saveAndVerify() {
    if (!detail || !draft || !reviewerId || actionBusy) return;
    setActionBusy("verify"); setError(null); setNotice(null);
    try {
      await postAction("save", { reviewer_id: reviewerId, draft, document_match_confirmed: documentConfirmed, information_match_confirmed: informationConfirmed });
      await postAction("verify");
      setDraftDirty(false);
      handshake("emerald");
      await Promise.all([openCase(detail.case.id), loadQueue()]);
      setNotice("Review saved and verification completed.");
    } catch (e) { setError(e instanceof Error ? e.message : "Verification failed"); }
    finally { setActionBusy(null); }
  }

  async function reExtract() {
    if (!detail || actionBusy) return;
    setActionBusy("re_extract"); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/staff/smart-client-import/${detail.case.id}/retry`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, `Re-extraction failed (${res.status})`));
      handshake("cyan");
      await Promise.all([openCase(detail.case.id), loadQueue()]);
      setNotice("Re-extraction completed. Reviewed values and their original evidence were preserved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Re-extraction failed"); }
    finally { setActionBusy(null); }
  }

  async function reattach(files: FileList | null) {
    if (!detail || !files?.length || actionBusy) return;
    setActionBusy("reattach"); setError(null); setNotice(null);
    try {
      const form = new FormData(); Array.from(files).forEach((entry) => form.append("files", entry));
      const res = await fetch(`/api/staff/smart-client-import/${detail.case.id}/reattach`, { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, `Re-attach failed (${res.status})`));
      if (data.retry_url) {
        const retry = await fetch(data.retry_url, { method: "POST" });
        const retryData = await retry.json().catch(() => null);
        if (!retry.ok || !retryData?.ok) throw new Error(errMessage(retryData, `Re-extraction failed (${retry.status})`));
      }
      await Promise.all([openCase(detail.case.id), loadQueue()]);
      setNotice("Source document re-attached and staged evidence refreshed. Reviewed values were preserved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Re-attach failed"); }
    finally { if (reattachRef.current) reattachRef.current.value = ""; setActionBusy(null); }
  }

  async function archiveRow(id: string) {
    if (actionBusy || !window.confirm("Archive this import from the active queue?")) return;
    setActionBusy(`archive:${id}`); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/staff/smart-client-import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive", id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, `Archive failed (${res.status})`));
      if (detail?.case.id === id) { setDetail(null); setDraft(null); setDraftDirty(false); }
      await loadQueue();
      setNotice("Import archived. Canonical client data was not deleted.");
    } catch (e) { setError(e instanceof Error ? e.message : "Archive failed"); }
    finally { setActionBusy(null); }
  }

  const profile = useMemo(() => draft?.profile ?? {}, [draft]);
  const reviewFields = useMemo(() => draft?.review_fields ?? {}, [draft]);
  const getField = useCallback(
    (field: SmartField) => (field.scope === "profile" ? profile[field.key] : reviewFields[field.key]),
    [profile, reviewFields],
  );

  /**
   * A committed matrix edit updates only that field in the staged draft. The value is
   * already validated and canonical; persistence, MANUAL authority and the preserved
   * source evidence all come from the existing review-save flow.
   */
  function commitField({ field, value }: MatrixCommit) {
    setDraftDirty(true);
    setDraft((current) => {
      if (!current) return current;
      if (field.scope === "profile") return { ...current, profile: { ...(current.profile ?? {}), [field.key]: value } };
      return { ...current, review_fields: { ...(current.review_fields ?? {}), [field.key]: value } };
    });
  }
  const readiness = useMemo(() => smartRequiredReadiness(getField), [getField]);
  const canApprove = Boolean(detail && draft && reviewerId && detail.case.review_started_at && !draftDirty && documentConfirmed && informationConfirmed && detail.case.verification_result?.approval_ready);
  const approvalBlockers = useMemo(() => {
    if (!detail) return [];
    const blockers: string[] = [];
    if (!reviewerId) blockers.push("Select the reviewer completing this file.");
    for (const label of readiness.missing) blockers.push(`${label} is a required Client field and is still empty.`);
    if (detail.case.conflicts.length) blockers.push(`${detail.case.conflicts.length} blocking conflict${detail.case.conflicts.length === 1 ? "" : "s"} must be resolved.`);
    if (draftDirty) blockers.push("Manual edits are unsaved; run CHECK & VERIFY to re-validate them.");
    if (!documentConfirmed) blockers.push("Confirm the current document status.");
    if (!informationConfirmed) blockers.push("Confirm the information match.");
    const validationError = smartFieldText(detail.case.verification_result?.validation_error);
    if (validationError) blockers.push(validationError);
    else if (!draftDirty && !detail.case.verification_result?.approval_ready && readiness.complete === readiness.total && !detail.case.conflicts.length) {
      blockers.push("Verification has not run against the current values yet.");
    }
    return blockers;
  }, [detail, draftDirty, documentConfirmed, informationConfirmed, readiness, reviewerId]);
  const activeDocument = detail?.documents.find((doc) => doc.id === activeDocumentId) ?? detail?.documents[0] ?? null;
  const workflowState = detail ? detailState(detail, draftDirty) : null;

  async function copyMobileLink() {
    const url = `${window.location.origin}${mobilePath}`;
    try { await navigator.clipboard.writeText(url); setNotice("Mobile import link copied."); }
    catch { setError("Unable to copy the mobile link."); }
  }
  function jumpToEvidence(evidence?: Evidence) {
    if (!evidence?.source_document_id) return;
    setActiveDocumentId(evidence.source_document_id);
    document.getElementById("smart-document-viewer")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return <div className="ops-page space-y-5">
    <header className="ops-hero border border-amber-200/10 bg-gradient-to-br from-[#071525]/95 via-[#0a1c31]/95 to-[#07111f]/95">
      <div><p className="ops-kicker">CAREER GATE · INTELLIGENT OPERATIONS</p><h1>SMART CAREER COLLECT CLIENT</h1><p>Intelligent Intake · Extraction · Verification · Approval</p></div>
      <div className="text-right text-[10px] tracking-[.16em] text-slate-500">{me.role.toUpperCase()} · LIVE SYNC</div>
    </header>

    <section className="grid gap-3 lg:grid-cols-2" aria-label="Smart Career Collect Client workspaces">
      <button type="button" onClick={() => setWorkspace("sheet")} className={`rounded-3xl border p-5 text-left transition motion-reduce:transition-none ${workspace === "sheet" ? "border-amber-300/35 bg-amber-300/[.08]" : "border-white/10 bg-white/[.035] hover:bg-white/[.055]"}`}><span className="text-[10px] font-bold tracking-[.18em] text-amber-300">01</span><strong className="mt-2 block text-lg text-slate-100">NEW IMPORT BY SHEET</strong><span className="mt-1 block text-xs text-slate-500">Structured Import · XLSX / CSV / Google Sheets</span></button>
      <button type="button" onClick={() => setWorkspace("mobile")} className={`rounded-3xl border p-5 text-left transition motion-reduce:transition-none ${workspace === "mobile" ? "border-amber-300/35 bg-amber-300/[.08]" : "border-white/10 bg-white/[.035] hover:bg-white/[.055]"}`}><span className="text-[10px] font-bold tracking-[.18em] text-amber-300">02</span><strong className="mt-2 block text-lg text-slate-100">SMART CLIENT IMPORT BY LINK</strong><span className="mt-1 block text-xs text-slate-500">Document Intake · Mobile / QR / Photo / PDF / Text</span></button>
    </section>

    {notice && <div role="status" className="rounded-xl border border-emerald-300/20 bg-emerald-300/[.06] p-3 text-sm text-emerald-200">{notice}</div>}
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-300/20 bg-red-300/[.06] p-3 text-sm text-red-200"><span>{error}</span><button type="button" className="ops-secondary-button" onClick={() => { setError(null); void loadQueue(); }}>RETRY QUEUE</button></div>}

    {workspace === "sheet" ? <section className="ops-glass-card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[.18em] text-cyan-300">STRUCTURED IMPORT</p><h2 className="text-lg font-semibold text-slate-100">NEW IMPORT BY SHEET</h2><p className="text-xs text-slate-500">Ingest → Preview → Normalize → Validate → Stage → Review → Approve</p></div><div className="flex flex-wrap gap-2"><a className="ops-secondary-button" href="/api/staff/smart-client-import/template">DOWNLOAD TEMPLATE</a><button className={`ops-secondary-button ${legacy ? "ring-1 ring-amber-300/40" : ""}`} type="button" onClick={() => setLegacy((value) => !value)}>CONVERT LEGACY SHEET</button></div></div>
      <input ref={fileRef} className="hidden" type="file" accept={ACCEPT} onChange={(e) => { setFile(e.target.files?.[0] ?? null); if (e.target.files?.[0]) setSheetUrl(""); setPreview(null); }} />
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]"><button type="button" className="min-h-24 rounded-2xl border border-dashed border-white/15 bg-white/[.025] px-4 text-left hover:border-cyan-300/30" onClick={() => fileRef.current?.click()}><strong className="block text-sm text-slate-200">{file ? file.name : "Choose XLSX / CSV"}</strong><span className="mt-1 block text-xs text-slate-500">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Maximum 10 MB · 1,000 rows"}</span></button><button className="ops-primary-button min-w-36" type="button" disabled={previewBusy || (!file && !sheetUrl.trim())} onClick={previewSheet}>{previewBusy ? "VALIDATING…" : "PREVIEW"}</button></div>
      <label className="block text-xs text-slate-400" htmlFor="google-sheet">GOOGLE SHEETS URL<input id="google-sheet" className="ops-input mt-1 w-full" value={sheetUrl} placeholder="https://docs.google.com/spreadsheets/d/..." onChange={(e) => { setSheetUrl(e.target.value); if (e.target.value.trim()) setFile(null); setPreview(null); }} /></label>
      {preview && <div className="space-y-3"><div className="grid grid-cols-2 gap-2 md:grid-cols-4">{[["TOTAL",preview.total],["VALID",preview.valid],["DUPLICATE",preview.duplicate],["INVALID",preview.invalid]].map(([label,value]) => <div key={label} className="rounded-xl border border-white/10 bg-black/10 p-3"><span className="text-[10px] text-slate-500">{label}</span><strong className="mt-1 block text-xl text-slate-100">{value}</strong></div>)}</div><div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-black/15 text-slate-500"><tr><th className="p-3">STAGE</th><th className="p-3">ROW</th><th className="p-3">STATUS</th><th className="p-3">FULL NAME</th><th className="p-3">PHONE</th><th className="p-3">EMAIL</th><th className="p-3">SITE</th><th className="p-3">JOB</th><th className="p-3">SHIFT</th><th className="p-3">ISSUE</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.row} className="border-t border-white/[.06]"><td className="p-3"><input aria-label={`Stage row ${row.row}`} type="checkbox" disabled={row.result === "INVALID"} checked={selectedRows.has(row.row)} onChange={(e) => setSelectedRows((current) => { const next = new Set(current); if (e.target.checked) next.add(row.row); else next.delete(row.row); return next; })} /></td><td className="p-3 font-mono text-slate-500">{row.row}</td><td className="p-3">{row.result}</td><td className="p-3">{row.full_name ?? "—"}</td><td className="p-3">{row.phone ?? "—"}</td><td className="p-3">{row.email ?? "—"}</td><td className="p-3">{row.site ?? "—"}</td><td className="p-3">{row.job ?? "—"}</td><td className="p-3">{row.shift ?? "—"}</td><td className="p-3 text-slate-500">{row.message ?? row.identity}</td></tr>)}</tbody></table></div><button className="ops-primary-button" type="button" disabled={stageBusy || selectedRows.size === 0} onClick={stagePreview}>{stageBusy ? "STAGING…" : `STAGE SELECTED (${selectedRows.size})`}</button></div>}
    </section> : <section className="ops-glass-card space-y-4">
      <div><p className="text-[10px] font-bold tracking-[.18em] text-cyan-300">DOCUMENT INTAKE</p><h2 className="text-lg font-semibold text-slate-100">SMART CLIENT IMPORT BY LINK</h2><p className="text-xs text-slate-500">Photo / PDF / Text → deterministic extraction → provider enrichment → evidence → staged review.</p></div>
      <div className="flex flex-wrap gap-2"><Link className="ops-primary-button" href={mobilePath}>OPEN MOBILE FORM</Link><button className="ops-secondary-button" type="button" onClick={copyMobileLink}>COPY LINK</button><button className="ops-secondary-button" type="button" aria-expanded={showQr} onClick={() => setShowQr((value) => !value)}>QR</button></div>
      {showQr && <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-black/10 p-4"><img className="h-40 w-40 rounded-xl bg-white p-2" src="/api/staff/smart-client-import/qr" alt="Smart Client Import QR" /><div><strong className="text-slate-100">Secure mobile intake</strong><p className="mt-1 text-xs text-slate-500">Authenticated staff session required.</p></div></div>}
    </section>}

    <section className="ops-glass-card space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-100">IMPORT QUEUE</h2><p className="text-xs text-slate-500">Live staged files · canonical Client created only after approval.</p></div><div className="flex flex-wrap gap-2"><button className={`ops-secondary-button ${filter === "ALL" ? "ring-1 ring-cyan-300/30" : ""}`} type="button" onClick={() => setFilter("ALL")}>ALL</button><input className="ops-input min-w-56" aria-label="Search imports" placeholder="Name, phone, email, Import ID" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
      <div className="flex flex-wrap gap-2">{STATUSES.map((status) => <button key={status} type="button" onClick={() => setFilter(status)} className={`rounded-full border px-3 py-2 text-[10px] font-semibold ${filter === status ? "border-amber-300/35 bg-amber-300/[.08] text-amber-200" : "border-white/10 text-slate-500"}`}>{STATUS_LABEL[status]} · {counters[status]}</button>)}</div>
      <div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full min-w-[1040px] text-left text-xs"><thead className="bg-black/15 text-slate-500"><tr><th className="p-3">CLIENT</th><th className="p-3">SUBMITTED</th><th className="p-3">SOURCE</th><th className="p-3">STATUS</th><th className="p-3">ISSUES</th><th className="p-3">REVIEWER</th><th className="p-3">ACTION</th></tr></thead><tbody>{queueBusy && rows.length === 0 ? Array.from({length:3}).map((_,i) => <tr key={i} className="border-t border-white/[.06]"><td colSpan={7} className="p-3"><div className="h-8 animate-pulse rounded-lg bg-white/[.05] motion-reduce:animate-none" /></td></tr>) : rows.map((row) => <tr key={row.id} className="border-t border-white/[.06]"><td className="p-3"><strong className="block text-slate-200">{row.full_name || "Unidentified client"}</strong><span className="font-mono text-[10px] text-slate-600">{row.id}</span></td><td className="p-3 whitespace-nowrap text-slate-400">{new Date(row.created_at).toLocaleString("en-US", { timeZone: "America/Detroit" })}</td><td className="p-3 uppercase text-slate-400">{row.source_type}</td><td className="p-3 text-slate-300">{operationalState(row)}</td><td className="p-3">{row.issue_count}</td><td className="p-3">{row.reviewer_name ?? "—"}</td><td className="p-3"><div className="flex flex-wrap gap-2">{row.created_client_id ? <Link className="font-semibold text-amber-200" href={`/staff/client/${row.created_client_id}`}>OPEN CLIENT</Link> : <button className="ops-secondary-button" type="button" disabled={Boolean(actionBusy)} onClick={() => openCase(row.id)}>OPEN / EDIT</button>}<button className="ops-secondary-button" type="button" disabled={Boolean(actionBusy)} onClick={() => void archiveRow(row.id)}>{actionBusy === `archive:${row.id}` ? "ARCHIVING…" : "ARCHIVE"}</button></div></td></tr>)}</tbody></table></div>
      {!queueBusy && rows.length === 0 && <div className="rounded-xl border border-white/10 p-6 text-center"><p className="text-sm text-slate-400">No imports match this view.</p><button type="button" className="ops-secondary-button mt-3" onClick={() => { setFilter("ALL"); setSearch(""); }}>SHOW ALL IMPORTS</button></div>}
      {nextCursor && <button className="ops-secondary-button" type="button" disabled={queueBusy} onClick={() => loadQueue(nextCursor, true)}>LOAD MORE</button>}
    </section>

    {detail && draft && <section id="smart-review" className="ops-glass-card relative space-y-5">
      <DigitalHandshake sweep={sweep} />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12px] font-bold tracking-[.18em] text-amber-300">SMART CLIENT REVIEW</p>
          <h2 className="mt-1 text-[26px] font-semibold tracking-[-.02em] text-slate-50">{asText(profile.full_name) || "Unidentified client"}</h2>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-slate-400">
            <div className="flex gap-1.5"><dt>CASE</dt><dd className="font-mono font-medium text-slate-200">{detail.case.id}</dd></div>
            <div className="flex gap-1.5"><dt>SOURCE</dt><dd className="font-mono font-medium uppercase text-slate-200">{detail.case.source_type}{detail.case.source_row ? ` · ROW ${detail.case.source_row}` : ""}</dd></div>
            <div className="flex gap-1.5"><dt>IMPORTED</dt><dd className="font-mono font-medium text-slate-200">{new Date(detail.case.created_at).toLocaleString("en-US", { timeZone: "America/Detroit" })}</dd></div>
            <div className="flex gap-1.5"><dt>DOCUMENTS</dt><dd className="font-mono font-medium text-slate-200">{detail.documents.length}</dd></div>
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className={`inline-flex min-h-11 items-center rounded-xl border px-3 font-mono text-[13px] font-semibold ${detail.case.status === "APPROVED_FILE" ? "border-emerald-300/35 bg-emerald-300/[.10] text-emerald-200" : draftDirty ? "border-amber-300/35 bg-amber-300/[.10] text-amber-200" : "border-cyan-300/30 bg-cyan-300/[.08] text-cyan-200"}`}>{workflowState}</span>
          <button className="ops-secondary-button min-h-11" type="button" onClick={() => { setDetail(null); setDraft(null); setDraftDirty(false); }}>CLOSE</button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="REQUIRED FIELDS" value={`${readiness.complete} / ${readiness.total}`} tone={readiness.complete === readiness.total ? "emerald" : "amber"} />
        <Stat label="BLOCKING CONFLICTS" value={String(detail.case.conflicts.length)} tone={detail.case.conflicts.length ? "red" : "emerald"} />
        <Stat label="MISSING REPORTED" value={String(detail.case.missing_fields.length)} tone={detail.case.missing_fields.length ? "amber" : "emerald"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,.78fr)_minmax(0,1.22fr)]">
        <div id="smart-document-viewer" className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[14px] font-semibold tracking-[.1em] text-slate-100">DOCUMENT VIEWER</h3>
            {detail.case.status !== "APPROVED_FILE" && <>
              <input ref={reattachRef} className="sr-only" type="file" accept={REATTACH_ACCEPT} multiple onChange={(e) => void reattach(e.target.files)} />
              <button className="ops-secondary-button min-h-11" type="button" disabled={Boolean(actionBusy)} onClick={() => reattachRef.current?.click()}>{actionBusy === "reattach" ? "PROCESSING…" : "RE-ATTACH"}</button>
            </>}
          </div>
          {activeDocument ? <>
            <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-[#02070d]">
              {activeDocument.mime_type.startsWith("image/")
                ? <img className="max-h-[560px] w-full object-contain" src={`/api/staff/smart-client-import/document/${activeDocument.id}`} alt={activeDocument.original_filename} />
                : <iframe title={activeDocument.original_filename} className="h-[560px] w-full" src={`/api/staff/smart-client-import/document/${activeDocument.id}`} />}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">{detail.documents.map((doc) => <button key={doc.id} className={`min-h-11 rounded-lg border px-2.5 text-[13px] ${activeDocument.id === doc.id ? "border-cyan-300/35 text-cyan-200" : "border-white/12 text-slate-300"}`} type="button" aria-pressed={activeDocument.id === doc.id} onClick={() => setActiveDocumentId(doc.id)}>{doc.original_filename}</button>)}</div>
          </> : <p className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[.04] p-4 text-[13px] leading-6 text-amber-100">No source document attached. Missing documents remain follow-up items and are not fabricated.</p>}
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-[14px] font-semibold tracking-[.1em] text-slate-100">CLIENT DATA · VALIDATION MATRIX</h3>
              <p className="mt-1 text-[12px] text-slate-400">Current value with its validation state, provenance and authority. A manual edit takes precedence over later automatic extraction.</p>
            </div>
            <span className="rounded-full border border-white/12 px-2.5 py-1 text-[12px] text-slate-300">{SMART_FIELDS.length} REVIEWED FIELDS</span>
          </div>
          <div className="mt-3">
            <ValidationMatrix
              read={getField}
              onCommit={commitField}
              evidence={detail.case.field_evidence}
              missingFields={detail.case.missing_fields}
              conflicts={detail.case.conflicts}
              readOnly={detail.case.status === "APPROVED_FILE"}
              onViewSource={jumpToEvidence}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/10 p-4 space-y-3">
        <label className="block text-[13px] font-semibold text-slate-200" htmlFor="smart-reviewer">REVIEWED BY</label>
        <select id="smart-reviewer" className="ops-input min-h-11 w-full text-[14px]" value={reviewerId} disabled={detail.case.status === "APPROVED_FILE"} onChange={(e) => setReviewerId(e.target.value)}>
          <option value="">Unassigned</option>
          {activeStaff.map((member) => <option key={member.id} value={member.id}>{member.display_name} · {member.staff_code ?? member.role}</option>)}
        </select>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-[13px] leading-6 text-slate-200"><input type="checkbox" className="mt-1 h-4 w-4" checked={documentConfirmed} disabled={detail.case.status === "APPROVED_FILE"} onChange={(e) => setDocumentConfirmed(e.target.checked)} /><span><strong className="block">CURRENT DOCUMENT STATUS REVIEWED</strong><span className="text-slate-400">Missing documents may remain outstanding after approval.</span></span></label>
        <label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-[13px] leading-6 text-slate-200"><input type="checkbox" className="mt-1 h-4 w-4" checked={informationConfirmed} disabled={detail.case.status === "APPROVED_FILE"} onChange={(e) => setInformationConfirmed(e.target.checked)} /><span><strong className="block">INFORMATION MATCH CONFIRMED</strong><span className="text-slate-400">Approved values match reviewed source evidence.</span></span></label>
      </div>

      {approvalBlockers.length > 0 && detail.case.review_started_at && detail.case.status !== "APPROVED_FILE" && (
        <ul aria-live="polite" className="rounded-2xl border border-amber-300/25 bg-amber-300/[.05] p-4 text-[13px] leading-6 text-amber-100">
          <li className="mb-1 font-semibold tracking-[.1em] text-amber-200">APPROVAL IS BLOCKED BY</li>
          {approvalBlockers.map((blocker) => <li key={blocker} className="ml-4 list-disc">{blocker}</li>)}
        </ul>
      )}

      <div className="sticky bottom-3 z-10 rounded-2xl border border-[#b8934a]/25 bg-[linear-gradient(145deg,rgba(12,35,68,.9),rgba(4,11,25,.9))] p-3.5 shadow-[0_22px_60px_-28px_rgba(0,0,0,.85)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-slate-400">
            <span className="font-mono text-[12px]">{readiness.complete} / {readiness.total} REQUIRED</span>
            <span aria-hidden="true" className="text-slate-600">|</span>
            <span className={draftDirty ? "text-amber-200" : "text-emerald-300"}>{draftDirty ? "Unsaved manual edits" : "No unsaved edits"}</span>
            {detail.case.status !== "APPROVED_FILE" && <><span aria-hidden="true" className="text-slate-600">|</span><span className="rounded-md border border-white/[.08] bg-black/25 px-2 py-1 font-mono text-[11px]">⌘/Ctrl + Enter</span><span>Approve when ready</span></>}
          </div>
          <div className="flex flex-wrap gap-2">
            {detail.case.status === "APPROVED_FILE" && detail.case.created_client_id
              ? <Link className="ops-primary-button inline-flex min-h-12 items-center justify-center px-5 text-[14px]" href={`/staff/client/${detail.case.created_client_id}`}>OPEN CLIENT</Link>
              : !detail.case.review_started_at
                ? <button className="ops-primary-button min-h-12 px-5 text-[14px]" type="button" disabled={!reviewerId || Boolean(actionBusy)} onClick={() => mutate("start_review", { reviewer_id: reviewerId })}>{actionBusy === "start_review" ? "STARTING…" : "START REVIEW"}</button>
                : <>
                    <button className="ops-secondary-button min-h-12 px-4 text-[13px]" type="button" disabled={!reviewerId || Boolean(actionBusy)} onClick={() => mutate("save", { reviewer_id: reviewerId, draft, document_match_confirmed: documentConfirmed, information_match_confirmed: informationConfirmed })}>{actionBusy === "save" ? "SAVING…" : "SAVE DRAFT"}</button>
                    <button className="ops-secondary-button min-h-12 px-4 text-[13px]" type="button" disabled={Boolean(actionBusy) || !detail.documents.length} onClick={() => void reExtract()}>{actionBusy === "re_extract" ? "RE-EXTRACTING…" : "RE-EXTRACT"}</button>
                    {canApprove
                      ? <button className="ops-primary-button min-h-12 px-5 text-[14px]" type="button" disabled={Boolean(actionBusy)} onClick={() => mutate("approve", { reviewer_id: reviewerId, draft, document_match_confirmed: documentConfirmed, information_match_confirmed: informationConfirmed })}>{actionBusy === "approve" ? "CREATING CANONICAL CLIENT…" : "APPROVE FILE"}</button>
                      : <button className="ops-primary-button min-h-12 px-5 text-[14px]" type="button" disabled={!reviewerId || Boolean(actionBusy)} onClick={() => void saveAndVerify()}>{actionBusy === "verify" ? "VERIFYING…" : "CHECK & VERIFY"}</button>}
                  </>}
          </div>
        </div>
      </div>
    </section>}
  </div>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "emerald" | "amber" | "red" }) {
  const map = {
    emerald: "border-emerald-300/25 text-emerald-200",
    amber: "border-amber-300/25 text-amber-200",
    red: "border-red-300/25 text-red-200",
  } as const;
  return (
    <div className={`rounded-xl border bg-black/15 px-3 py-2.5 ${map[tone]}`}>
      <span className="block text-[11px] font-semibold tracking-[.14em] text-slate-400">{label}</span>
      <strong className="mt-1 block font-mono text-[16px] font-semibold">{value}</strong>
    </div>
  );
}
