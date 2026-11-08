"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RoyalOption, RoyalSelect } from "@/components/forms/RoyalSelect";
import { useStaff } from "@/components/staff/StaffContext";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { SecureDocumentDrawer } from "@/components/staff/SecureDocumentDrawer";
import { TeamNowPanel } from "@/components/staff/TeamNowPanel";
import { publishMutation, RECOVERY_EVENT, subscribeResources } from "@/components/staff/realtime/update-bus";
import { MANAGER_INBOX_SURFACE } from "@/components/staff/realtime/surfaces";
import { CLIENT_STAGES } from "@/lib/client-lifecycle-filters";
import { dateTime } from "@/lib/format";
import { FloatingHeader } from "@/components/staff/manager/FloatingHeader";
import { TaskCanvas } from "@/components/staff/manager/TaskCanvas";
import { SpatialDrawer } from "@/components/staff/manager/SpatialDrawer";
import type { ManagerReviewItem, ManagerFilters, ManagerSegment } from "@/components/staff/manager/types";
import type { ManagerInboxPage } from "@/lib/manager-inbox";
import styles from "@/components/staff/ManagerTaskCenter.module.css";

type ReviewItem = ManagerReviewItem;
type InboxPage = ManagerInboxPage;
type ReviewData = {
  client?: Record<string, unknown>;
  documents?: { id: string; file_name: string; doc_type: string; status: string }[];
  appointments?: { id: string; appointment_type: string; scheduled_at: string; status: string; outcome?: string | null }[];
  activity?: { id: string | number; action: string; staff_name?: string | null; created_at: string; new_value?: Record<string, unknown> | null }[];
  account?: { payment_status: string; balance: number; amount_paid_visible: boolean } | null;
  nextAction?: { title?: string; next_step?: string } | null;
};
type Filters = ManagerFilters;
type Draft = { note: string; destination: string; assignedStaffId: string; deleteClientId: string; deleteReason: string };
type Decision = "approve" | "return" | "delete" | "not_duplicate";
type Intent = { itemId: string; clientId: string | null; operationId: string; body: Record<string, unknown>; action: Decision; createdAt: string };
const INITIAL_FILTERS: Filters = { status: "open", kind: "", request_type: "", urgent: "", payments: "", sender: "", q: "", sort: "oldest" };
const EMPTY_DRAFT: Draft = { note: "", destination: "keep_current", assignedStaffId: "", deleteClientId: "", deleteReason: "" };
const pretty = (value: unknown) => value == null || value === "" ? "—" : String(value).replaceAll("_", " ");

