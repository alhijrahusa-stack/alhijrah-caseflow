"use client";

import Link from "next/link";
import { RoyalSelect, RoyalOption } from "@/components/forms/RoyalSelect";
import { GlassReviewDialog } from "@/components/staff/smart/GlassReviewDialog";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { publishMutation, subscribeResources } from "@/components/staff/realtime/update-bus";
import "@/components/staff/smart/royal-intake.css";
import { useVersionedReviewDraft } from "@/components/staff/useVersionedReviewDraft";
import { sameReviewDraft } from "@/lib/review-draft-snapshot";
import { reviewDraftKey, writeReviewDraft, type ReviewDraftPayload } from "@/lib/review-offline-drafts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStaff } from "@/components/staff/StaffContext";
import { DigitalHandshake, useDigitalHandshake } from "@/components/staff/smart/DigitalHandshake";
import {
  SMART_FIELDS,
  canonicalSmartFieldKey,
  smartApprovalGate,
  smartFieldText,
  smartRequiredReadiness,
  type SmartEvidence,
  type SmartField,
} from "@/components/staff/smart/field-contract";
import { ValidationMatrix, type MatrixCommit } from "@/components/staff/smart/ValidationMatrix";

type Status = "PENDING" | "UNDER_REVIEW" | "MISSING_DOCUMENT" | "APPROVED_FILE";
type Workspace = "sheet" | "mobile";
type ReviewMode = "edit" | "audit" | "source";
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
  archived_at?: string | null;
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
    updated_at: string;
    created_client_id: string | null;
  };
  documents: { id: string; original_filename: string; mime_type: string; size_bytes: number; detected_document_type: string | null; extraction_metadata: Record<string, unknown>; created_at: string }[];
};

const STATUSES: Status[] = ["PENDING", "UNDER_REVIEW", "MISSING_DOCUMENT"];
const STATUS_LABEL: Record<Status, string> = { PENDING: "PENDING", UNDER_REVIEW: "UNDER REVIEW", MISSING_DOCUMENT: "MISSING DOCUMENT", APPROVED_FILE: "APPROVED" };
const ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const REATTACH_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

function errMessage(data: any, fallback: string) { return data?.error?.message ?? fallback; }
function asText(value: unknown) { return Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : value == null ? "" : String(value); }
function detailState(detail: CaseDetail, dirty: boolean) {
  if (detail.case.status === "APPROVED_FILE") return "APPROVED";
  if (!detail.case.review_started_at) return "START REVIEW";
  if (dirty) return "CHANGES NEED VERIFICATION";
  if (detail.case.verification_result?.approval_ready) return "READY FOR APPROVAL";
  if (detail.case.conflicts.some((item) => item.type !== "SOURCE_CONFLICT")) return "IDENTITY REVIEW";
  if (detail.case.conflicts.length || detail.case.missing_fields.length) return "APPROVE · COMPLETE LATER";
  return "CHECK & VERIFY";
}

