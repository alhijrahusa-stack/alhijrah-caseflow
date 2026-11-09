"use client";

import { ActionButton } from "@/components/ui/ActionButton";

import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { GlassReviewDialog } from "@/components/staff/smart/GlassReviewDialog";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { publishMutation } from "@/components/staff/realtime/update-bus";
import { dateTime } from "@/lib/format";
import { WORKFLOW_DESTINATIONS } from "@/lib/workflow-registry";
import { IMPORT_REVIEW_REASONS, type ImportComparison, type ImportIdentity, type ImportMatch, type ImportReviewQueue, type ImportReviewReason } from "@/lib/import-duplicate-contract";
import styles from "./ImportDuplicateCenter.module.css";

const API = "/api/staff/import-duplicate-review";
async function responseResult<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${response.status})`);
  return data.result as T;
}
function publishReviewChange() {
  publishMutation("import_manager_review_requested", null);
}

const IdentityCard = memo(function IdentityCard({ record, source = false }: { record: ImportIdentity; source?: boolean }) {
  const { t, language } = useStaffLanguage();
  const department = WORKFLOW_DESTINATIONS.find(item => item.id === record.location);
  const location = record.location === "import_queue" ? t("Import Queue", "قائمة انتظار الاستيراد")
    : record.location === "manager" ? t("Manager's Inbox", "صندوق وارد المدير")
    : department ? (language === "ar" ? department.labelAr : department.label) : record.location;
  return <article className={styles.identity}>
    <p className={styles.eyebrow}>{source ? t("QUEUED FILE", "الملف قيد الاستيراد") : t("MATCHING RECORD", "السجل المطابق")}</p>
    <h4 dir="auto">{record.full_name || t("Name missing", "الاسم غير مسجل")}</h4>
    <dl><div><dt>{t("Phone", "الهاتف")}</dt><dd dir="ltr">{record.phone || "—"}</dd></div>
      <div><dt>{t("File number", "رقم الملف")}</dt><dd dir="ltr">{record.ref}</dd></div>
      <div><dt>{t("Department", "القسم")}</dt><dd>{location}</dd></div>
    </dl>
    <Link href={record.href} target="_blank" rel="noopener noreferrer" prefetch={false}>{t("Open record", "فتح السجل")} ↗</Link>
  </article>;
});

export const ImportComparisonCard = memo(function ImportComparisonCard({ comparison, selected }: { comparison: ImportComparison; selected: ImportMatch | null }) {
  const { t } = useStaffLanguage();
  const level = selected?.level ?? comparison.level;
  const label = level === "exact" ? t("Name & phone match", "تطابق الاسم والهاتف") : level === "partial" ? t("Partial match", "تطابق جزئي")
    : level === "none" ? t("No matching record found", "لم يُعثر على سجل مطابق") : t("Identity data incomplete", "بيانات الهوية غير مكتملة");
  return <section className={styles.result} aria-label={t("Verified comparison", "المقارنة المتحققة")} data-testid="import-comparison" data-level={level}>
    <header className={styles.resultHead}><span className={styles.badge} data-level={level}>{level === "exact" ? "✓" : "◎"} {label}</span><small className={styles.muted}>{t("Checked", "وقت الفحص")} · {dateTime(comparison.checked_at)}</small></header>
    {selected && <div className={styles.signal}><span data-match={selected.name_match}>{t("Name", "الاسم")} · {selected.name_match ? t("matches", "متطابق") : t("different", "مختلف")}</span><span data-match={selected.phone_match}>{t("Phone", "الهاتف")} · {selected.phone_match ? t("matches", "متطابق") : t("different", "مختلف")}</span></div>}
    <div className={styles.pair}><IdentityCard record={comparison.source} source />{selected ? <IdentityCard record={selected} /> : <div className={styles.identity}><p className={styles.muted}>{level === "insufficient" ? t("Complete the missing name or phone before treating the check as conclusive.", "يلزم استكمال الاسم أو الهاتف الناقص قبل اعتبار الفحص مكتملًا.") : t("The search completed against active system records and other queued imports. No matching name or phone was found.", "اكتمل البحث في سجلات النظام وملفات الاستيراد النشطة، ولم يُعثر على اسم أو هاتف مطابق.")}</p></div>}</div>
    <p className={styles.muted}>{t("The result compares saved names and phone numbers. The employee and manager decide whether the records belong to the same person.", "النتيجة تقارن الاسم والهاتف المحفوظين؛ ويقرر الموظف والمدير إن كان السجلان للشخص نفسه.")}</p>
  </section>;
});

function DuplicateWorkspace({ initialCaseId, onSubmitted }: { initialCaseId?: string; onSubmitted: () => void }) {
  const { t } = useStaffLanguage();
  const [query, setQuery] = useState("");
  const [queue, setQueue] = useState<ImportReviewQueue>({ rows: [], total: 0, page: 1, page_size: 50 });
  const [selectedId, setSelectedId] = useState(initialCaseId ?? "");
  const [comparison, setComparison] = useState<ImportComparison | null>(null);
  const [targetKey, setTargetKey] = useState("");
  const [reason, setReason] = useState<ImportReviewReason>("manager_review");
  const [queueBusy, setQueueBusy] = useState(true), [scanBusy, setScanBusy] = useState(false), [sending, setSending] = useState(false);
  const [queueError, setQueueError] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const queueRequest = useRef(0), scanRequest = useRef(0), busy = useRef(false);
  const retry = useRef<{ signature: string; operationId: string } | null>(null);
  const loadQueue = useCallback(async (page = 1, append = false) => {
    const request = ++queueRequest.current;
    setQueueBusy(true); setQueueError("");
    try {
      const result = await responseResult<ImportReviewQueue>(await fetch(`${API}?${new URLSearchParams({ q: query, page: String(page) })}`, { cache: "no-store" }));
      if (request === queueRequest.current) setQueue(previous => ({ ...result, rows: append ? [...previous.rows, ...result.rows.filter(row => !previous.rows.some(old => old.id === row.id))] : result.rows }));
    } catch (cause) { if (request === queueRequest.current) setQueueError(cause instanceof Error ? cause.message : t("Search failed", "تعذر البحث")); }
    finally { if (request === queueRequest.current) setQueueBusy(false); }
  }, [query, t]);
  const invalidateQueue = useCallback(() => { queueRequest.current++; }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadQueue(), 180); return () => { window.clearTimeout(timer); invalidateQueue(); }; }, [loadQueue, invalidateQueue]);
  useEffect(() => () => { scanRequest.current++; }, []);
  const scan = useCallback(async (id: string) => {
    const request = ++scanRequest.current;
    setComparison(null); setTargetKey(""); setReason("manager_review"); setError(""); setNotice(""); setScanBusy(true);
    try {
      const result = await responseResult<ImportComparison>(await fetch(`${API}?${new URLSearchParams({ mode: "scan", case_id: id })}`, { cache: "no-store" }));
      if (request !== scanRequest.current) return;
      setComparison(result);
      const first = result.matches[0];
      if (first) { setTargetKey(`${first.kind}:${first.id}`); setReason(first.level === "exact" ? "exact_duplicate" : "possible_duplicate"); }
    } catch (cause) { if (request === scanRequest.current) setError(cause instanceof Error ? cause.message : t("The check failed. No result is confirmed.", "تعذر الفحص؛ لا توجد نتيجة متحققة.")); }
    finally { if (request === scanRequest.current) setScanBusy(false); }
  }, [t]);
  useEffect(() => { if (!initialCaseId) return; const timer = window.setTimeout(() => void scan(initialCaseId), 0); return () => window.clearTimeout(timer); }, [initialCaseId, scan]);
  const target = comparison?.matches.find(record => `${record.kind}:${record.id}` === targetKey) ?? null;
  const source = comparison?.source ?? queue.rows.find(row => row.id === selectedId);
  async function submit() {
    if (busy.current || !comparison || comparison.source.held) return;
    busy.current = true; setSending(true); setError("");
    const payload = { action: "submit", case_id: comparison.source.id, fingerprint: comparison.fingerprint, reason, ...(target ? { target_kind: target.kind, target_id: target.id } : {}) };
    const signature = JSON.stringify(payload);
    if (retry.current?.signature !== signature) retry.current = { signature, operationId: crypto.randomUUID() };
    try {
      await responseResult(await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, operation_id: retry.current.operationId }) }));
      retry.current = null; scanRequest.current++; setComparison(null); setSelectedId(""); setNotice(t("Sent to the manager with the saved comparison and selected reason.", "تم التحويل للمدير مع المقارنة المحفوظة والسبب المحدد."));
      publishReviewChange(); onSubmitted(); void loadQueue();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Sending failed. Retry uses the same request.", "تعذر الإرسال. تعيد المحاولة الطلب نفسه.")); }
    finally { busy.current = false; setSending(false); }
  }
  return <div className={styles.workspace} data-testid="import-duplicate-workspace">
    <aside className={styles.selector} aria-label={t("All queued clients", "جميع عملاء قائمة الانتظار")}><div className={styles.selectorHeader}><strong>{t("All queued clients", "جميع عملاء الانتظار")}</strong><span className={styles.count}>{queue.total}</span></div>
      <input autoComplete="off" className={styles.input} aria-label={t("Search all queued clients", "البحث في جميع عملاء الانتظار")} placeholder={t("Name, phone or file number…", "الاسم أو الهاتف أو رقم الملف…")} value={query} onChange={event => setQuery(event.target.value)} disabled={sending} />
      {queueError && <div className={styles.error} role="alert">{queueError}<ActionButton type="button" className={styles.button} onClick={() => loadQueue()}>{t("Retry", "إعادة المحاولة")}</ActionButton></div>}
      <div className={styles.list} aria-busy={queueBusy}>{queue.rows.map(row => <ActionButton key={row.id} type="button" className={styles.row} aria-pressed={selectedId === row.id} disabled={sending || queueBusy} onClick={() => { setSelectedId(row.id); return scan(row.id); }}><strong dir="auto">{row.full_name || t("Name missing", "الاسم غير مسجل")}</strong><small dir="auto">{row.phone || "—"} · {row.ref}</small></ActionButton>)}</div>
      {queueBusy && <p className={styles.muted} role="status">{t("Loading clients…", "جارٍ تحميل العملاء…")}</p>}
      {!queueBusy && !queueError && !queue.rows.length && <p className={styles.muted}>{t("No queued clients match this search.", "لا توجد ملفات انتظار تطابق البحث.")}</p>}
      {queue.rows.length < queue.total && <ActionButton type="button" className={styles.button} disabled={queueBusy || sending} onClick={() => loadQueue(queue.page + 1, true)}>{t("Load more clients", "عرض المزيد من العملاء")} · {queue.rows.length}/{queue.total}</ActionButton>}
    </aside>
    <div className={styles.main} aria-busy={scanBusy || sending}>
      {notice && <p className={styles.success} role="status">✓ {notice}</p>}
      {selectedId ? <><div className={styles.heading}><div><p className={styles.eyebrow}>{t("DUPLICATE REVIEW · DIRECT HANDOFF", "مراجعة التكرار · تحويل مباشر")}</p><h3 dir="auto">{source?.full_name || t("Selected client", "العميل المحدد")}</h3></div><div className={styles.actions}><ActionButton type="button" className={styles.button} disabled={scanBusy || sending} onClick={() => scan(selectedId)}>{scanBusy ? t("Checking…", "جارٍ الفحص…") : t("Check duplicates", "فحص التكرار")}</ActionButton><ActionButton type="button" className={styles.primary} disabled={!comparison || scanBusy || sending || Boolean(comparison?.source.held)} onClick={() => submit()}>{sending ? t("Sending…", "جارٍ الإرسال…") : t("Send to manager", "تحويل للمدير")} ↗</ActionButton></div></div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {scanBusy && <div className={styles.empty} role="status">{t("Checking saved names and phone numbers against live system records…", "جارٍ مقارنة الاسم والهاتف المحفوظين بسجلات النظام الفعلية…")}</div>}
        {comparison && <>{comparison.matches.length > 1 && <label className={styles.label}>{t("Matching records", "السجلات المطابقة")} · {comparison.match_count}<select className={styles.select} aria-label={t("Choose matching record", "اختيار السجل المطابق")} value={targetKey} disabled={sending} onChange={event => { setTargetKey(event.target.value); const match = comparison.matches.find(record => `${record.kind}:${record.id}` === event.target.value); setReason(match?.level === "exact" ? "exact_duplicate" : "possible_duplicate"); }}>{comparison.matches.map(record => <option key={`${record.kind}:${record.id}`} value={`${record.kind}:${record.id}`}>{record.full_name} · {record.ref} · {record.level === "exact" ? t("Name & phone", "الاسم والهاتف") : t("Partial", "جزئي")}</option>)}</select></label>}
          <ImportComparisonCard comparison={comparison} selected={target} />
          <div className={styles.footer}><label className={styles.label}>{t("Reason for manager handoff", "سبب التحويل للمدير")}<select className={styles.select} aria-label={t("Handoff reason", "سبب التحويل")} value={reason} disabled={sending} onChange={event => setReason(event.target.value as ImportReviewReason)}>{IMPORT_REVIEW_REASONS.filter(option => option.id !== "exact_duplicate" || target?.level === "exact").filter(option => option.id !== "possible_duplicate" || target).map(option => <option key={option.id} value={option.id}>{t(option.en, option.ar)}</option>)}</select></label><p className={styles.muted}>{t("The original queued file, selected comparison and reason reach the manager together. Deletion requires the manager to select one record.", "يصل ملف الانتظار نفسه والمقارنة والسبب إلى المدير معًا. يتطلب الحذف تحديد المدير لسجل واحد.")}</p></div>
        </>}
      </> : <div className={styles.empty}>{t("Choose a client to check duplicates and send the file directly to the manager.", "اختر عميلًا لفحص التكرار وتحويل الملف مباشرة للمدير.")}</div>}
    </div>
  </div>;
}

export function ImportDuplicateCenter({ initialCaseId, initialOpen = false, disabled = false, compact = false, onSubmitted }: { initialCaseId?: string; initialOpen?: boolean; disabled?: boolean; compact?: boolean; onSubmitted?: () => void }) {
  const { t } = useStaffLanguage();
  const [open, setOpen] = useState(initialOpen), [notice, setNotice] = useState("");
  const submitted = useCallback(() => { setNotice(t("File sent to the manager with its verified comparison.", "تم تحويل الملف للمدير مع نتيجة المقارنة المتحققة.")); onSubmitted?.(); }, [onSubmitted, t]);
  return <><ActionButton type="button" className={compact ? `${styles.surface} ${styles.button}` : styles.launch} disabled={disabled} onClick={() => { setNotice(""); setOpen(true); }} data-testid={compact ? "review-duplicate-launcher" : "import-duplicate-launcher"}>{compact ? t("Duplicates & manager", "التكرار والمدير") : <><span className={styles.icon} aria-hidden="true">◎</span><span style={{ flex: 1 }}><strong>{t("Duplicate review & manager handoff", "فحص التكرار والتحويل للمدير")}</strong><small>{t("All queued clients · live comparison · ready reasons", "جميع عملاء الانتظار · مقارنة فعلية · أسباب جاهزة")}</small></span><span aria-hidden="true">↗</span></>}</ActionButton>
    {notice && !open && <p className={styles.success} role="status">✓ {notice}</p>}
    {open && <GlassReviewDialog title={t("Duplicate Review & Manager Handoff", "فحص التكرار والتحويل للمدير")} className={styles.dialog} wide onClose={() => setOpen(false)}><DuplicateWorkspace initialCaseId={initialCaseId} onSubmitted={submitted} /></GlassReviewDialog>}
  </>;
}