function ClientReview({ clientId, version }: { clientId: string; version: string | null }) {
  const { t } = useStaffLanguage();
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    let controller: AbortController | null = null;
    let disposed = false;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const params = new URLSearchParams({ client_id: clientId, payloads: "client,documents,appointments,account,nextAction,activity" });
    const load = () => {
      controller?.abort();
      const current = new AbortController(); controller = current;
      void fetch(`/api/staff/client-resource?${params}`, { signal: current.signal, cache: "no-store" }).then(async response => {
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "Review is unavailable");
        if (!disposed && !current.signal.aborted) { setData(result.payloads); setError(""); }
      }).catch(cause => { if (!disposed && !current.signal.aborted) setError(cause instanceof Error ? cause.message : "Review is unavailable"); });
    };
    load();
    const unsubscribe = subscribeResources({ clientId, resources: ["client_identity", "documents", "account", "appointments", "next_action", "activity"], onUpdate: load });
    const visible = () => {
      if (document.visibilityState !== "visible") return;
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => { focusTimer = null; if (document.visibilityState === "visible") load(); }, 50);
    };
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; if (focusTimer) clearTimeout(focusTimer); controller?.abort(); unsubscribe(); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [clientId, version]);
  if (error) return <p role="alert" className={styles.error}>{error}</p>;
  if (!data) return <p role="status" className={styles.empty}>{t("Loading authorized client details…", "جارٍ تحميل بيانات العميل المصرح بها…")}</p>;
  return <div className={styles.reviewStack}>
    <dl className={styles.facts}>
      <div><dt>{t("Current status", "الحالة الحالية")}</dt><dd dir="auto">{pretty(data.client?.current_status)}</dd></div>
      <div><dt>{t("Assigned specialist", "الموظف المختص")}</dt><dd dir="auto">{pretty(data.client?.assigned_name)}</dd></div>
      <div><dt>{t("Phone", "الهاتف")}</dt><dd dir="ltr">{pretty(data.client?.phone)}</dd></div>
      <div><dt>{t("Preferred site", "الفرع المفضل")}</dt><dd dir="auto">{pretty(data.client?.preferred_site_name ?? data.client?.preferred_site ?? data.client?.preferred_location)}</dd></div>
      <div><dt>{t("Next step", "الخطوة التالية")}</dt><dd dir="auto">{pretty(data.nextAction?.title ?? data.nextAction?.next_step ?? data.client?.next_step)}</dd></div>
      <div><dt>{t("Verified ledger", "الدفتر المالي")}</dt><dd>{data.account ? `${pretty(data.account.payment_status)}${data.account.amount_paid_visible ? ` · $${Number(data.account.balance).toFixed(2)}` : ""}` : t("No account", "لا يوجد حساب")}</dd></div>
    </dl>
    <section className={styles.documentSection}><h3>{t("Documents", "الوثائق")} <span>{data.documents?.length ?? 0}</span></h3>
      {!data.documents?.length ? <p className={styles.muted}>{t("No documents uploaded", "لم تُرفع وثائق")}</p> : <ul className={styles.documentList}>{data.documents.map(doc => <li key={doc.id}>
        <button type="button" onClick={() => setPreview({ id: doc.id, name: doc.file_name || doc.doc_type })}><span><strong dir="auto">{doc.file_name || pretty(doc.doc_type)}</strong><small>{pretty(doc.status)}</small></span><span aria-hidden="true">↗</span><span className="sr-only">{t("Open document", "فتح الوثيقة")}</span></button>
      </li>)}</ul>}
    </section>
    {!!data.appointments?.length && <section className={styles.documentSection}><h3>{t("Appointments & outcomes", "المواعيد والنتائج")}</h3><ul className={styles.appointments}>{data.appointments.map(appointment => <li key={appointment.id}><strong>{appointment.appointment_type}</strong><time>{dateTime(appointment.scheduled_at)}</time><span>{pretty(appointment.status)} · {appointment.outcome ? pretty(appointment.outcome) : t("No recorded outcome", "لا توجد نتيجة مسجلة")}</span></li>)}</ul></section>}
    {!!data.activity?.length && <details className={styles.timeline}><summary>{t("Activity timeline", "سجل التتبع")}</summary><ol>{data.activity.map(entry => <li key={entry.id}><strong>{pretty(entry.new_value?.operation ?? entry.action)}</strong><span dir="auto">{entry.staff_name ?? t("System", "النظام")}</span><time>{dateTime(entry.created_at)}</time></li>)}</ol></details>}
    {preview && <SecureDocumentDrawer documentId={preview.id} name={preview.name} onClose={() => setPreview(null)} />}
  </div>;
}

function ReportReview({ item }: { item: ReviewItem }) {
  const { t } = useStaffLanguage();
  const kpis = item.snapshot.kpis && typeof item.snapshot.kpis === "object" ? item.snapshot.kpis as Record<string, unknown> : {};
  const labels: Record<string, [string, string]> = { newCurrent: ["New applications", "الطلبات الجديدة"], completedCurrent: ["Completed files", "الملفات المكتملة"], collectedCurrent: ["Collections", "المتحصلات"], receivables: ["Receivables", "المستحقات"], active: ["Active clients", "العملاء النشطون"], stalled: ["Stalled files", "الملفات المتوقفة"], documentsAwaitingReview: ["Documents awaiting review", "وثائق تنتظر المراجعة"], urgentAlerts: ["Urgent alerts", "التنبيهات العاجلة"] };
  const insights = Array.isArray(item.snapshot.insights) ? item.snapshot.insights as { text?: string }[] : [];
  return <div className={styles.reviewStack}><p className={styles.muted}>{t("Report snapshot at submission", "نسخة التقرير وقت الإرسال")} · {dateTime(String(item.snapshot.generated_at ?? item.submitted_at))}</p>
    <dl className={styles.facts}>{Object.entries(labels).filter(([key]) => key in kpis).map(([key, label]) => <div key={key}><dt>{t(...label)}</dt><dd dir="ltr">{typeof kpis[key] === "number" ? (kpis[key] as number).toLocaleString("en-US") : pretty(kpis[key])}</dd></div>)}</dl>
    {insights.length > 0 && <ul className={styles.reportInsights}>{insights.map((insight, index) => <li key={index}>{insight.text}</li>)}</ul>}
    <p className={styles.reportNotice}>{t("Routing a report creates a follow-up task for its sender in the selected workflow section. Client states are changed only when reviewing a client file.", "توجيه التقرير ينشئ مهمة متابعة لمرسله في القسم المختار. لا تتغير حالة عميل إلا عند مراجعة ملف عميل.")}</p>
  </div>;
}

