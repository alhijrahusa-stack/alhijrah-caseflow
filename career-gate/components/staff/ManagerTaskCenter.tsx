"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RoyalOption, RoyalSelect } from "@/components/forms/RoyalSelect";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { SecureDocumentDrawer } from "@/components/staff/SecureDocumentDrawer";
import { publishMutation, RECOVERY_EVENT, subscribeResources } from "@/components/staff/realtime/update-bus";
import { MANAGER_INBOX_SURFACE } from "@/components/staff/realtime/surfaces";
import { CLIENT_STAGES } from "@/lib/client-lifecycle-filters";
import { dateTime } from "@/lib/format";
import type { ManagerInboxItem, ManagerInboxPage } from "@/lib/manager-inbox";
import styles from "@/components/staff/ManagerTaskCenter.module.css";

type ReviewData = {
  client?: Record<string, unknown>;
  documents?: { id: string; file_name: string; doc_type: string; status: string }[];
  appointments?: { id: string; appointment_type: string; scheduled_at: string; status: string; outcome?: string | null }[];
  account?: { payment_status: string; balance: number; amount_paid_visible: boolean } | null;
  nextAction?: { title?: string; next_step?: string } | null;
};
const pretty = (value: unknown) => value == null || value === "" ? "—" : String(value).replaceAll("_", " ");

function ClientReview({ item }: { item: ManagerInboxItem }) {
  const { t } = useStaffLanguage();
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    let controller: AbortController | null = null;
    let disposed = false;
    const params = new URLSearchParams({ client_id: item.client_id!, payloads: "client,documents,appointments,account,nextAction" });
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
    // Child evidence can change without touching clients.updated_at. Refresh
    // this pane itself, preserving the manager's note and routing selection.
    const unsubscribe = subscribeResources({ clientId: item.client_id, resources: ["client_identity", "documents", "account", "appointments", "next_action"], onUpdate: load });
    const visible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; controller?.abort(); unsubscribe(); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [item.client_id, item.client_version]);
  if (error) return <p role="alert" className={styles.error}>{error}</p>;
  if (!data) return <p role="status" className={styles.empty}>{t("Loading authorized client details…", "جارٍ تحميل بيانات العميل المصرح بها…")}</p>;
  return <div className={styles.reviewStack}>
    <dl className={styles.facts}>
      <div><dt>{t("Current status", "الحالة الحالية")}</dt><dd dir="auto">{pretty(data.client?.current_status)}</dd></div>
      <div><dt>{t("Assigned specialist", "الموظف المختص")}</dt><dd dir="auto">{pretty(data.client?.assigned_name)}</dd></div>
      <div><dt>{t("Next step", "الخطوة التالية")}</dt><dd dir="auto">{pretty(data.client?.next_step)}</dd></div>
      <div><dt>{t("Verified ledger", "الدفتر المالي")}</dt><dd>{data.account ? `${pretty(data.account.payment_status)}${data.account.amount_paid_visible ? ` · $${Number(data.account.balance).toFixed(2)}` : ""}` : t("No account", "لا يوجد حساب")}</dd></div>
    </dl>
    <section className={styles.documentSection}><h3>{t("Documents", "الوثائق")} <span>{data.documents?.length ?? 0}</span></h3>
      {!data.documents?.length ? <p className={styles.muted}>{t("No documents uploaded", "لم تُرفع وثائق")}</p> : <ul className={styles.documentList}>{data.documents.map(doc => <li key={doc.id}>
        <button type="button" onClick={() => setPreview({ id: doc.id, name: doc.file_name || doc.doc_type })}><span><strong dir="auto">{doc.file_name || pretty(doc.doc_type)}</strong><small>{pretty(doc.status)}</small></span><span aria-hidden="true">↗</span><span className="sr-only">{t("Open document", "فتح الوثيقة")}</span></button>
      </li>)}</ul>}
    </section>
    {!!data.appointments?.length && <section className={styles.documentSection}><h3>{t("Appointments & outcomes", "المواعيد والنتائج")}</h3><ul className={styles.appointments}>{data.appointments.map(appointment => <li key={appointment.id}><strong>{appointment.appointment_type}</strong><time>{dateTime(appointment.scheduled_at)}</time><span>{pretty(appointment.status)} · {appointment.outcome ? pretty(appointment.outcome) : t("No recorded outcome", "لا توجد نتيجة مسجلة")}</span></li>)}</ul></section>}
    {preview && <SecureDocumentDrawer documentId={preview.id} name={preview.name} onClose={() => setPreview(null)} />}
  </div>;
}

