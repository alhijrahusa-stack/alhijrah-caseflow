"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { GlassReviewDialog } from "@/components/staff/smart/GlassReviewDialog";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { useStaff } from "@/components/staff/StaffContext";
import { useTargetedMutationBatch } from "@/components/staff/realtime/useTargetedMutation";

type Duplicate = { id: string; ref: string; full_name: string; phone: string; assigned_name: string | null };
type DispatchRequest = { operation: "urgent"; client_id: string; urgent: boolean; operation_id: string; expected_updated_at?: string }
  | { operation: "duplicate_review"; client_id: string; related_client_id: string; note: string; operation_id: string };
type Props = { clientId: string; isUrgent?: boolean; managerReviewId?: string | null; updatedAt?: string; operationalLocation?: string; management?: boolean; compact?: boolean };

export function ClientDispatchActions({ clientId, isUrgent = false, managerReviewId, updatedAt, operationalLocation, management = false, compact = false }: Props) {
  const { t } = useStaffLanguage();
  const { me } = useStaff();
  const onMutated = useTargetedMutationBatch();
  const [optimisticUrgent, setOptimisticUrgent] = useState<boolean | null>(null);
  const urgent = optimisticUrgent ?? isUrgent;
  const [seed, setSeed] = useState({ isUrgent, updatedAt });
  if (seed.isUrgent !== isUrgent || seed.updatedAt !== updatedAt) { setSeed({ isUrgent, updatedAt }); setOptimisticUrgent(null); }
  const [reviewHeld, setReviewHeld] = useState(false);
  const [reviewSeed, setReviewSeed] = useState(updatedAt);
  if (reviewSeed !== updatedAt) { setReviewSeed(updatedAt); setReviewHeld(false); }
  const held = !!managerReviewId || reviewHeld;
  const unavailable = held || ["completed", "cancelled", "deleted"].includes(operationalLocation ?? "");
  const [open, setOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [loading, setLoading] = useState(false);
  const [related, setRelated] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [activeOperation, setActiveOperation] = useState<DispatchRequest["operation"] | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<DispatchRequest | null>(null);
  const sending = useRef(false);
  const draftKey = `career-gate:duplicate-review:v1:${me.id}:${clientId}`;

  function saveDraft(nextNote: string, nextRelated: string) {
    try { sessionStorage.setItem(draftKey, JSON.stringify({ version: 1, note: nextNote, related: nextRelated })); } catch { /* Draft storage is optional. */ }
  }

  async function recordedOperation(operationId: string) {
    try {
      const response = await fetch(`/api/staff/client-dispatch?operation_id=${encodeURIComponent(operationId)}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      const result = await response.json();
      return response.ok && result.ok && result.result !== null && typeof result.result === "object";
    } catch { return false; }
  }

  function acknowledge(body: DispatchRequest) {
    request.current = null;
    if (body.operation === "duplicate_review") {
      setReviewHeld(true); setOpen(false); setNote("");
      try { sessionStorage.removeItem(draftKey); } catch { /* Draft storage is optional. */ }
      setNotice(t("Both original files were sent to the manager center for comparison.", "نُقل الملفان الأصليان إلى مركز المدير للمقارنة."));
    } else {
      setOptimisticUrgent(body.urgent);
      setNotice(body.urgent ? t("Moved to Urgent", "نُقل إلى Urgent") : t("Returned to its workflow section", "أُعيد إلى قسمه في مسار العمل"));
    }
    setUncertain(false); setError("");
    onMutated("client_dispatch", body.operation === "duplicate_review" ? [clientId, body.related_client_id] : [clientId]);
  }

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timeout);
  }, [notice]);

  async function send(next: DispatchRequest) {
    if (sending.current) return;
    const retry = request.current !== null;
    const body = request.current ?? next;
    request.current = body;
    sending.current = true; setPending(true); setActiveOperation(body.operation); setError(""); setUncertain(false);
    if (body.operation === "urgent") setOptimisticUrgent(body.urgent);
    try {
      // A lost response may follow a committed transaction. Check the receipt
      // before replaying the exact same idempotent request.
      if (retry && await recordedOperation(body.operation_id)) { acknowledge(body); return; }
      const response = await fetch("/api/staff/client-dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
      const result = await response.json().catch(() => null);
      if (!result || response.status >= 500) throw new Error(t("The result could not be confirmed. Retry to verify the same request.", "تعذر تأكيد النتيجة. أعد المحاولة للتحقق من الطلب نفسه."));
      if (!response.ok || !result.ok) {
        request.current = null;
        if (body.operation === "urgent") setOptimisticUrgent(null);
        onMutated("client_dispatch", body.operation === "duplicate_review" ? [clientId, body.related_client_id] : [clientId]);
        setError(result.error?.message ?? t("The change was not saved.", "لم يُحفظ التغيير."));
        return;
      }
      acknowledge(body);
    } catch (cause) {
      if (await recordedOperation(body.operation_id)) { acknowledge(body); return; }
      if (body.operation === "urgent") setOptimisticUrgent(null);
      setUncertain(true);
      setError(cause instanceof Error && cause.name !== "TimeoutError" && cause.name !== "AbortError" ? cause.message : t("Connection interrupted. Retry to verify the same request.", "انقطع الاتصال. أعد المحاولة للتحقق من الطلب نفسه."));
    } finally { sending.current = false; setPending(false); }
  }

  async function findDuplicates() {
    if (loading || pending) return;
    setOpen(true); setLoading(true); setError(""); setDuplicates([]); setRelated("");
    let savedChoice = "";
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey) ?? "null");
      if (draft?.version === 1) {
        setNote(typeof draft.note === "string" ? draft.note.slice(0, 2000) : "");
        savedChoice = typeof draft.related === "string" ? draft.related : "";
      }
    } catch { /* Draft storage is optional. */ }
    try {
      const response = await fetch(`/api/staff/client-dispatch?client_id=${encodeURIComponent(clientId)}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? t("Similar files could not be loaded", "تعذر تحميل الملفات المتشابهة"));
      const matches = Array.isArray(result.duplicates) ? result.duplicates.filter((value: Duplicate) => typeof value.id === "string" && value.id !== clientId) : [];
      setDuplicates(matches); setRelated(matches.some((record: Duplicate) => record.id === savedChoice) ? savedChoice : matches[0]?.id ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Connection failed", "تعذر الاتصال")); }
    finally { setLoading(false); }
  }

  return <div className={`cg-dispatch-actions ${compact ? "text-xs" : "text-sm"}`}>
    <div className="flex flex-wrap items-center gap-2">
      {held ? management ? <Link href="/staff/manager-inbox" className="cg-command-button">{t("Awaiting manager review", "بانتظار مراجعة المدير")}</Link> : <span role="status" className="text-xs">{t("Awaiting manager review", "بانتظار مراجعة المدير")}</span> : <>
        <button type="button" className="cg-command-button cg-urgent-action" aria-pressed={urgent} disabled={unavailable || pending || uncertain} onClick={() => void send({ operation: "urgent", client_id: clientId, urgent: !urgent, operation_id: crypto.randomUUID(), ...(updatedAt ? { expected_updated_at: updatedAt } : {}) })}>
          <span aria-hidden="true">⚡</span> {pending && activeOperation === "urgent" ? t("Moving…", "جارٍ النقل…") : urgent ? t("Return from Urgent", "إعادة من Urgent") : t("Move to Urgent", "نقل إلى Urgent")}
        </button>
        <button type="button" className="cg-command-button" disabled={unavailable || pending || uncertain} onClick={() => void findDuplicates()}>{t("Review similar files", "مراجعة الملفات المتشابهة")}</button>
      </>}
      {uncertain && <button type="button" disabled={pending} className="cg-command-button" onClick={() => { if (request.current) void send(request.current); }}>{pending ? t("Verifying…", "جارٍ التحقق…") : t("Retry same request", "إعادة محاولة الطلب نفسه")}</button>}
    </div>
    {error && !open && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    {notice && <p role="status" className="mt-2 text-xs text-emerald-300">{notice}</p>}
    {open && <GlassReviewDialog title={t("Possible duplicate · manager review", "تشابه محتمل · مراجعة المدير")} onClose={() => { if (!pending) setOpen(false); }}>
      <div className="space-y-4 p-1">
        <p className="text-sm">{t("The same phone with an identical or shortened name suggests a review. Both originals will move to the manager center until a decision. Only the manager can keep or delete a record.", "تطابق الهاتف مع الاسم نفسه أو صيغة مختصرة منه يستدعي المراجعة. ينتقل الملفان الأصليان إلى مركز المدير حتى حسم القرار. المدير وحده يقرر إبقاء السجل أو حذفه.")}</p>
        {loading ? <p role="status">{t("Checking similar records…", "جارٍ فحص السجلات المتشابهة…")}</p> : duplicates.length ? <fieldset className="space-y-2" disabled={pending || uncertain}><legend className="mb-2 text-sm font-semibold">{t("Compare with", "المقارنة مع")}</legend>{duplicates.map(record => <label key={record.id} className="flex gap-3 rounded-xl border border-sky-300/25 bg-sky-300/5 p-3"><input type="radio" name={`duplicate-${clientId}`} value={record.id} checked={related === record.id} onChange={() => { setRelated(record.id); saveDraft(note, record.id); }} className="mt-1"/><span className="min-w-0"><strong className="block"><bdi>{record.full_name}</bdi></strong><span className="block text-xs">{record.ref} · <bdi>{record.phone}</bdi></span><span className="block text-xs">{record.assigned_name ?? t("Unassigned", "غير معيّن")}</span></span></label>)}</fieldset> : <p role="status">{t("No similar records were found within your access.", "لم تُوجد سجلات متشابهة ضمن صلاحية وصولك.")}</p>}
        {!!duplicates.length && <label className="block text-sm">{t("Review note (optional)", "ملاحظة المراجعة (اختياري)")}<textarea className="input mt-2 w-full" rows={3} maxLength={2000} value={note} disabled={pending || uncertain} onChange={event => { setNote(event.target.value); saveDraft(event.target.value, related); }} dir="auto"/></label>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className="cg-command-button" disabled={pending} onClick={() => setOpen(false)}>{t("Close", "إغلاق")}</button><button type="button" className="ops-primary-button" disabled={pending || loading || !related} onClick={() => void send({ operation: "duplicate_review", client_id: clientId, related_client_id: related, note, operation_id: crypto.randomUUID() })}>{pending ? t("Sending…", "جارٍ الإرسال…") : uncertain ? t("Retry same request", "إعادة محاولة الطلب نفسه") : t("Send for manager review", "إرسال لمراجعة المدير")}</button></div>
      </div>
    </GlassReviewDialog>}
  </div>;
}