class DecisionFailure extends Error {
  constructor(message: string, readonly definite: boolean) { super(message); }
}
async function submitDecision(intent: Intent) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("/api/staff/manager-inbox", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(intent.body), signal: controller.signal });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new DecisionFailure(result?.error?.message ?? "The decision could not be confirmed", response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429);
    return result as { already_resolved?: boolean; task_id?: string | null };
  } finally { window.clearTimeout(timeout); }
}

export function ManagerTaskCenter({ initial, reviewerId }: { initial: ManagerInboxPage; reviewerId: string }) {
  const { t, language } = useStaffLanguage();
  const { activeStaff } = useStaff();
  const [inbox, setInbox] = useState<InboxPage>(initial);
  const [reviewed, setReviewed] = useState<ReviewItem | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT });
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stale, setStale] = useState(false);
  const [liveState, setLiveState] = useState("connecting");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [uncertain, setUncertain] = useState<Intent | null>(null);
  const pendingRef = useRef(false);
  const restoredIntent = useRef<Intent | null>(null);
  const page = useRef(initial.page);
  const filtersRef = useRef(filters);
  const fetchedFilters = useRef(filters);
  const inboxRef = useRef(inbox);
  const reviewedRef = useRef(reviewed);
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { inboxRef.current = inbox; }, [inbox]);
  useEffect(() => { reviewedRef.current = reviewed; }, [reviewed]);
  const fetchSequence = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const drafts = useRef<Record<string, Draft>>({});
  const storageKey = `career-gate:manager-drafts:${reviewerId}`;
  const operationKey = `career-gate:manager-operation:${reviewerId}`;
  const persistDrafts = useCallback(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(drafts.current)); } catch { /* The in-memory draft remains available when storage is blocked. */ } }, [storageKey]);
  const saveIntent = useCallback((intent: Intent | null) => { setUncertain(intent); try { if (intent) sessionStorage.setItem(operationKey, JSON.stringify(intent)); else sessionStorage.removeItem(operationKey); } catch { /* Keep the operation in memory if browser storage is unavailable. */ } }, [operationKey]);
  const refresh = useCallback(async (nextPage = page.current, force = false): Promise<InboxPage | null> => {
    if (pendingRef.current && !force) return null;
    const sequence = ++fetchSequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController(); controllerRef.current = controller;
    const params = new URLSearchParams({ page: String(nextPage) });
    Object.entries(filtersRef.current).forEach(([key, value]) => { if (value) params.set(key, value); });
    setLoading(true);
    try {
      const response = await fetch(`${MANAGER_INBOX_SURFACE.endpoint}?${params}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "Inbox is unavailable");
      if (sequence !== fetchSequence.current || controller.signal.aborted) return null;
      const next = result.inbox as InboxPage;
      page.current = next.page; setInbox(next); setStale(false);
      setReviewed(current => current && next.items.some(item => item.id === current.id) ? current : null);
      return next;
    } catch { if (!controller.signal.aborted) setStale(true); return null; }
    finally { if (sequence === fetchSequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) drafts.current = stored;
      const current = reviewedRef.current;
      if (current && drafts.current[current.id]) setDraft({ ...EMPTY_DRAFT, ...drafts.current[current.id] });
      const intent = JSON.parse(sessionStorage.getItem(operationKey) ?? "null") as Intent | null;
      if (intent?.operationId && intent.itemId && intent.body) { setUncertain(intent); restoredIntent.current = intent; }
    } catch { /* Ignore malformed browser-local drafts. */ }
  }, [storageKey, operationKey]);
  useEffect(() => { const timer = window.setTimeout(() => setFilters(current => current.q === query.trim() ? current : { ...current, q: query.trim() }), 250); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => {
    // The first unfiltered page was fetched on the server. Only an actual
    // filter change needs another read; mutation and reconnect reads remain independent.
    if (fetchedFilters.current === filters) return;
    fetchedFilters.current = filters;
    page.current = 1; void refresh(1);
  }, [filters, refresh]);
  useEffect(() => {
    const unsubscribe = subscribeResources({ clientId: null, resources: MANAGER_INBOX_SURFACE.resources, onUpdate: () => { void refresh(); } });
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const visible = () => {
      if (document.visibilityState !== "visible") return;
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = setTimeout(() => { focusTimer = null; if (document.visibilityState === "visible") void refresh(); }, 50);
    };
    const stateChanged = (event: Event) => { const next = (event as CustomEvent<{ state?: string }>).detail?.state; if (next) setLiveState(next); };
    const stateFrame = requestAnimationFrame(() => {
      const observed = document.querySelector("[data-testid=\"realtime-state\"]")?.getAttribute("data-state");
      if (observed) setLiveState(observed);
    });
    window.addEventListener("career-gate:realtime-state", stateChanged);
    window.addEventListener("focus", visible); window.addEventListener(RECOVERY_EVENT, visible); document.addEventListener("visibilitychange", visible);
    return () => { if (focusTimer) clearTimeout(focusTimer); cancelAnimationFrame(stateFrame); unsubscribe(); controllerRef.current?.abort(); window.removeEventListener("career-gate:realtime-state", stateChanged); window.removeEventListener("focus", visible); window.removeEventListener(RECOVERY_EVENT, visible); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 6500); return () => window.clearTimeout(timer); }, [notice]);
  const updateDraft = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch }; setDraft(next);
    if (reviewed) { drafts.current[reviewed.id] = next; persistDrafts(); }
  };
  const select = (item: ReviewItem) => {
    if (pendingRef.current) return;
    setReviewed(item); setDraft({ ...EMPTY_DRAFT, ...drafts.current[item.id] }); setError(""); setDeleteOpen(false);
  };
  const finish = useCallback((intent: Intent, result: { already_resolved?: boolean; task_id?: string | null }) => {
    delete drafts.current[intent.itemId]; persistDrafts(); saveIntent(null);
    setReviewed(current => current?.id === intent.itemId ? null : current); setDeleteOpen(false); setError("");
    const stage = CLIENT_STAGES.find(row => row.id === intent.body.destination);
    setNotice(result.already_resolved ? t("This review has already been completed", "اكتملت هذه المراجعة بالفعل") : intent.action === "delete" ? t("Selected file moved to deleted files; its history is retained", "نُقل الملف المحدد إلى المحذوفات مع حفظ تاريخه") : intent.action === "return" ? t("File returned to its operational section", "أُعيد الملف إلى قسمه التشغيلي") : intent.action === "not_duplicate" ? t("Review closed: records are not duplicates", "أُغلقت المراجعة: السجلان غير مكررين") : result.task_id ? t("Report approved and follow-up task created", "تم اعتماد التقرير وإنشاء مهمة متابعة") : stage ? `${t("Approved and routed to", "تم الاعتماد والتوجيه إلى")} ${language === "ar" ? stage.labelAr : stage.label}` : t("Review completed and manager stamp recorded", "اكتملت المراجعة وسُجّل ختم المدير"));
    publishMutation("manager_review_resolved", intent.clientId); publishMutation("client_dispatch", intent.clientId);
  }, [persistDrafts, saveIntent, t, language]);
  const checkIntent = useCallback(async (intent: Intent): Promise<boolean> => {
    try {
      const response = await fetch(`/api/staff/client-dispatch?operation_id=${encodeURIComponent(intent.operationId)}`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
      const result = await response.json();
      if (response.ok && result.ok && result.result && typeof result.result === "object") { finish(intent, result.result); return true; }
    } catch { /* A missing response is not evidence that the database rolled back. */ }
    return false;
  }, [finish]);
  useEffect(() => {
    const intent = restoredIntent.current;
    if (!intent) return;
    restoredIntent.current = null;
    pendingRef.current = true; setPending(true);
    void checkIntent(intent).then(async confirmed => {
      await refresh(page.current, true);
      if (!confirmed) setError(t("The previous save has not yet been confirmed. Your draft is preserved; retry the same request if needed.", "لم تتأكد نتيجة الحفظ السابق بعد. مسودتك محفوظة ويمكن إعادة الطلب نفسه بأمان."));
    }).finally(() => { pendingRef.current = false; setPending(false); });
  }, [checkIntent, refresh, t]);
  async function execute(intent: Intent, optimistic = true) {
    if (pendingRef.current) return;
    pendingRef.current = true; setPending(true); setError(""); saveIntent(intent);
    // Abort older reads so an in-flight response cannot reinsert an optimistic row.
    ++fetchSequence.current; controllerRef.current?.abort(); setLoading(false);
    const before = inboxRef.current;
    if (optimistic && filtersRef.current.status === "open") setInbox(current => ({ ...current, items: current.items.filter(row => row.id !== intent.itemId), total: Math.max(0, current.total - 1), summary: { ...current.summary, awaiting_review: Math.max(0, current.summary.awaiting_review - 1) } }));
    try {
      const result = await submitDecision(intent); finish(intent, result); await refresh(page.current, true);
    } catch (cause) {
      if (cause instanceof DecisionFailure && cause.definite) {
        saveIntent(null); setInbox(before);
        setError(cause.message); await refresh(page.current, true);
      } else {
        const confirmed = await checkIntent(intent);
        await refresh(page.current, true);
        if (!confirmed) setError(t("The save result is not yet confirmed. Check its result or safely retry the same request. Your notes are preserved.", "لم تتأكد نتيجة الحفظ بعد. تحقق من النتيجة أو أعد الطلب نفسه بأمان. ملاحظاتك محفوظة."));
      }
    } finally { pendingRef.current = false; setPending(false); }
  }
  const currentItem = inbox.items.find(item => item.id === reviewed?.id);
  const changed = Boolean(reviewed?.client_id && currentItem && (currentItem.client_version !== reviewed.client_version || currentItem.related_client?.client_version !== reviewed.related_client?.client_version));
  const blocked = pending || Boolean(uncertain) || changed;
  const decide = (action: Decision) => {
    if (!reviewed || blocked || filters.status !== "open") return;
    if (action === "delete" && (!draft.deleteClientId || !draft.deleteReason.trim())) { setError(t("Choose the file and enter its deletion reason.", "حدد الملف واكتب سبب الحذف.")); return; }
    const operationId = crypto.randomUUID();
    const body: Record<string, unknown> = { id: reviewed.id, destination: draft.destination, note: draft.note, expected_client_version: reviewed.client_version, operation_id: operationId, action };
    if (reviewed.request_type === "duplicate") body.expected_related_client_version = reviewed.related_client?.client_version;
    if (draft.assignedStaffId) body.assigned_staff_id = draft.assignedStaffId;
    if (action === "delete") { body.delete_client_id = draft.deleteClientId; body.delete_reason = draft.deleteReason.trim(); }
    void execute({ itemId: reviewed.id, clientId: reviewed.client_id, operationId, body, action, createdAt: new Date().toISOString() });
  };
  const filter = (patch: Partial<Filters>) => { if (!pendingRef.current) { setFilters(current => ({ ...current, ...patch })); setReviewed(null); setError(""); } };
  const live = liveState === "live" && !stale;
  const liveLabel = live ? t("Live", "متصل لحظيًا") : liveState === "connecting" ? t("Connecting", "جارٍ الاتصال") : t("Updates paused", "التحديثات متوقفة");
  const duplicate = reviewed?.request_type === "duplicate";
  const readOnly = filters.status === "resolved" || Boolean(reviewed?.resolved_at);
  const segment: ManagerSegment = filters.status === "resolved" ? "resolved" : filters.payments ? "payments" : filters.urgent ? "urgent" : "action";
  const setSegment = (next: ManagerSegment) => filter({ status: next === "resolved" ? "resolved" : "open", urgent: next === "urgent" ? "1" : "", payments: next === "payments" ? "1" : "" });
  return <div className={styles.center} data-testid="manager-task-center" data-manager-spatial="true">
    <FloatingHeader summary={inbox.summary} query={query} onQueryChange={setQuery} onPaymentClick={() => { setQuery(""); filter({ ...INITIAL_FILTERS, payments: "1" }); }} teamNow={<TeamNowPanel compact />} live={live} liveLabel={liveLabel} disabled={pending}/>
    {stale && <div className={styles.error} role="status">{t("Live inbox could not be refreshed. Displayed figures may be out of date.", "تعذر تحديث الوارد. قد لا تعكس الأرقام آخر التغييرات.")} <button type="button" onClick={() => { void refresh(); }}>{t("Retry", "إعادة المحاولة")}</button></div>}
    {uncertain && !pending && <div className={styles.pendingNotice} role="status"><p>{t("A previous save is awaiting confirmation. Your draft and request identity are preserved.", "يوجد حفظ ينتظر تأكيد النتيجة. ملاحظاتك ومعرّف الطلب محفوظان.")}</p><div><button type="button" onClick={() => { pendingRef.current = true; setPending(true); void checkIntent(uncertain).then(async confirmed => { await refresh(page.current, true); if (!confirmed) setError(t("Result not yet confirmed. Retry uses the same request and cannot create a second decision.", "لم تتأكد النتيجة بعد. تستخدم إعادة المحاولة الطلب نفسه لمنع تكرار القرار.")); }).finally(() => { pendingRef.current = false; setPending(false); }); }}>{t("Check result", "تحقق من النتيجة")}</button><button type="button" onClick={() => { void execute(uncertain, false); }}>{t("Retry same request", "إعادة الطلب نفسه")}</button></div></div>}
    {error && !reviewed && <p role="alert" className={styles.error}>{error}</p>}
    <TaskCanvas items={inbox.items} selectedId={reviewed?.id} segment={segment} onSegmentChange={setSegment} onSelect={select} page={inbox.page} pages={inbox.pages} total={inbox.total} awaitingReview={inbox.summary.awaiting_review} loading={loading} pending={pending} emptyFiltered={Boolean(query || filters.kind || filters.request_type || filters.urgent || filters.payments || filters.sender || filters.status === "resolved")} onRefresh={() => { void refresh(); }} onPageChange={next => { setReviewed(null); void refresh(next); }} filters={
      <details className={styles.toolbar}>
        <summary><span>{t("Filter & sort", "الفرز والتصفية")}</span><span className={styles.filterSummary}>{t("Type · Employee · Priority", "النوع · الموظف · الأولوية")} <span aria-hidden="true">⌄</span></span></summary>
      <div className={styles.filterGrid}>
        <label>{t("Type", "النوع")}<select value={filters.kind} onChange={event => filter({ kind: event.target.value })} disabled={pending}><option value="">{t("All types", "جميع الأنواع")}</option><option value="client">{t("Client files", "ملفات العملاء")}</option><option value="report">{t("Reports", "التقارير")}</option></select></label>
        <label>{t("Intervention", "طبيعة التدخل")}<select value={filters.request_type} onChange={event => filter({ request_type: event.target.value })} disabled={pending}><option value="">{t("All requests", "جميع الطلبات")}</option><option value="review">{t("Operational review", "مراجعة تشغيلية")}</option><option value="duplicate">{t("Duplicate review", "مراجعة التشابه")}</option></select></label>
        <label>{t("Priority", "الأولوية")}<select value={filters.urgent} onChange={event => filter({ urgent: event.target.value })} disabled={pending}><option value="">{t("All priorities", "جميع الأولويات")}</option><option value="1">{t("Urgent only", "العاجل فقط")}</option></select></label>
        <label>{t("Submitted by", "المرسل")}<select value={filters.sender} onChange={event => filter({ sender: event.target.value })} disabled={pending}><option value="">{t("All employees", "جميع الموظفين")}</option>{(inbox.senders ?? activeStaff).map(member => <option key={member.id} value={member.id}>{member.display_name}</option>)}</select></label>
        <label>{t("Sort", "الترتيب")}<select value={filters.sort} onChange={event => filter({ sort: event.target.value })} disabled={pending}><option value="oldest">{t("Oldest first", "الأقدم أولًا")}</option><option value="newest">{t("Newest first", "الأحدث أولًا")}</option><option value="priority">{t("Urgent first", "العاجل أولًا")}</option></select></label>
      </div>
      <div className={styles.filterFooter}><span>{t("Filter within the selected review category", "الفرز داخل تصنيف المراجعة المحدد")}</span><button type="button" onClick={() => { setQuery(""); filter(INITIAL_FILTERS); }} disabled={pending}>{t("Reset filters", "إعادة ضبط الفرز")}</button></div>
      </details>
    }/>
    {reviewed && <SpatialDrawer onClose={() => setReviewed(null)}><section className={styles.review} aria-label={t("Review workspace", "مساحة المراجعة")}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
          <header className={styles.reviewHeading}><div><p>{reviewed.ref || t("MANAGEMENT REPORT", "تقرير إداري")}</p><h2 dir="auto">{reviewed.full_name || reviewed.title}</h2>{duplicate && <span className={styles.duplicateTag}>{t("Similarity reported · manager decision required", "تشابه مُبلّغ عنه · يتطلب قرار المدير")}</span>}</div><Link href={reviewed.source_path} prefetch={false} className={styles.secondary}>{t("Full record", "السجل الكامل")} ↗</Link></header>
          <div className={styles.reviewBody}>
            {reviewed.submitted_note && <blockquote className={styles.submission}><span>{t("Sender's note", "ملاحظة المرسل")}</span><p dir="auto">{reviewed.submitted_note}</p></blockquote>}
            {readOnly && <div className={styles.stamp}><span aria-hidden="true">✓</span><div><strong>{t("Reviewed by manager", "تمت المراجعة من قبل المدير")}</strong><p dir="auto">{reviewed.resolved_by_name ?? "—"} · {dateTime(reviewed.resolved_at)}</p><small>{pretty(reviewed.resolution_action)}{reviewed.destination ? ` · ${pretty(reviewed.destination)}` : ""}</small>{reviewed.resolution_note && <p dir="auto">{reviewed.resolution_note}</p>}</div></div>}
            {duplicate && <p className={styles.reportNotice}>{t("Compare both records and their evidence. A shared phone or similar name alone does not establish a duplicate. Deletion moves only the selected record to deleted files with its reason and history.", "قارن السجلين وأدلتهما. تشابه الاسم أو الهاتف وحده لا يثبت التكرار. ينقل الحذف السجل المحدد فقط إلى المحذوفات مع سببه وتاريخه.")}</p>}
            <div className={duplicate ? styles.comparison : undefined}>
              <section>{duplicate && <h3 className={styles.comparisonTitle}>{t("Submitted file", "الملف المُرسل")}</h3>}{reviewed.client_id ? <ClientReview key={`${reviewed.id}:${reviewed.client_version}`} clientId={reviewed.client_id} version={reviewed.client_version} /> : <ReportReview item={reviewed} />}</section>
              {duplicate && <section>{reviewed.related_client_id ? <><h3 className={styles.comparisonTitle}>{t("Similar record", "السجل المشابه")}</h3><Link className={styles.relatedRecord} href={`/staff/client/${reviewed.related_client_id}`} prefetch={false}><strong dir="auto">{reviewed.related_client?.full_name ?? t("Open similar file", "فتح الملف المشابه")}</strong><small>{reviewed.related_client?.ref} ↗</small></Link><ClientReview key={reviewed.related_client_id} clientId={reviewed.related_client_id} version={null} /></> : <p className={styles.error}>{t("The related file is unavailable. Deletion requires a verified file selection.", "الملف المرتبط غير متاح. يتطلب الحذف تحديد ملف متحقق منه.")}</p>}</section>}
            </div>
          </div>
          {!readOnly && <form className={styles.routing} onSubmit={event => { event.preventDefault(); decide("approve"); }}>
            {changed && <p className={styles.error}>{t("The file changed during review. Your draft is preserved.", "تغير الملف أثناء المراجعة. مسودتك محفوظة.")} <button type="button" onClick={() => { if (currentItem) select(currentItem); }}>{t("Review latest", "مراجعة آخر تحديث")}</button></p>}
            <label>{t("Manager note (optional)", "ملاحظة المدير (اختياري)")}<textarea value={draft.note} onChange={event => updateDraft({ note: event.target.value })} maxLength={2000} rows={2} disabled={pending || Boolean(uncertain)} dir="auto" /></label>
            <div className={styles.routingFields}><label>{t("Next workflow section", "القسم التالي")}<RoyalSelect inlineOptions aria-label={t("Next workflow section", "القسم التالي")} value={draft.destination} onChange={event => updateDraft({ destination: String(event.target.value) })} disabled={blocked}>
              <RoyalOption value="keep_current">{t("Approve without moving", "اعتماد دون نقل")}</RoyalOption>{CLIENT_STAGES.map(stage => <RoyalOption key={stage.id} value={stage.id}>{language === "ar" ? stage.labelAr : stage.label}</RoyalOption>)}
            </RoyalSelect></label>{reviewed.client_id && <label>{t("Assign to employee", "تعيين لموظف")}<select value={draft.assignedStaffId} onChange={event => updateDraft({ assignedStaffId: event.target.value })} disabled={blocked}><option value="">{t("Keep current assignment", "الإبقاء على الموظف الحالي")}</option>{activeStaff.map(member => <option key={member.id} value={member.id}>{member.display_name}</option>)}</select></label>}</div>
            <div className={styles.routingActions}><button className={styles.primary} disabled={blocked}>{pending ? t("Completing…", "جارٍ الإكمال…") : draft.destination === "keep_current" ? t("Complete review", "إكمال المراجعة") : t("Approve & route", "اعتماد وتوجيه")} <span aria-hidden="true">↗</span></button>{reviewed.client_id && <button type="button" className={styles.secondary} disabled={blocked} onClick={() => decide("return")}>{t("Return to employee", "إرجاع للموظف")} ↩</button>}{duplicate && <button type="button" className={styles.secondary} disabled={blocked} onClick={() => decide("not_duplicate")}>{t("Not a duplicate", "غير مكرر")}</button>}{reviewed.client_id && <button type="button" className={styles.deleteToggle} disabled={blocked} aria-expanded={deleteOpen} onClick={() => setDeleteOpen(value => !value)}>{t("Review deletion", "مراجعة الحذف")}</button>}</div>
            {deleteOpen && <fieldset className={styles.deletion}><legend>{t("Move one file to deleted files", "نقل ملف واحد إلى المحذوفات")}</legend><label>{t("File to delete", "الملف المطلوب حذفه")}<select value={draft.deleteClientId} onChange={event => updateDraft({ deleteClientId: event.target.value })} disabled={blocked}><option value="">{t("Choose a file explicitly", "حدد الملف صراحةً")}</option><option value={reviewed.client_id!}>{reviewed.ref} · {reviewed.full_name ?? reviewed.title}</option>{duplicate && reviewed.related_client_id && <option value={reviewed.related_client_id}>{reviewed.related_client?.ref} · {reviewed.related_client?.full_name ?? t("Related file", "الملف المرتبط")}</option>}</select></label><label>{t("Deletion reason (required)", "سبب الحذف (مطلوب)")}<textarea value={draft.deleteReason} onChange={event => updateDraft({ deleteReason: event.target.value })} maxLength={500} rows={2} disabled={blocked} dir="auto" /></label><button type="button" className={styles.danger} disabled={blocked || !draft.deleteClientId || !draft.deleteReason.trim()} onClick={() => decide("delete")}>{t("Move selected file to deleted files", "نقل الملف المحدد إلى المحذوفات")}</button></fieldset>}
            <p className={styles.guardHint}>{t("Move directly to any workflow section. Your decision and manager review stamp are recorded together.", "انتقل مباشرة إلى أي مرحلة. يُحفظ القرار وختم مراجعة المدير معًا.")}</p>
          </form>}
    </section></SpatialDrawer>}
    {notice && <p className={styles.toast} role="status">✓ {notice}</p>}
  </div>;
}