export function SmartCareerCollectClient() {
  const { activeStaff, me } = useStaff();
  const { t } = useStaffLanguage();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [documentZoom, setDocumentZoom] = useState(100);
  const [approvedClient, setApprovedClient] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{title:string;message:string;resolve:(accepted:boolean)=>void}|null>(null);
  const confirmReview = (title: string, message: string) => new Promise<boolean>((resolve) => setConfirmation({ title, message, resolve }));
  const finishConfirmation = (accepted: boolean) => { confirmation?.resolve(accepted); setConfirmation(null); };
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
  const [queueBusy, setQueueBusy] = useState(true);
  const [filter, setFilter] = useState<Status | "ALL">("ALL");
  const [archiveView, setArchiveView] = useState(false);
  const [search, setSearch] = useState("");
  // Requested controls may change before their rows arrive. Only a committed
  // server snapshot supplies the visible range, active page and query metadata.
  const queueKey = JSON.stringify([archiveView,filter,search.trim(),page]);
  const [queueSnapshot,setQueueSnapshot] = useState({page:1,key:JSON.stringify([false,"ALL","",1]),query:""});
  const [failedQueueKey,setFailedQueueKey] = useState<string|null>(null);
  const queuePending = queueBusy || (queueKey !== queueSnapshot.key && queueKey !== failedQueueKey);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [counters, setCounters] = useState<Record<Status, number>>({ PENDING: 0, UNDER_REVIEW: 0, MISSING_DOCUMENT: 0, APPROVED_FILE: 0 });
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [pendingFields, setPendingFields] = useState<string[]>([]);
  const [editingField, setEditingField] = useState(false);
  const [reviewChanged, setReviewChanged] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [reviewMode, setReviewMode] = useState<ReviewMode>("edit");
  const [sourcePage, setSourcePage] = useState<number | null>(null);
  const [sourceField, setSourceField] = useState<string | null>(null);
  const actionLock = useRef(false);
  const approvedNavigation = useRef(false);
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
  // Synchronous counters close the gap between a user event and React committing
  // its next render. A network response must never clear a newer local edit.
  const localReviewRevision = useRef(0);
  const syncingReviewRevision = useRef<number | null>(null);
  const openFieldEditor = useRef(false);
  const retainConflictDraft = useCallback((payload: ReviewDraftPayload) => {
    try {
      const stored = writeReviewDraft(sessionStorage, me.id, payload, false);
      sessionStorage.setItem(reviewDraftKey(me.id,payload.id), JSON.stringify({...stored,queued:false,conflict:true}));
    } catch { /* The screen retains the edits even when browser storage is full. */ }
  }, [me.id]);
  function fieldEditingChanged(editing: boolean) { openFieldEditor.current = editing; setEditingField(editing); }

  const draftPayload = useMemo(() => detail && draft ? ({ action: "save" as const, id: detail.case.id, reviewer_id: reviewerId, draft, document_match_confirmed: documentConfirmed, information_match_confirmed: informationConfirmed, resolved_fields: pendingFields, expected_updated_at: detail.case.updated_at, expected_actor_id:me.id }) : null, [detail,draft,reviewerId,documentConfirmed,informationConfirmed,pendingFields,me.id]);
  const offlineDraft = useVersionedReviewDraft({
    staffId: me.id, caseId: detail?.case.id ?? null, serverVersion: detail?.case.updated_at ?? null,
    onRestore: (payload) => { localReviewRevision.current += 1; setDraft(payload.draft); setReviewerId(payload.reviewer_id); setDocumentConfirmed(payload.document_match_confirmed); setInformationConfirmed(payload.information_match_confirmed); setPendingFields(payload.resolved_fields ?? []); setDraftDirty(true); },
    onSyncStart: () => { syncingReviewRevision.current = localReviewRevision.current; },
    onSynced: (_data, appliedPayload) => {
      if (!draftPayload || !sameReviewDraft(draftPayload,appliedPayload) || syncingReviewRevision.current !== localReviewRevision.current || openFieldEditor.current) {
        if (draftPayload) retainConflictDraft(draftPayload);
        setDraftDirty(true); setReviewChanged(true);
        return false;
      }
      setDraftDirty(false); setPendingFields([]); if (detail) void openCase(detail.case.id, true);
      return true;
    },
    onConflict: () => setReviewChanged(true),
  });
  const offlineSyncing = offlineDraft.state === "syncing";
  const persistOfflineDraft = offlineDraft.persist;
  useEffect(() => {
    if (!draftDirty || !draftPayload || actionBusy || offlineSyncing || detail?.case.status === "APPROVED_FILE") return;
    const timer = window.setTimeout(() => {
      if (reviewChanged) retainConflictDraft(draftPayload);
      else persistOfflineDraft(draftPayload);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draftDirty,draftPayload,offlineSyncing,persistOfflineDraft,detail?.case.status,actionBusy,reviewChanged,retainConflictDraft]);

  const mobilePath = "/staff/smart-client-import/new";
  const loadQueue = useCallback(async (requestedPage = page) => {
    const request = (queueRequest.current += 1);
    const requestKey = JSON.stringify([archiveView,filter,search.trim(),requestedPage]);
    setFailedQueueKey(null); setQueueBusy(true);
    try {
      const params = new URLSearchParams();
      if (archiveView) params.set("archive", "1");
      else if (filter !== "ALL") params.set("status", filter);
      if (search.trim()) params.set("q", search.trim());
      params.set("page", String(requestedPage));
      const res = await fetch(`/api/staff/smart-client-import?${params}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, `Queue failed (${res.status})`));
      if (request !== queueRequest.current) return;
      const matchedTotal = data.total ?? data.archived_count ?? data.rows.length;
      const lastPage = Math.max(1, Math.ceil(matchedTotal / 10));
      if (requestedPage > lastPage) { setPage(lastPage); return; }
      setRows(data.rows); setTotal(matchedTotal);
      setQueueSnapshot({page:requestedPage,key:requestKey,query:search.trim()});
      if (data.counters) setCounters(data.counters);
    } catch (e) { if (request === queueRequest.current) { setFailedQueueKey(requestKey); setError(e instanceof Error ? e.message : "Queue failed"); } }
    finally { if (request === queueRequest.current) setQueueBusy(false); }
  }, [archiveView, filter, search, page]);

  useEffect(() => {
    const debounce = window.setTimeout(() => void loadQueue(), 140);
    return () => window.clearTimeout(debounce);
  }, [loadQueue]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void loadQueue(); };
    const unsubscribe = subscribeResources({ clientId: null, resources: ["import_cases"], onUpdate: refresh });
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { unsubscribe(); window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [loadQueue]);

  useEffect(() => {
    if (!draftDirty && !editingField) return;
    const warn = (event: BeforeUnloadEvent) => { if (approvedNavigation.current) return; event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draftDirty, editingField]);

  async function openCase(id: string, refresh = false, mode: ReviewMode = "edit", approveIntent = false) {
    if (!refresh && (draftDirty || editingField) && !await confirmReview(t("Unsaved review", "مراجعة غير محفوظة"), t("Discard unsaved review changes and open this file?", "هل تريد ترك التغييرات غير المحفوظة وفتح هذا الملف؟"))) return;
    const request = (caseRequest.current += 1);
    setError(null); setApprovedClient(null); setActionBusy("open");
    try {
      const res = await fetch(`/api/staff/smart-client-import?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, "Unable to open import"));
      if (request !== caseRequest.current) return;
      const next = { case: data.case, documents: data.documents } as CaseDetail;
      if (next.case.status === "PENDING" && !next.case.reviewer_id) {
        const claimResponse = await fetch("/api/staff/smart-client-import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start_review", id, reviewer_id: me.id }),
        });
        const claimed = await claimResponse.json().catch(() => null);
        if (!claimResponse.ok || !claimed?.ok) throw new Error(errMessage(claimed, "Reviewer assignment failed"));
        if (request !== caseRequest.current) return;
        const refreshed = await fetch(`/api/staff/smart-client-import?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        const freshData = await refreshed.json().catch(() => null);
        if (!refreshed.ok || !freshData?.ok) throw new Error(errMessage(freshData, "Review started, but the latest file could not be loaded. Open the file again."));
        if (request !== caseRequest.current) return;
        next.case = freshData.case;
        next.documents = freshData.documents;
        void loadQueue();
      }
      approvedNavigation.current = false;
      if (!refresh) { setReviewMode(mode); setSourceOpen(mode === "source"); setSourceField(null); }
      setDetail(next); setDraft(structuredClone(next.case.mapped_draft)); setDraftDirty(false); setPendingFields([]); openFieldEditor.current = false; setEditingField(false); setReviewChanged(false);
      setReviewerId(next.case.reviewer_id ?? "");
      setDocumentConfirmed(Boolean(next.case.document_match_confirmed));
      setInformationConfirmed(Boolean(next.case.information_match_confirmed));
      setActiveDocumentId((current) => refresh && next.documents.some((doc) => doc.id === current) ? current : next.documents[0]?.id ?? null);
      if (!refresh) window.setTimeout(() => document.getElementById("smart-review")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      if (approveIntent) {
        const assessment = smartApprovalGate({read: (field) => next.case.mapped_draft[field.scope]?.[field.key], conflicts: next.case.conflicts.filter((entry) => entry.type === "SOURCE_CONFLICT").length, identityConflicts: next.case.conflicts.filter((entry) => entry.type !== "SOURCE_CONFLICT").length, reviewerAssigned:Boolean(next.case.reviewer_id),confirmationsRecorded:next.case.document_match_confirmed && next.case.information_match_confirmed});
        if (assessment.blocked) setError(assessment.blockers.join(" "));
        else if (!next.documents.length || assessment.warnings.some((warning) => warning.state === "MISSING")) {setOverrideReason("");setOverrideOpen(true);}
        else window.setTimeout(() => document.getElementById("smart-approval-bar")?.scrollIntoView({behavior:"smooth",block:"center"}),0);
      }
    } catch (e) { if (request === caseRequest.current) setError(e instanceof Error ? e.message : "Unable to open import"); }
    finally { if (request === caseRequest.current) setActionBusy(null); }
  }

  async function closeReview() {
    if ((draftDirty || editingField) && !await confirmReview(t("Unsaved review", "مراجعة غير محفوظة"), t("Discard unsaved review changes and close this file?", "هل تريد ترك التغييرات غير المحفوظة وإغلاق الملف؟"))) return;
    caseRequest.current += 1;
    setDetail(null); setDraft(null); setDraftDirty(false); setPendingFields([]); openFieldEditor.current = false; setEditingField(false); setReviewChanged(false);
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
      body: JSON.stringify({ action, id: detail.case.id,
        ...(["save", "approve", "verify"].includes(action) ? { expected_updated_at: detail.case.updated_at } : {}),
        ...(["save", "approve"].includes(action) ? { resolved_fields: pendingFields } : {}),
        ...extra }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      if (data?.error?.code === "review_changed") setReviewChanged(true);
      throw new Error(errMessage(data, `${action} failed (${res.status})`));
    }
    return data;
  }

  async function mutate(action: string, extra: Record<string, unknown> = {}) {
    if (!detail || actionBusy || editingField || reviewChanged || offlineSyncing || actionLock.current) return null;
    if (!offlineDraft.online) {
      if (action === "save" && draftPayload) { if (offlineDraft.queue(draftPayload)) setNotice(t("Draft queued for safe synchronization after reconnecting.","تم حفظ المسودة للمزامنة الآمنة بعد عودة الاتصال.")); }
      else setError(t("Reconnect before verifying or approving a file.","أعد الاتصال قبل التحقق أو اعتماد الملف."));
      return null;
    }
    actionLock.current = true;
    setActionBusy(action); setError(null); setNotice(null);
    try {
      const data = await postAction(action, extra);
      if (action === "approve" && data?.client_id) {
        approvedNavigation.current = true;
        offlineDraft.clear();
        setDraftDirty(false); setPendingFields([]);
        handshake("emerald");
        setApprovedClient(data.client_id);
        setRows((current) => current.filter((row) => row.id !== detail.case.id));
        setDetail(null); setDraft(null); setOverrideOpen(false); setOverrideReason("");
        publishMutation("create_client", data.client_id);
        await loadQueue();
        setNotice(draft?.status && draft.status !== "new_intake" ? t("Client approved and routed to its saved workflow stage. Outstanding items were recorded for follow-up.","تم اعتماد العميل وتحويله إلى مرحلته المسجلة، مع تسجيل النواقص للمتابعة.") : t("Client approved and routed to Intake. Outstanding items were recorded for follow-up.", "تم اعتماد العميل وتحويله إلى الاستقبال، مع تسجيل النواقص للمتابعة."));
        return data;
      }
      if (data?.updated_at) setDetail((current) => current ? { ...current, case: { ...current.case, updated_at: data.updated_at } } : current);
      if (action === "save") { offlineDraft.clear(); setDraftDirty(false); setPendingFields([]); handshake("gold"); }
      await Promise.all([openCase(detail.case.id, true), loadQueue()]);
      setNotice(action === "save" ? t("Review saved.","تم حفظ المراجعة.") : action === "start_review" ? t("Review started.","بدأت المراجعة.") : t("Action completed.","تم الإجراء."));
      return data;
    } catch (e) { setError(e instanceof Error ? e.message : `${action} failed`); return null; }
    finally { actionLock.current = false; setActionBusy(null); }
  }

  async function saveAndVerify() {
    if (!detail || !draft || !reviewerId || actionBusy || editingField || reviewChanged || offlineSyncing || !offlineDraft.online || actionLock.current) return;
    actionLock.current = true;
    setActionBusy("verify"); setError(null); setNotice(null);
    try {
      const saved = await postAction("save", { reviewer_id: reviewerId, draft, document_match_confirmed: documentConfirmed, information_match_confirmed: informationConfirmed });
      setDetail((current) => current ? { ...current, case: { ...current.case, updated_at: saved.updated_at, verification_result: {} } } : current);
      offlineDraft.clear(); setDraftDirty(false); setPendingFields([]);
      const verified = await postAction("verify", { expected_updated_at: saved.updated_at });
      if (verified?.updated_at) setDetail((current) => current ? { ...current, case: { ...current.case, updated_at: verified.updated_at } } : current);
      handshake("emerald");
      await Promise.all([openCase(detail.case.id, true), loadQueue()]);
      setNotice(t("Review saved and verification completed.","تم حفظ المراجعة واكتمال التحقق."));
    } catch (e) { setError(e instanceof Error ? e.message : "Verification failed"); }
    finally { actionLock.current = false; setActionBusy(null); }
  }

  async function reExtract() {
    if (!detail || actionBusy || draftDirty || editingField || reviewChanged || offlineSyncing || !offlineDraft.online) return;
    setActionBusy("re_extract"); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/staff/smart-client-import/${detail.case.id}/retry`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(errMessage(data, `Re-extraction failed (${res.status})`));
      handshake("cyan");
      await Promise.all([openCase(detail.case.id, true), loadQueue()]);
      setNotice("Re-extraction completed. Reviewed values and their original evidence were preserved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Re-extraction failed"); }
    finally { setActionBusy(null); }
  }

  async function reattach(files: FileList | null) {
    if (!detail || !files?.length || actionBusy || draftDirty || editingField || reviewChanged || offlineSyncing || !offlineDraft.online) return;
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
      await Promise.all([openCase(detail.case.id, true), loadQueue()]);
      setNotice("Source document re-attached and staged evidence refreshed. Reviewed values were preserved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Re-attach failed"); }
    finally { if (reattachRef.current) reattachRef.current.value = ""; setActionBusy(null); }
  }

  async function archiveRow(id: string) {
    if (actionBusy || !await confirmReview(t("Archive import", "أرشفة الاستيراد"), t("Archive this import from the active queue? Canonical client data will be preserved.", "هل تريد أرشفة هذا الاستيراد؟ سيبقى ملف العميل محفوظاً."))) return;
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
    localReviewRevision.current += 1;
    setDraftDirty(true);
    setPendingFields((current) => current.includes(field.key) ? current : [...current, field.key]);
    setInformationConfirmed(false);
    setDraft((current) => {
      if (!current) return current;
      if (field.scope === "profile") return { ...current, profile: { ...(current.profile ?? {}), [field.key]: value } };
      return { ...current, review_fields: { ...(current.review_fields ?? {}), [field.key]: value } };
    });
  }
  const unresolvedConflicts = useMemo(() => {
    return (detail?.case.conflicts ?? []).filter((item) => {
      if (item.type === "IDENTITY") return true;
      const key = String(item.field_key ?? item.field ?? "");
      return !pendingFields.includes(canonicalSmartFieldKey(key));
    });
  }, [detail, pendingFields]);
  const blockingConflicts = unresolvedConflicts.filter((item) => item.type !== "SOURCE_CONFLICT");
  const sourceConflicts = unresolvedConflicts.filter((item) => item.type === "SOURCE_CONFLICT");
  const readiness = useMemo(() => smartRequiredReadiness(getField), [getField]);
  const assessment = useMemo(() => {
    if (!detail || !draft) return null;
    const verification = detail.case.verification_result ?? {};
    return smartApprovalGate({
      read: getField,
      conflicts: sourceConflicts.length,
      identityConflicts: blockingConflicts.length,
      reviewerAssigned: Boolean(reviewerId),
      confirmationsRecorded: documentConfirmed && informationConfirmed,
      serverBlockers: draftDirty || !Array.isArray(verification.blockers) ? [] : verification.blockers.filter((blocker: { code?: string; message?: string }) => !(blocker.code === "SYSTEM_CONFLICT" && blockingConflicts.length === 0) && !String(blocker.message ?? "").includes("document-status and information-match confirmations")),
      serverWarnings: draftDirty || !Array.isArray(verification.warnings) ? [] : verification.warnings,
    });
  }, [detail, draft, draftDirty, documentConfirmed, getField, informationConfirmed, reviewerId, sourceConflicts.length, blockingConflicts.length]);
  // Smart Review is an administrative stage: optional gaps warn, only a real system
  // blocker withholds approval. The server re-checks at the approval mutation.
  const canApprove = Boolean(detail && draft && assessment && !assessment.blocked && !reviewChanged && !editingField && detail.case.status !== "APPROVED_FILE");
  const approvalBlockers = useMemo(() => assessment?.blockers ?? [], [assessment]);
  const approvalWarnings = useMemo(() => assessment?.warnings ?? [], [assessment]);
  const activeDocument = detail?.documents.find((doc) => doc.id === activeDocumentId) ?? detail?.documents[0] ?? null;
  const workflowState = detail ? detailState(detail, draftDirty) : null;

  async function copyMobileLink() {
    const url = `${window.location.origin}${mobilePath}`;
    try { await navigator.clipboard.writeText(url); setNotice("Mobile import link copied."); }
    catch { setError("Unable to copy the mobile link."); }
  }
  function jumpToEvidence(evidence?: Evidence) {
    setSourceField(SMART_FIELDS.find((field) => field.key === canonicalSmartFieldKey(evidence?.field_key))?.label ?? null);
    if (!evidence?.source_document_id) {
      setSourceOpen(true); setSourcePage(null);

      return;
    }
    if (!detail?.documents.some((doc) => doc.id === evidence.source_document_id)) { setError("The document referenced by this evidence is no longer attached to this file."); return; }
    setSourcePage(evidence.source_page ?? null);
    setSourceOpen(true);
    setActiveDocumentId(evidence.source_document_id);

  }

  const missingApprovalItems = approvalWarnings.filter((warning) => warning.state === "MISSING");
  const needsOverride = missingApprovalItems.length > 0 || Boolean(detail && detail.documents.length === 0);
  function requestApproval() {
    if (!canApprove || !detail || !draft || actionBusy || !offlineDraft.online || offlineSyncing) return;
    if (needsOverride) { setOverrideReason(""); setOverrideOpen(true); return; }
    void mutate("approve", { reviewer_id: reviewerId, draft, document_match_confirmed: documentConfirmed, information_match_confirmed: informationConfirmed });
  }
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const highlight = (text: string) => {
    const needle = search.trim().toLowerCase(), index = text.toLowerCase().indexOf(needle);
    return !needle || index < 0 ? text : <>{text.slice(0,index)}<mark>{text.slice(index,index+needle.length)}</mark>{text.slice(index+needle.length)}</>;
  };
  return <div className="ops-page cg-intake space-y-5">
    <header className="ops-hero border border-amber-200/10 bg-gradient-to-br from-[#071525]/95 via-[#0a1c31]/95 to-[#07111f]/95">
      <div><p className="ops-kicker">CAREER GATE · INTELLIGENT OPERATIONS</p><h1>SMART CAREER COLLECT CLIENT</h1><p>{t("Intelligent Intake · Extraction · Verification · Approval","استقبال ذكي · استخراج · تحقق · اعتماد")}</p></div>
      <div className="text-right text-[10px] tracking-[.16em] text-slate-500">{me.role.toUpperCase()} · LIVE SYNC</div>
    </header>

    <section className="cg-intake-tabs grid gap-3 lg:grid-cols-2" aria-label="Smart Career Collect Client workspaces">
      <button type="button" onClick={() => setWorkspace("sheet")} aria-pressed={workspace === "sheet"} className={`rounded-3xl border p-5 text-left transition motion-reduce:transition-none ${workspace === "sheet" ? "border-amber-300/35 bg-amber-300/[.08]" : "border-white/10 bg-white/[.035] hover:bg-white/[.055]"}`}><span className="text-[10px] font-bold tracking-[.18em] text-amber-300">01</span><strong className="mt-2 block text-lg text-slate-100">{t("NEW IMPORT BY SHEET","استيراد جديد من جدول")}</strong><span className="mt-1 block text-xs text-slate-500">{t("Structured Import · XLSX / CSV / Google Sheets","استيراد منظم · XLSX / CSV / Google Sheets")}</span></button>
      <button type="button" onClick={() => setWorkspace("mobile")} aria-pressed={workspace === "mobile"} className={`rounded-3xl border p-5 text-left transition motion-reduce:transition-none ${workspace === "mobile" ? "border-amber-300/35 bg-amber-300/[.08]" : "border-white/10 bg-white/[.035] hover:bg-white/[.055]"}`}><span className="text-[10px] font-bold tracking-[.18em] text-amber-300">02</span><strong className="mt-2 block text-lg text-slate-100">{t("SMART CLIENT IMPORT BY LINK","استيراد ذكي عبر رابط")}</strong><span className="mt-1 block text-xs text-slate-500">{t("Document Intake · Mobile / QR / Photo / PDF / Text","استقبال الوثائق · جوال / QR / صورة / PDF / نص")}</span></button>
    </section>

    {error && !detail && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-300/20 bg-red-300/[.06] p-3 text-sm text-red-200"><span>{error}</span><button type="button" className="ops-secondary-button" onClick={() => { setError(null); void loadQueue(); }}>RETRY QUEUE</button></div>}

    {workspace === "sheet" ? <section className="ops-glass-card cg-intake-sheet space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold tracking-[.18em] text-cyan-300">{t("STRUCTURED IMPORT","الاستيراد المنظم")}</p><h2 className="text-lg font-semibold text-slate-100">{t("NEW IMPORT BY SHEET","استيراد جديد من جدول")}</h2><div className="cg-sheet-stepper">{[t("Ingest","استيراد"),t("Preview","معاينة"),t("Normalize","تنسيق"),t("Validate","تحقق"),t("Stage","إعداد"),t("Review","مراجعة"),t("Approve","اعتماد")].map((step)=><span key={step}>{step}</span>)}</div></div><div className="flex flex-wrap gap-2"><a className="ops-secondary-button" href="/api/staff/smart-client-import/template">{t("DOWNLOAD TEMPLATE","تنزيل القالب")}</a><button className={`ops-secondary-button ${legacy ? "ring-1 ring-amber-300/40" : ""}`} type="button" onClick={() => setLegacy((value) => !value)}>{t("CONVERT LEGACY SHEET","تحويل جدول قديم")}</button></div></div>
      <input ref={fileRef} className="hidden" type="file" accept={ACCEPT} onChange={(e) => { setFile(e.target.files?.[0] ?? null); if (e.target.files?.[0]) setSheetUrl(""); setPreview(null); }} />
      <div className="cg-sheet-upload"><button type="button" className="cg-sheet-dropzone" onDragOver={(event) => { event.preventDefault(); event.currentTarget.dataset.dragging="true"; }} onDragLeave={(event) => {event.currentTarget.dataset.dragging="false";}} onDrop={(event) => { event.preventDefault(); event.currentTarget.dataset.dragging="false"; const dropped=event.dataTransfer.files[0]; if(dropped){setFile(dropped);setSheetUrl("");setPreview(null);} }} onClick={() => fileRef.current?.click()}><strong className="block text-sm text-slate-200">{file ? file.name : t("Choose XLSX / CSV","اختيار XLSX / CSV")}</strong><span className="mt-1 block text-xs text-slate-500">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : t("Maximum 10 MB · 1,000 rows","الحد الأقصى 10 ميغابايت · 1,000 صف")}</span></button><button className="ops-primary-button cg-sheet-preview min-w-36" type="button" disabled={previewBusy || (!file && !sheetUrl.trim())} onClick={previewSheet}>{previewBusy ? "VALIDATING…" : "PREVIEW"}</button></div>
      <label className="block text-xs text-slate-400" htmlFor="google-sheet">{t("GOOGLE SHEETS URL","رابط Google Sheets")}<input id="google-sheet" className="ops-input mt-1 w-full" value={sheetUrl} placeholder="https://docs.google.com/spreadsheets/d/..." onChange={(e) => { setSheetUrl(e.target.value); if (e.target.value.trim()) setFile(null); setPreview(null); }} /></label>
      {preview && <div className="space-y-3"><div className="grid grid-cols-2 gap-2 md:grid-cols-4">{[["TOTAL",preview.total],["VALID",preview.valid],["DUPLICATE",preview.duplicate],["INVALID",preview.invalid]].map(([label,value]) => <div key={label} className="rounded-xl border border-white/10 bg-black/10 p-3"><span className="text-[10px] text-slate-500">{label}</span><strong className="mt-1 block text-xl text-slate-100">{value}</strong></div>)}</div><div className="overflow-x-auto rounded-2xl border border-white/10"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-black/15 text-slate-500"><tr><th className="p-3">STAGE</th><th className="p-3">ROW</th><th className="p-3">STATUS</th><th className="p-3">FULL NAME</th><th className="p-3">PHONE</th><th className="p-3">EMAIL</th><th className="p-3">SITE</th><th className="p-3">JOB</th><th className="p-3">SHIFT</th><th className="p-3">ISSUE</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.row} className="border-t border-white/[.06]"><td className="p-3"><input aria-label={`Stage row ${row.row}`} type="checkbox" disabled={row.result === "INVALID"} checked={selectedRows.has(row.row)} onChange={(e) => setSelectedRows((current) => { const next = new Set(current); if (e.target.checked) next.add(row.row); else next.delete(row.row); return next; })} /></td><td className="p-3 font-mono text-slate-500">{row.row}</td><td className="p-3">{row.result}</td><td className="p-3">{row.full_name ?? "—"}</td><td className="p-3">{row.phone ?? "—"}</td><td className="p-3">{row.email ?? "—"}</td><td className="p-3">{row.site ?? "—"}</td><td className="p-3">{row.job ?? "—"}</td><td className="p-3">{row.shift ?? "—"}</td><td className="p-3 text-slate-500">{row.message ?? row.identity}</td></tr>)}</tbody></table></div><button className="ops-primary-button" type="button" disabled={stageBusy || selectedRows.size === 0} onClick={stagePreview}>{stageBusy ? "STAGING…" : `STAGE SELECTED (${selectedRows.size})`}</button></div>}
    </section> : <section className="ops-glass-card space-y-4">
      <div><p className="text-[10px] font-bold tracking-[.18em] text-cyan-300">DOCUMENT INTAKE</p><h2 className="text-xl font-semibold text-slate-100">{t("SMART CLIENT IMPORT BY LINK","استيراد ذكي عبر رابط")}</h2><p className="mt-1 text-[13px] text-slate-400">Photo / PDF / Text → deterministic extraction → provider enrichment → evidence → staged review.</p></div>

      {/* Staff capture, unchanged. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[.07] pt-4"><Link className="ops-primary-button min-h-11" href={mobilePath}>OPEN MOBILE FORM</Link><button className="ops-secondary-button min-h-11" type="button" onClick={copyMobileLink}>COPY LINK</button><button className="ops-secondary-button min-h-11" type="button" aria-expanded={showQr} onClick={() => setShowQr((value) => !value)}>QR</button></div>
      {showQr && <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-black/10 p-4"><img className="h-40 w-40 rounded-xl bg-white p-2" src="/api/staff/smart-client-import/qr" alt="Smart Client Import QR" /><div><strong className="text-slate-100">Secure mobile intake</strong><p className="mt-1 text-xs text-slate-500">Authenticated staff session required.</p></div></div>}

      <div className="rounded-2xl border border-[#e3c884]/20 bg-gradient-to-b from-[#e3c884]/[.055] to-transparent p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold tracking-[.18em] text-[#e3c884]">CLIENT SELF-INTAKE</p>
            <p className="mt-1 text-[13px] text-slate-400">One canonical one-time client link. Generate and manage it from the intake surface.</p>
          </div>
          <Link className="ops-secondary-button min-h-11" href="/staff/smart-client-import/new#client-self-intake">MANAGE CLIENT LINK</Link>
        </div>
      </div>
    </section>}

    <section className="ops-glass-card cg-import-queue space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-100">{t("IMPORT QUEUE","قائمة انتظار الاستيراد")}</h2><p className="text-xs text-slate-500">{t("Live staged files · Approve now and complete follow-up details later.","الملفات قيد الإعداد · اعتمد الآن واستكمل بيانات المتابعة لاحقاً.")}</p></div><div className="flex flex-wrap gap-2">
          <button className={`ops-secondary-button ${!archiveView ? "ring-1 ring-cyan-300/30" : ""}`} type="button" onClick={() => { setArchiveView(false); setFilter("ALL"); setPage(1); }}>{t("ACTIVE QUEUE","قائمة الانتظار النشطة")}</button>
          <button className={`ops-secondary-button ${archiveView ? "ring-1 ring-amber-300/40" : ""}`} type="button" onClick={() => { setArchiveView(true); setPage(1); }}>{t("APPROVED / ARCHIVE","المعتمد / الأرشيف")}</button>
          <input className="ops-input min-w-0 w-full sm:w-72" aria-label="Search imports" placeholder="Name, phone, email, Import ID" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div></div>
      {!archiveView && <div className="flex flex-wrap gap-2">{STATUSES.map((status) => <button key={status} type="button" onClick={() => { setFilter(status); setPage(1); }} className={`rounded-full border px-3 py-2 text-[10px] font-semibold ${filter === status ? "border-amber-300/35 bg-amber-300/[.08] text-amber-200" : "border-white/10 text-slate-500"}`}>{STATUS_LABEL[status]} · {counters[status]}</button>)}</div>}
      <div className="cg-import-lines" role="table" aria-label="Import queue" aria-busy={queuePending} data-page={queueSnapshot.page} data-query={queueSnapshot.query}>
        <div role="rowgroup" className="cg-import-line-head"><div role="row"><span role="columnheader">Client</span><span role="columnheader">Progress</span><span role="columnheader">Received</span><span role="columnheader">Reviewer</span><span role="columnheader">Actions</span></div></div>
        <div role="rowgroup">
          {queuePending && rows.length === 0 ? Array.from({ length: 3 }).map((_, index) => <div role="row" key={index} className="cg-import-line cg-import-loading"><div role="cell" className="h-12 animate-pulse rounded-xl bg-white/[.05] motion-reduce:animate-none" /></div>) : rows.map((row) => <div role="row" key={row.id} className={`cg-import-line ${detail?.case.id === row.id ? "is-selected" : ""}`}>
            <div role="cell" className="cg-import-client"><span className="cg-import-avatar" aria-hidden="true">{row.full_name?.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "—"}</span><div className="min-w-0"><strong dir="auto">{highlight(row.full_name || "Unidentified client")}</strong><p className="cg-import-contact">{row.phone || "Phone pending"}{row.email && <span> · {row.email}</span>}</p><p className="cg-import-origin"><span>{row.source_type.replaceAll("_", " ")}</span><span>{row.document_count} source{row.document_count === 1 ? "" : "s"}</span><span title={row.id}>#{row.id.slice(0, 8)}</span></p></div></div>
            <div role="cell" className="cg-import-progress"><span className={`cg-import-state ${row.status === "APPROVED_FILE" ? "is-approved" : ""}`}><i aria-hidden="true" />{row.status === "APPROVED_FILE" ? "Approved" : row.status === "PENDING" ? "New intake" : "In review"}</span><small>{row.issue_count ? `${row.issue_count} follow-up item${row.issue_count === 1 ? "" : "s"}` : "Ready to continue"}</small></div>
            <div role="cell" className="cg-import-received"><span>{new Date(row.created_at).toLocaleDateString("en-US", { timeZone: "America/Detroit", month: "short", day: "numeric" })}</span><small>{new Date(row.created_at).toLocaleTimeString("en-US", { timeZone: "America/Detroit", hour: "numeric", minute: "2-digit" })}</small></div>
            <div role="cell" className="cg-import-reviewer"><span>{row.reviewer_name ?? "Unassigned"}</span><small>{row.reviewer_id ? "Review owner" : "Assigned when opened"}</small></div>
            <div role="cell" className="cg-import-actions">
              {row.created_client_id ? <Link className="cg-review-button" href={`/staff/client/${row.created_client_id}`}>{t("Open Client","فتح العميل")}</Link> : <>
                <button className="cg-review-button" type="button" aria-label="OPEN / EDIT" disabled={Boolean(actionBusy) || Boolean(row.archived_at)} onClick={() => void openCase(row.id)}>{t("Open","فتح")}</button>
                <button className={`cg-review-button cg-queue-approve ${row.issue_count || !row.document_count ? "is-missing" : ""}`} type="button" aria-label={`Approve ${row.full_name || "import"}`} disabled={Boolean(actionBusy) || Boolean(row.archived_at)} onClick={() => void openCase(row.id, false, "edit", true)}>{t("Approve","اعتماد")}{!row.document_count && <span className="cg-missing-badge">{t("Missing","نواقص")}</span>}</button>
              </>}
              <div className="cg-import-secondary"><button className="cg-review-button cg-review-audit" type="button" aria-label={`Audit client ${row.full_name || "Unidentified client"}`} disabled={Boolean(actionBusy) || Boolean(row.archived_at && row.status !== "APPROVED_FILE")} onClick={() => void openCase(row.id, false, "audit")}>{t("Audit","تدقيق")}</button><button className="cg-review-button cg-review-audit" type="button" aria-label={`Source for client ${row.full_name || "Unidentified client"}`} disabled={Boolean(actionBusy) || Boolean(row.archived_at && row.status !== "APPROVED_FILE")} onClick={() => void openCase(row.id, false, "source")}>{t("Source","المصدر")}</button><button className="cg-import-archive" type="button" disabled={Boolean(actionBusy)} onClick={() => void archiveRow(row.id)}>{actionBusy === `archive:${row.id}` ? t("ARCHIVING…","جارٍ الأرشفة…") : t("Archive","أرشفة")}</button></div>
            </div>
          </div>)}
        </div>
      </div>
      {!queuePending && rows.length === 0 && <div className="rounded-xl border border-white/10 p-6 text-center"><p className="text-sm text-slate-400">No imports match this view.</p><button type="button" className="ops-secondary-button mt-3" onClick={() => { setArchiveView(false); setFilter("ALL"); setPage(1); setSearch(""); }}>SHOW ACTIVE IMPORTS</button></div>}
      <nav className="cg-pagination" aria-label="Import queue pages"><span>{total ? `${(queueSnapshot.page-1)*10+1}–${Math.min(queueSnapshot.page*10,total)}` : "0"} {t("of","من")} {total} · {t("10 clients per page","10 عملاء في الصفحة")}</span><div><button type="button" disabled={queuePending || queueSnapshot.page <= 1} onClick={() => setPage(queueSnapshot.page-1)}>{t("Previous","السابق")}</button>{Array.from({length:Math.min(5,Math.max(1,Math.ceil(total/10)))},(_,index)=>Math.max(1,Math.min(queueSnapshot.page-2,Math.max(1,Math.ceil(total/10))-4))+index).map((number)=><button key={number} type="button" aria-label={`Import page ${number}`} aria-current={queueSnapshot.page===number?"page":undefined} disabled={queuePending} onClick={() => {if(number===page)void loadQueue(number);else setPage(number);}}>{number}</button>)}<button type="button" disabled={queuePending || queueSnapshot.page >= Math.max(1,Math.ceil(total/10))} onClick={() => {const next=queueSnapshot.page+1;if(next===page)void loadQueue(next);else setPage(next);}}>{t("Next","التالي")}</button></div></nav>
    </section>

    {detail && draft && <section id="smart-review" onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void mutate("save", { reviewer_id: reviewerId, draft, document_match_confirmed: documentConfirmed, information_match_confirmed: informationConfirmed }); } }} className="ops-glass-card cg-smart-review relative space-y-5">
      <DigitalHandshake sweep={sweep} />
      {(!offlineDraft.online || offlineDraft.message) && <div role="status" className="cg-offline-review"><strong>{offlineDraft.online ? t("Review draft","مسودة المراجعة") : t("Offline · draft editing available","غير متصل · يمكن تحرير المسودة")}</strong><p>{offlineDraft.message || t("Save Draft queues your changes with the original server version. Approval requires a connection.","يحفظ زر المسودة التعديلات مع نسخة الخادم الأصلية. يتطلب الاعتماد اتصالاً بالشبكة.")}</p>{offlineDraft.state === "conflict" && <div className="flex gap-2"><button type="button" className="cg-review-button" onClick={offlineDraft.restore}>{t("Restore for comparison","استعادة للمقارنة")}</button><button type="button" className="cg-review-button" onClick={() => {offlineDraft.clear();if(detail)void openCase(detail.case.id,true);}}>{t("Discard local draft & load latest","ترك المسودة وتحميل الأحدث")}</button></div>}</div>}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12px] font-bold tracking-[.18em] text-amber-300">{t("SMART CLIENT REVIEW","مراجعة العميل الذكي")}</p>
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
          <button className="ops-secondary-button min-h-11" type="button" disabled={Boolean(actionBusy)} onClick={closeReview}>{t("CLOSE","إغلاق")}</button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="REQUIRED FIELDS" value={`${readiness.complete} / ${readiness.total}`} tone={readiness.complete === readiness.total ? "emerald" : "amber"} />
        <Stat label="FOLLOW-UP MISMATCHES" value={String(sourceConflicts.length)} tone={sourceConflicts.length ? "amber" : "emerald"} />
        <Stat label="MISSING REPORTED" value={String(detail.case.missing_fields.length)} tone={detail.case.missing_fields.length ? "amber" : "emerald"} />
      </div>

      {reviewMode === "audit" && <details className="cg-review-audit-overview" open><summary>Latest recorded evidence <span>{detail.case.field_evidence.length} entries</span></summary><ol>{detail.case.field_evidence.slice(-8).reverse().map((entry, index) => <li key={index}><strong>{SMART_FIELDS.find((field) => field.key === canonicalSmartFieldKey(entry.field_key))?.label ?? entry.field_key}</strong><span>{smartFieldText(entry.normalized_value ?? entry.value) || "Value cleared"}</span><small>{entry.authority === "MANUAL" || entry.source_type === "manual_review" ? "Staff edit" : entry.source_type?.replaceAll("_", " ") || "Source"}</small></li>)}</ol>{detail.case.field_evidence.length === 0 && <p>No evidence has been recorded yet. Field audits remain available below.</p>}<p>Open a field’s Audit to inspect its full history and source readings.</p></details>}
      {reviewChanged && <div role="alert" className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100"><p>Another staff member updated this review. Your changes remain on this screen. Reload the saved review before making further changes.</p><button type="button" className="cg-review-button mt-3" disabled={Boolean(actionBusy)} onClick={async () => { if (await confirmReview(t("Reload review","إعادة تحميل المراجعة"), t("Discard your local edits and load the latest saved review?","هل تريد ترك التعديلات المحلية وتحميل أحدث نسخة؟"))) void openCase(detail.case.id, true); }}>Reload latest review</button></div>}
      <div className="cg-review-workspace">
        <div className="cg-source-launch"><div><strong>{t("Source documents","وثائق المصدر")}</strong><p>{detail.documents.length} {t("attached · Preview without leaving this review","مرفقة · معاينة دون مغادرة المراجعة")}</p></div><button type="button" className="cg-review-button" onClick={() => setSourceOpen(true)}>{t("Open documents","فتح الوثائق")} ↗</button></div>
        {sourceOpen && <GlassReviewDialog title={t("Source documents","وثائق المصدر")} wide drawer onClose={() => setSourceOpen(false)}><div id="smart-document-viewer">
          <div className="cg-document-controls">{detail.case.status !== "APPROVED_FILE" && <><input ref={reattachRef} className="sr-only" type="file" accept={REATTACH_ACCEPT} multiple onChange={(event) => void reattach(event.target.files)} /><button className="cg-review-button" type="button" disabled={Boolean(actionBusy) || draftDirty || editingField || reviewChanged || offlineSyncing || !offlineDraft.online} onClick={() => reattachRef.current?.click()}>{t("Re-attach","إرفاق وثيقة")}</button></>}<button type="button" aria-label="Zoom out document" disabled={documentZoom <= 50} onClick={() => setDocumentZoom((value) => value-25)}>−</button><span dir="ltr">{documentZoom}%</span><button type="button" aria-label="Zoom in document" disabled={documentZoom >= 250} onClick={() => setDocumentZoom((value) => value+25)}>＋</button><button type="button" onClick={() => setDocumentZoom(100)}>{t("Fit","ملاءمة")}</button></div>
          {sourceField && <p className="cg-matrix-summary">{t("Source review","مراجعة المصدر")} · {sourceField}</p>}
          {activeDocument ? <><div className="cg-document-stage">{activeDocument.mime_type.startsWith("image/") ? <img style={{width:`${documentZoom}%`}} src={`/api/staff/smart-client-import/document/${activeDocument.id}`} alt={activeDocument.original_filename} /> : <iframe title={activeDocument.original_filename} style={{width:`${documentZoom}%`}} src={`/api/staff/smart-client-import/document/${activeDocument.id}#page=${sourcePage??1}&zoom=${documentZoom}`} />}</div><div className="cg-document-controls" style={{marginTop:16}}>{detail.documents.map((doc) => <button type="button" key={doc.id} aria-pressed={activeDocument.id===doc.id} onClick={() => {setActiveDocumentId(doc.id);setSourcePage(null);setDocumentZoom(100);}}>{doc.original_filename}</button>)}</div></> : <p className="cg-override-summary">{t("No source document attached. You can approve with a recorded reason, then attach documents to the Client later.","لا توجد وثيقة مرفقة. يمكن الاعتماد بسبب مسجل، ثم استكمال الوثائق في ملف العميل لاحقاً.")}</p>}
        </div></GlassReviewDialog>}

        <div className="cg-review-data min-w-0 p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-[14px] font-semibold tracking-[.1em] text-slate-100">{t("CLIENT DATA · VALIDATION MATRIX","بيانات العميل · مصفوفة التحقق")}</h3>
              <p className="mt-1 text-[12px] text-slate-400">{t("Review each value, compare its evidence, then apply your correction. Saved staff edits take precedence over extraction.","راجع القيم وقارنها بأدلتها ثم اعتمد التعديل. تعطى الأولوية للتعديلات البشرية المحفوظة.")}</p>
            </div>
            <span className="rounded-full border border-white/12 px-2.5 py-1 text-[12px] text-slate-300">{SMART_FIELDS.length} REVIEWED FIELDS</span>
          </div>
          <div className="mt-3">
            <ValidationMatrix
              key={detail.case.id}
              read={getField}
              onCommit={commitField}
              onEditingChange={fieldEditingChanged}
              pendingFields={pendingFields}
              staffNames={Object.fromEntries(activeStaff.map((member) => [member.id, member.display_name]))}
              disabled={Boolean(actionBusy) || reviewChanged || offlineSyncing}
              evidence={detail.case.field_evidence}
              missingFields={detail.case.missing_fields}
              conflicts={detail.case.conflicts}
              readOnly={detail.case.status === "APPROVED_FILE"}
              editHref={detail.case.created_client_id ? `/staff/client/${detail.case.created_client_id}/edit` : undefined}
              onViewSource={jumpToEvidence}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/10 p-4 space-y-3">
        <label className="block text-[13px] font-semibold text-slate-200" htmlFor="smart-reviewer">{t("REVIEWED BY","المراجع")}</label>
        <RoyalSelect id="smart-reviewer" className="ops-input min-h-11 w-full text-[14px]" value={reviewerId} disabled={Boolean(detail.case.reviewer_id) || detail.case.status === "APPROVED_FILE" || Boolean(actionBusy) || reviewChanged || offlineSyncing} onChange={(e) => { localReviewRevision.current += 1; setReviewerId(e.target.value); setDraftDirty(true); }}>
          <RoyalOption value="">Unassigned</RoyalOption>
          {activeStaff.map((member) => <RoyalOption key={member.id} value={member.id}>{member.display_name} · {member.staff_code ?? member.role}</RoyalOption>)}
        </RoyalSelect>
        {detail.case.reviewer_id && <p className="text-xs text-slate-400">This file is assigned to {detail.case.reviewer_name ?? activeStaff.find((member) => member.id === reviewerId)?.display_name ?? "the recorded reviewer"}. Each edit also records the staff member who made it.</p>}
      </div>

      <p className="text-xs text-slate-400">{t("Optional match checks · Complete them now or continue after approval.","فحوص تطابق اختيارية · أكملها الآن أو بعد الاعتماد.")}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-[13px] leading-6 text-slate-200"><input type="checkbox" className="mt-1 h-4 w-4" checked={documentConfirmed} disabled={detail.case.status === "APPROVED_FILE" || Boolean(actionBusy) || reviewChanged} onChange={(e) => { localReviewRevision.current += 1; setDocumentConfirmed(e.target.checked); setDraftDirty(true); }} /><span><strong className="block">{t("CURRENT DOCUMENT STATUS REVIEWED","تمت مراجعة حالة الوثائق")}</strong><span className="text-slate-400">{t("Missing documents may remain outstanding after approval.","يمكن استكمال الوثائق الناقصة بعد الاعتماد.")}</span></span></label>
        <label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-[13px] leading-6 text-slate-200"><input type="checkbox" className="mt-1 h-4 w-4" checked={informationConfirmed} disabled={detail.case.status === "APPROVED_FILE" || Boolean(actionBusy) || reviewChanged} onChange={(e) => { localReviewRevision.current += 1; setInformationConfirmed(e.target.checked); setDraftDirty(true); }} /><span><strong className="block">{t("INFORMATION MATCH CONFIRMED","تم تأكيد تطابق البيانات")}</strong><span className="text-slate-400">{t("Leave unchecked when information is unmatched or still awaiting review.","اتركه دون تحديد إذا كانت البيانات غير مطابقة أو قيد المراجعة.")}</span></span></label>
      </div>

      {detail.case.status !== "APPROVED_FILE" && approvalBlockers.length > 0 && (
        <ul role="alert" className="rounded-2xl border border-red-300/30 bg-red-300/[.06] p-4 text-[13px] leading-6 text-red-100">
          <li className="mb-1 font-semibold tracking-[.1em] text-red-200">{t("APPROVAL IS BLOCKED","الاعتماد غير متاح")}</li>
          {approvalBlockers.map((blocker) => <li key={blocker} className="ml-4 list-disc">{blocker}</li>)}
        </ul>
      )}
      {detail.case.status !== "APPROVED_FILE" && approvalBlockers.length === 0 && approvalWarnings.length > 0 && (
        <details className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <summary className="cursor-pointer text-[13px] font-semibold text-slate-200">
            {approvalWarnings.length} follow-up item{approvalWarnings.length === 1 ? "" : "s"} can be completed later
            <span className="ml-2 font-normal text-slate-400">— this file can be approved now</span>
          </summary>
          <ul aria-live="polite" className="mt-2 space-y-1 text-[13px] leading-6 text-slate-300">
            {approvalWarnings.map((warning) => (
              <li key={warning.field} className="ml-4 list-disc">
                <span className={warning.state === "REVIEW" ? "text-amber-200" : "text-slate-300"}>{warning.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div id="smart-approval-bar" className="sticky bottom-3 z-10 rounded-2xl border border-[#b8934a]/25 bg-[linear-gradient(145deg,rgba(12,35,68,.9),rgba(4,11,25,.9))] p-3.5 shadow-[0_22px_60px_-28px_rgba(0,0,0,.85)] backdrop-blur-xl">
        {error && <p role="alert" className="mb-3 rounded-lg border border-red-300/25 bg-red-300/[.06] p-3 text-sm text-red-200">{error}</p>}
        {editingField && <p className="mb-3 text-sm font-medium text-amber-200" role="status">Apply or cancel the active field edit before saving, verifying or approving.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-slate-400">
            <span className="font-mono text-[12px]">{readiness.complete} / {readiness.total} REQUIRED</span>
            <span aria-hidden="true" className="text-slate-600">|</span>
            <span className={draftDirty ? "text-amber-200" : "text-emerald-300"}>{draftDirty ? "Unsaved manual edits" : "No unsaved edits"}</span>
            {assessment && detail.case.status !== "APPROVED_FILE" && <><span aria-hidden="true" className="text-slate-600">|</span><span role="status" className={assessment.readiness === "BLOCKED" ? "text-red-200" : assessment.readiness === "READY_TO_APPROVE" ? "text-emerald-300" : "text-amber-200"}>{assessment.readiness.replace(/_/g, " ")}{assessment.blocked ? ` · ${assessment.blockers[0]}` : assessment.warnings.length ? ` · ${assessment.warnings.length} follow-up item${assessment.warnings.length === 1 ? "" : "s"} can be completed later` : " · Ready to approve"}</span></>}
            {detail.case.status !== "APPROVED_FILE" && <><span aria-hidden="true" className="text-slate-600">|</span><span className="rounded-md border border-white/[.08] bg-black/25 px-2 py-1 font-mono text-[11px]">⌘/Ctrl + S</span><span>Save draft</span></>}
          </div>
          <div className="flex flex-wrap gap-2">
            {detail.case.status === "APPROVED_FILE" && detail.case.created_client_id
              ? <Link className="ops-primary-button inline-flex min-h-12 items-center justify-center px-5 text-[14px]" href={`/staff/client/${detail.case.created_client_id}`}>OPEN CLIENT</Link>
              : <>
                    {!detail.case.review_started_at && <button className="ops-secondary-button min-h-12 px-4 text-[13px]" type="button" disabled={!reviewerId || Boolean(actionBusy) || editingField || reviewChanged || offlineSyncing} onClick={() => mutate("start_review", { reviewer_id: reviewerId })}>{actionBusy === "start_review" ? t("STARTING…","جارٍ البدء…") : t("START REVIEW","بدء المراجعة")}</button>}
                    <button className="ops-secondary-button min-h-12 px-4 text-[13px]" type="button" disabled={!reviewerId || Boolean(actionBusy) || editingField || reviewChanged || offlineSyncing} onClick={() => mutate("save", { reviewer_id: reviewerId, draft, document_match_confirmed: documentConfirmed, information_match_confirmed: informationConfirmed })}>{actionBusy === "save" ? t("SAVING…","جارٍ الحفظ…") : t("SAVE DRAFT","حفظ المسودة")}</button>
                    <button className="ops-secondary-button min-h-12 px-4 text-[13px]" type="button" disabled={Boolean(actionBusy) || !detail.documents.length || draftDirty || editingField || reviewChanged || offlineSyncing || !offlineDraft.online} onClick={() => void reExtract()}>{actionBusy === "re_extract" ? t("RE-EXTRACTING…","جارٍ إعادة الاستخراج…") : t("RE-EXTRACT","إعادة الاستخراج")}</button>
                    <button className="ops-secondary-button min-h-12 px-4 text-[13px]" type="button" disabled={!reviewerId || Boolean(actionBusy) || editingField || reviewChanged || offlineSyncing || !offlineDraft.online} onClick={() => void saveAndVerify()}>{actionBusy === "verify" ? t("VERIFYING…","جارٍ التحقق…") : t("CHECK & VERIFY","فحص وتحقق")}</button>
                    <button className={`ops-primary-button ${needsOverride ? "cg-approve-missing" : "cg-approve-ready"} min-h-12 px-5 text-[14px]`} type="button" aria-label="APPROVE FILE" disabled={!canApprove || Boolean(actionBusy) || !offlineDraft.online || offlineSyncing} onClick={requestApproval}>{actionBusy === "approve" ? t("CREATING CANONICAL CLIENT…","جارٍ إنشاء ملف العميل…") : t("APPROVE FILE","اعتماد الملف")}{needsOverride && <span className="cg-missing-badge">{t("Missing","نواقص")}</span>}</button>
                  </>}
          </div>
        </div>
      </div>
    </section>}
    {notice && <div role="status" className="cg-intake-toast">{notice}{approvedClient && (notice.startsWith("Client approved") || notice.startsWith("تم اعتماد العميل")) && <Link className="ml-3 underline" href={`/staff/client/${approvedClient}`}>{t("Open Client","فتح العميل")} ↗</Link>}</div>}
    {confirmation && <GlassReviewDialog title={confirmation.title} onClose={() => finishConfirmation(false)}><p>{confirmation.message}</p><div className="cg-confirm-actions"><button type="button" onClick={() => finishConfirmation(false)}>{t("Cancel","إلغاء")}</button><button type="button" className="cg-confirm-primary" onClick={() => finishConfirmation(true)}>{t("Continue","متابعة")}</button></div></GlassReviewDialog>}
    {overrideOpen && detail && draft && <GlassReviewDialog title={t("Approve with missing items","اعتماد مع نواقص")} onClose={() => {if(!actionBusy)setOverrideOpen(false);}}><div className="cg-override-summary"><strong>{t("Outstanding data and documents will remain visible to the team.","ستبقى البيانات والوثائق الناقصة ظاهرة للفريق.")}</strong><ul>{missingApprovalItems.map((item) => <li key={item.field}>{item.message}</li>)}{!detail.documents.length && !missingApprovalItems.some((item) => item.field === "source_documents") && <li>{t("No source document attached","لا توجد وثيقة مصدر مرفقة")}</li>}</ul></div><label htmlFor="override-reason">{t("Reason for approval and follow-up plan","سبب الاعتماد وخطة استكمال النواقص")}<textarea id="override-reason" rows={3} required minLength={8} maxLength={1000} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder={t("Explain why this file can proceed (at least 8 characters)","وضح سبب السماح بمتابعة الملف (8 أحرف على الأقل)")} /></label><p className="cg-matrix-summary">{t("Your identity, reason, time and outstanding fields will be recorded in the audit log. Follow-up tasks will be created. Identity and payment safeguards remain enforced.","سيتم تسجيل هويتك والسبب والوقت والحقول الناقصة في سجل التدقيق وإنشاء مهام متابعة، مع استمرار ضوابط الهوية والدفع.")}</p>{error && <p role="alert" style={{color:"#f49ba5"}}>{error}</p>}<div className="cg-confirm-actions"><button type="button" disabled={Boolean(actionBusy)} onClick={() => setOverrideOpen(false)}>{t("Cancel","إلغاء")}</button><button type="button" className="cg-confirm-primary" disabled={!canApprove || overrideReason.trim().length<8 || Boolean(actionBusy) || !offlineDraft.online || offlineSyncing} onClick={() => void mutate("approve", {reviewer_id:reviewerId,draft,document_match_confirmed:documentConfirmed,information_match_confirmed:informationConfirmed,override:true,override_reason:overrideReason.trim()})}>{actionBusy === "approve" ? t("Approving…","جارٍ الاعتماد…") : t("Approve & defer missing items","اعتماد وتأجيل النواقص")}</button></div></GlassReviewDialog>}
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
