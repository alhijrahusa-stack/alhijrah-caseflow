"use client";

import { useRef, useState } from "react";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { ImportComparisonCard } from "@/components/staff/ImportDuplicateCenter";
import { publishMutation } from "@/components/staff/realtime/update-bus";
import { IMPORT_REVIEW_REASONS, type ImportComparison } from "@/lib/import-duplicate-contract";
import type { ManagerInboxItem } from "@/lib/manager-inbox";
import { dateTime } from "@/lib/format";
import styles from "./ImportDuplicateCenter.module.css";

export function ImportManagerReview({ item, onResolved }: { item: ManagerInboxItem; onResolved: () => void }) {
  const { t } = useStaffLanguage();
  const comparison = item.snapshot as unknown as ImportComparison;
  const [selectedKey, setSelectedKey] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const busyRef = useRef(false), retry = useRef<{ signature: string; operationId: string } | null>(null);
  if (!comparison.source?.id) return <p className={styles.error} role="alert">{t("The saved comparison is unavailable. No deletion can be approved.", "المقارنة المحفوظة غير متاحة؛ لا يمكن اعتماد الحذف.")}</p>;
  const target = comparison.selected_target ?? null;
  const records = [comparison.source, ...(target ? [target] : [])];
  const selected = records.find(record => `${record.kind}:${record.id}` === selectedKey);
  const reason = IMPORT_REVIEW_REASONS.find(option => option.id === comparison.reason_code);
  const readOnly = item.status === "resolved";
  async function decide(action: "delete" | "return" | "not_duplicate") {
    if (busyRef.current || readOnly || (action === "delete" && !selected)) return;
    busyRef.current = true; setBusy(true); setError("");
    const payload = { id: item.id, destination: "keep_current", action, note: "", ...(action === "delete" && selected ? { delete_record_kind: selected.kind, delete_record_id: selected.id } : {}) };
    const signature = JSON.stringify(payload);
    if (retry.current?.signature !== signature) retry.current = { signature, operationId: crypto.randomUUID() };
    try {
      const response = await fetch("/api/staff/manager-inbox", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, operation_id: retry.current.operationId }) });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? t("Decision not confirmed. Retry uses the same request.", "لم يتأكد القرار. تعيد المحاولة الطلب نفسه."));
      retry.current = null; publishMutation("import_manager_review_resolved", null); onResolved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Unable to save the decision", "تعذر حفظ القرار")); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <section className={styles.surface} data-testid="import-manager-review">
    <div className={styles.heading}><div><p className={styles.eyebrow}>{t("IMPORT REVIEW · DECISION READY", "مراجعة الاستيراد · جاهز للقرار")}</p><h3 dir="auto">{comparison.source.full_name}</h3><p className={styles.muted}>{t("Submitted by", "أرسله")} {item.sender_name} · {dateTime(item.submitted_at)}</p></div></div>
    <p className={styles.muted}>{t("Reason", "السبب")}: <strong>{reason ? t(reason.en, reason.ar) : item.submitted_note}</strong></p>
    <ImportComparisonCard comparison={comparison} selected={target} />
    <p className={styles.muted}>{t("This is the server-verified comparison saved with the request. Identity freshness is checked automatically when the decision is saved.", "هذه المقارنة المتحققة من الخادم محفوظة مع الطلب. يتحقق النظام آليًا من ثبات بيانات الهوية عند حفظ القرار.")}</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {readOnly ? <div className={styles.stamp}><strong>{t("Manager decision recorded", "قرار المدير موثق")}</strong><p>{item.resolved_by_name} · {dateTime(item.resolved_at)}</p><p>{item.resolution_action === "delete" ? t("Selected record moved to recoverable trash", "نُقل السجل المحدد إلى السلة القابلة للاستعادة") : t("Returned to Import Queue", "أُعيد إلى قائمة الانتظار")}</p>{item.resolution_target && <p dir="ltr">{records.find(record => record.kind === item.resolution_target?.kind && record.id === item.resolution_target?.id)?.ref ?? item.resolution_target.id}</p>}</div>
      : <div className={styles.footer}><label className={styles.label}>{t("Select exactly one record to move to trash", "حدد سجلًا واحدًا فقط لنقله للسلة")}<select className={styles.select} aria-label={t("Record to delete", "السجل المطلوب حذفه")} value={selectedKey} disabled={busy} onChange={event => setSelectedKey(event.target.value)}><option value="">{t("Choose a record explicitly", "حدد السجل صراحةً")}</option>{records.map(record => <option key={`${record.kind}:${record.id}`} value={`${record.kind}:${record.id}`}>{record.ref} · {record.full_name} · {record.kind === "import" ? t("Import", "استيراد") : t("System record", "سجل النظام")}</option>)}</select></label>
        {selected && <p className={styles.muted}>{t("Only this record will be moved", "سيُنقل هذا السجل فقط")}: <strong dir="auto">{selected.full_name} · {selected.ref}</strong></p>}
        <div className={styles.actions}><button type="button" className={styles.danger} disabled={busy || !selected} onClick={() => void decide("delete")}>{busy ? t("Saving…", "جارٍ الحفظ…") : t("Approve deletion of selected record", "اعتماد حذف السجل المحدد")}</button><button type="button" className={styles.button} disabled={busy} onClick={() => void decide("return")}>{t("Reject deletion & return file", "رفض الحذف وإرجاع الملف")}</button>{target && <button type="button" className={styles.button} disabled={busy} onClick={() => void decide("not_duplicate")}>{t("Not a duplicate", "غير مكرر")}</button>}</div><p className={styles.muted}>{t("Documents and history remain attached. The decision records the manager, time and selected file.", "تبقى الوثائق والسجلات محفوظة. يوثَّق المدير ووقت القرار والملف المحدد.")}</p>
      </div>}
  </section>;
}
