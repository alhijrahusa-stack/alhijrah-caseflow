"use client";

import type { ReactNode } from "react";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { dateTime } from "@/lib/format";
import type { ManagerReviewItem, ManagerSegment } from "@/components/staff/manager/types";
import styles from "@/components/staff/ManagerTaskCenter.module.css";

export function TaskCanvas({ items, selectedId, segment, onSegmentChange, onSelect, filters, page, pages, total, awaitingReview, loading, pending, emptyFiltered, onRefresh, onPageChange }: {
  items: ManagerReviewItem[];
  selectedId?: string;
  segment: ManagerSegment;
  onSegmentChange: (segment: ManagerSegment) => void;
  onSelect: (item: ManagerReviewItem) => void;
  filters: ReactNode;
  page: number;
  pages: number;
  total: number;
  awaitingReview: number;
  loading: boolean;
  pending: boolean;
  emptyFiltered: boolean;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
}) {
  const { t } = useStaffLanguage();
  const segments: { id: ManagerSegment; label: string }[] = [{id:"action",label:t("Action required","يتطلب إجراءك")},{id:"urgent",label:t("Urgent","عاجل")},{id:"payments",label:t("Payment issues","مشاكل الدفع")},{id:"resolved",label:t("Resolved","المكتملة")}];
  return <section className={styles.taskCanvas} aria-label={t("Incoming reviews", "المراجعات الواردة")} data-testid="manager-task-canvas" aria-busy={loading || pending}>
    <nav className={styles.segmentWrap} aria-label={t("Review categories", "تصنيفات المراجعة")}><div className={styles.statusTabs}><span className={styles.segmentHighlight} aria-hidden="true" style={{insetInlineStart:`calc(4px + (100% - 8px) / 4 * ${segments.findIndex(row=>row.id===segment)})`}}/>{segments.map(row => <button key={row.id} type="button" data-testid={`manager-segment-${row.id}`} aria-pressed={segment === row.id} disabled={pending} onClick={() => onSegmentChange(row.id)}>{row.label}{row.id === "action" && <b>{awaitingReview}</b>}</button>)}</div></nav>
    {filters}
    <div className={styles.inboxHeading}><div><p>{segment === "resolved" ? t("REVIEW HISTORY", "سجل المراجعات") : t("ACTIVE DECISION QUEUE", "قائمة القرارات النشطة")}</p><h2>{segment === "resolved" ? t("Resolved reviews", "المراجعات المكتملة") : segment === "urgent" ? t("Urgent reviews", "المراجعات العاجلة") : segment === "payments" ? t("Payment issues", "مشاكل الدفع") : t("Awaiting your decision", "بانتظار قرارك")}</h2></div><div className={styles.canvasTools}><span role="status">{loading ? t("Updating…", "جارٍ التحديث…") : `${total} ${t("matching reviews", "مراجعة مطابقة")}`}</span><button type="button" className={styles.refresh} disabled={pending || loading} onClick={onRefresh} aria-label={t("Refresh inbox", "تحديث الوارد")}>↻</button></div></div>
    {!items.length ? <div className={styles.empty}><span aria-hidden="true">✓</span><h3>{loading ? t("Updating reviews", "جارٍ تحديث المراجعات") : !emptyFiltered ? t("You're up to date", "اكتملت المراجعات") : t("No matching reviews", "لا توجد مراجعات مطابقة")}</h3><p>{t("Files and reports sent by staff appear here. Try adjusting the filters.", "تظهر هنا الملفات والتقارير المرسلة للمراجعة. يمكنك تعديل خيارات الفرز.")}</p></div> : <ul className={styles.inboxList}>{items.map(item => <li key={item.id}><button type="button" aria-pressed={selectedId === item.id} onClick={() => onSelect(item)} disabled={pending} className={styles.item} data-urgent={item.is_urgent} data-payment={item.is_payment_issue}>
      <span className={styles.kind}>{item.request_type === "duplicate" ? t("Duplicate review", "مراجعة تشابه") : item.kind === "client" ? t("Client file", "ملف عميل") : t("Report", "تقرير")}<span aria-hidden="true">↗</span></span>
      <span className={styles.cardIdentity}><span className={styles.cardAvatar} aria-hidden="true">{(item.full_name || item.title).trim().split(/\s+/).slice(0,2).map(word=>word.charAt(0)).join("")}</span><span><code>{item.ref || t("MANAGEMENT REPORT", "تقرير إداري")}</code><strong dir="auto">{item.full_name || item.title}</strong></span></span>
      <span className={styles.itemTags}>{item.is_urgent && <b>{t("Urgent", "عاجل")}</b>}{item.is_payment_issue && <b data-tone="payments">{t("Payment issue", "مسألة دفع")}</b>}{item.resolved_at && <em>{t("Reviewed", "تمت المراجعة")}</em>}{item.request_type === "duplicate" && <b data-tone="duplicate">{t("Comparison", "مقارنة")}</b>}</span>
      {item.submitted_note && <span className={styles.cardNote} dir="auto">{item.submitted_note}</span>}
      <span className={styles.cardFooter}><span className={styles.sender} dir="auto">{item.sender_name}</span><time>{dateTime(item.submitted_at)}</time></span><span className={styles.cardReview}>{t("Review file", "مراجعة الملف")} <span aria-hidden="true">↗</span></span>
    </button></li>)}</ul>}
    <nav className={styles.pager} aria-label={t("Inbox pages", "صفحات الوارد")}><button type="button" disabled={page <= 1 || pending || loading} onClick={() => onPageChange(page - 1)}>{t("Previous", "السابق")}</button><span>{page} / {pages}</span><button type="button" disabled={page >= pages || pending || loading} onClick={() => onPageChange(page + 1)}>{t("Next", "التالي")}</button></nav>
  </section>;
}