function ReportReview({ item }: { item: ManagerInboxItem }) {
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

export function ManagerTaskCenter({ initial }: { initial: ManagerInboxPage }) {
  const { t, language } = useStaffLanguage();
  const [inbox, setInbox] = useState(initial);
  const [reviewed, setReviewed] = useState<ManagerInboxItem | null>(initial.items[0] ?? null);
  const [destination, setDestination] = useState("keep_current");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stale, setStale] = useState(false);
  const page = useRef(initial.page);
  const fetchSequence = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const drafts = useRef(new Map<string, { note: string; destination: string }>());
  const refresh = useCallback(async (nextPage = page.current) => {
    const sequence = ++fetchSequence.current;
    controllerRef.current?.abort();
    const controller = new AbortController(); controllerRef.current = controller;
    try {
      const response = await fetch(`${MANAGER_INBOX_SURFACE.endpoint}?page=${nextPage}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "Inbox is unavailable");
      if (sequence !== fetchSequence.current || controller.signal.aborted) return;
      page.current = result.inbox.page; setInbox(result.inbox); setStale(false);
      setReviewed(current => current && result.inbox.items.some((item: ManagerInboxItem) => item.id === current.id) ? current : null);
    } catch { if (!controller.signal.aborted) setStale(true); }
  }, []);
  useEffect(() => {
    const unsubscribe = subscribeResources({ clientId: null, resources: [...MANAGER_INBOX_SURFACE.resources, "client_identity"], onUpdate: () => { void refresh(); } });
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", visible); window.addEventListener(RECOVERY_EVENT, visible); document.addEventListener("visibilitychange", visible);
    return () => { unsubscribe(); controllerRef.current?.abort(); window.removeEventListener("focus", visible); window.removeEventListener(RECOVERY_EVENT, visible); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 5500); return () => clearTimeout(timer); }, [notice]);
  const select = (item: ManagerInboxItem) => {
    if (pending) return;
    if (reviewed) drafts.current.set(reviewed.id, { note, destination });
    const draft = drafts.current.get(item.id);
    setReviewed(item); setDestination(draft?.destination ?? "keep_current"); setNote(draft?.note ?? ""); setError("");
  };
  async function resolve() {
    if (!reviewed || pending) return;
    const item = reviewed;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/staff/manager-inbox", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, destination, note, expected_client_version: item.client_version }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "The review could not be completed");
      setInbox(current => ({ ...current, items: current.items.filter(row => row.id !== item.id), total: Math.max(0, current.total - 1) }));
      drafts.current.delete(item.id);
      setReviewed(null); setNote(""); setDestination("keep_current");
      const stage = CLIENT_STAGES.find(row => row.id === destination);
      setNotice(result.already_resolved ? t("Another manager already completed this review", "أكمل مدير آخر هذه المراجعة بالفعل") : result.task_id ? t("Report approved and follow-up task created", "تم اعتماد التقرير وإنشاء مهمة متابعة") : stage ? `${t("Approved and routed to", "تم الاعتماد والتوجيه إلى")} ${language === "ar" ? stage.labelAr : stage.label}` : t("Review approved; client remains in its current stage", "تم اعتماد المراجعة مع إبقاء العميل في مرحلته الحالية"));
      publishMutation("manager_review_resolved", item.client_id);
      void refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Connection failed", "تعذر الاتصال")); }
    finally { setPending(false); }
  }
  const currentItem = inbox.items.find(item => item.id === reviewed?.id);
  const changed = reviewed?.client_id && currentItem?.client_version !== reviewed.client_version;
  return <div className={styles.center} data-testid="manager-task-center">
    <header className={styles.hero}><div><p>CAREER GATE · EXECUTIVE REVIEW</p><h1>{t("Manager's Task Center", "مركز مهام المدير")}</h1><span>{t("Review, decide and route in one workspace", "مراجعة واعتماد وتوجيه من مساحة واحدة")}</span></div><b>{inbox.total} {t("awaiting review", "بانتظار المراجعة")}</b></header>
    {stale && <div className={styles.error} role="status">{t("Live inbox could not be refreshed.", "تعذر تحديث صندوق الوارد.")} <button type="button" className="ops-secondary-button" onClick={() => { void refresh(); }}>{t("Retry", "إعادة المحاولة")}</button></div>}
    <div className={styles.split}>
      <aside className={styles.inbox} aria-label={t("Incoming reviews", "المراجعات الواردة")}>
        <div className={styles.inboxHeading}><h2>{t("Inbox", "الوارد")}</h2><button type="button" className={styles.refresh} onClick={() => { void refresh(); }} aria-label={t("Refresh inbox", "تحديث الوارد")}>↻</button></div>
        {!inbox.items.length ? <div className={styles.empty}><span aria-hidden="true">✓</span><h3>{t("You're up to date", "اكتملت المراجعات")}</h3><p>{t("Files and reports sent by staff will appear here.", "ستظهر هنا الملفات والتقارير التي يرسلها الموظفون.")}</p></div> : <ul className={styles.inboxList}>{inbox.items.map(item => <li key={item.id}><button type="button" aria-pressed={reviewed?.id === item.id} onClick={() => select(item)} disabled={pending} className={styles.item}>
          <span className={styles.kind}>{item.kind === "client" ? t("Client file", "ملف عميل") : t("Report", "تقرير")}<span aria-hidden="true">↗</span></span><strong dir="auto">{item.title}</strong><span className={styles.sender} dir="auto">{item.sender_name}</span><time>{dateTime(item.submitted_at)}</time>
        </button></li>)}</ul>}
        <nav className={styles.pager} aria-label={t("Inbox pages", "صفحات الوارد")}><button type="button" disabled={inbox.page <= 1 || pending} onClick={() => { setReviewed(null); void refresh(inbox.page - 1); }}>{t("Previous", "السابق")}</button><span>{inbox.page} / {inbox.pages}</span><button type="button" disabled={inbox.page >= inbox.pages || pending} onClick={() => { setReviewed(null); void refresh(inbox.page + 1); }}>{t("Next", "التالي")}</button></nav>
      </aside>
      <section className={styles.review} aria-label={t("Review workspace", "مساحة المراجعة")}>
        {!reviewed ? <div className={styles.empty}><span aria-hidden="true">◈</span><h2>{t("Choose a review", "اختر مراجعة")}</h2><p>{t("Select an incoming item to inspect its details and choose the next action.", "اختر ملفاً من الوارد لمراجعة التفاصيل وتحديد الإجراء التالي.")}</p></div> : <>
          <header className={styles.reviewHeading}><div><p>{reviewed.ref || t("MANAGEMENT REPORT", "تقرير إداري")}</p><h2 dir="auto">{reviewed.full_name || reviewed.title}</h2></div><Link href={reviewed.source_path} prefetch={false} className="ops-secondary-button">{t("Full record", "السجل الكامل")} ↗</Link></header>
          <div className={styles.reviewBody}>
            {reviewed.submitted_note && <blockquote className={styles.submission}><span>{t("Sender's note", "ملاحظة المرسل")}</span><p dir="auto">{reviewed.submitted_note}</p></blockquote>}
            {reviewed.client_id ? <ClientReview key={`${reviewed.id}:${reviewed.client_version}`} item={reviewed} /> : <ReportReview item={reviewed} />}
          </div>
          <form className={styles.routing} onSubmit={event => { event.preventDefault(); void resolve(); }}>
            {changed && <p className={styles.error}>{t("The file changed during review.", "تغير الملف أثناء المراجعة.")} <button type="button" className="ops-secondary-button" onClick={() => { if (currentItem) select(currentItem); }}>{t("Review latest", "مراجعة آخر تحديث")}</button></p>}
            {error && <p role="alert" className={styles.error}>{error}</p>}
            <label>{t("Manager note (optional)", "ملاحظة المدير (اختياري)")}<textarea className="input" value={note} onChange={event => setNote(event.target.value)} maxLength={2000} rows={2} disabled={pending} dir="auto" /></label>
            <div className={styles.routingActions}><label>{t("Next workflow section", "القسم التالي")}<RoyalSelect aria-label={t("Next workflow section", "القسم التالي")} value={destination} onChange={event => setDestination(String(event.target.value))} className="input" disabled={pending}>
              <RoyalOption value="keep_current">{t("Approve without moving", "اعتماد دون نقل")}</RoyalOption>{CLIENT_STAGES.map(stage => <RoyalOption key={stage.id} value={stage.id}>{language === "ar" ? stage.labelAr : stage.label}</RoyalOption>)}
            </RoyalSelect></label><button className="ops-primary-button" disabled={pending || Boolean(changed)}>{pending ? t("Completing…", "جارٍ الإكمال…") : destination === "keep_current" ? t("Complete review", "إكمال المراجعة") : t("Approve & route", "اعتماد وتوجيه")} <span aria-hidden="true">↗</span></button></div>
            <p className={styles.guardHint}>{t("Routing checks actual account, interview, document and payment evidence before changing the client state.", "يتحقق التوجيه من أدلة الحساب والمقابلة والوثائق والسداد قبل تغيير حالة العميل.")}</p>
          </form>
        </>}
      </section>
    </div>
    {notice && <p className={styles.toast} role="status">✓ {notice}</p>}
  </div>;
}
