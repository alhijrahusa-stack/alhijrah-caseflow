"use client";

import Link from "next/link";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import type { ManagerSegment } from "@/components/staff/manager/types";
import { G3_STAGES } from "@/lib/g3-stages";
import styles from "@/components/staff/ManagerTaskCenter.module.css";

function QueueIcon({ kind }: { kind: ManagerSegment }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "urgent" ? <path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z" /> : kind === "payments" ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h3M15 15h2" /></> : kind === "resolved" ? <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></> : <><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M3 12h5l2 3h4l2-3h5M8 8h8" /></>}
  </svg>;
}

export function ManagerSectionRail({ segment, onSegmentChange, awaitingReview, disabled }: {
  segment: ManagerSegment;
  onSegmentChange: (segment: ManagerSegment) => void;
  awaitingReview: number;
  disabled: boolean;
}) {
  const { t, dir } = useStaffLanguage();
  const queues: { id: ManagerSegment; label: string }[] = [
    { id: "action", label: t("Action required", "يتطلب إجراءك") },
    { id: "urgent", label: t("Urgent", "عاجل") },
    { id: "payments", label: t("Payment Required", "الدفع المطلوب") },
    { id: "resolved", label: t("Resolved", "المكتملة") },
  ];
  return <aside className={styles.sectionRail} dir={dir} aria-label={t("Manager section navigation", "أقسام مركز المدير")} data-testid="manager-section-rail">
    <div className={styles.railHeading}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="m12 2 9 10-9 10L3 12 12 2Z"/><path d="m12 7 4.5 5-4.5 5L7.5 12 12 7Z"/></svg><div><small>{t("EXECUTIVE WORKSPACE", "مساحة القيادة")}</small><strong>{t("Your command center", "مركز التحكم")}</strong></div></div>
    <nav aria-label={t("Manager review queues", "قوائم مراجعة المدير")} className={`${styles.railGroup} ${styles.railQueues}`}>
      <p>{t("DECISIONS", "القرارات")}</p>
      {queues.map(queue => <button key={queue.id} type="button" aria-pressed={segment === queue.id} disabled={disabled} onClick={() => onSegmentChange(queue.id)} data-testid={`manager-segment-${queue.id}`} data-tone={queue.id}>
        <QueueIcon kind={queue.id} /><span>{queue.label}</span>{queue.id === "action" && <b>{awaitingReview}</b>}
      </button>)}
    </nav>
    <nav aria-label={t("Workflow sections", "أقسام مسار العمل")} className={styles.railGroup}>
      <p>{t("WORKFLOW", "مسار العمل")}</p>
      <Link href="/staff/import" prefetch={false}><svg className={styles.railSparkle} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></svg><span>{t("Smart Client", "الاستقبال الذكي")}</span><span className={styles.railArrow} aria-hidden="true">↗</span></Link>
      {G3_STAGES.map((stage, index) => <Link key={stage.id} href={index === 0 ? "/staff/clients" : stage.href} prefetch={false}><span className={styles.railStep} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span>{index === 0 ? t("Clients", "العملاء") : t(stage.label, stage.labelAr)}</span><span className={styles.railArrow} aria-hidden="true">↗</span></Link>)}
    </nav>
    <Link href="/staff" className={styles.railDashboard} prefetch={false}><span>{t("Operations dashboard", "لوحة العمليات")}</span><span aria-hidden="true">↗</span></Link>
  </aside>;
}
