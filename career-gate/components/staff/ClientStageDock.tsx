"use client";

import Link from "next/link";
import type { PointerEvent } from "react";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { CLIENT_STAGES, type ClientStageFilter } from "@/lib/client-lifecycle-filters";

function StageIcon({ stage }: { stage: ClientStageFilter }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {stage === "new_intake" ? <><path d="M4 5h16v15H4zM4 12h5l2 3h2l2-3h5" /><path d="M9 8h6" /></> :
      stage === "account_setup" ? <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M19 8v6M16 11h6" /></> :
      stage === "job_ready" ? <><rect x="3" y="7" width="18" height="14" rx="3" /><path d="M8 7V4h8v3M3 12l9 4 9-4M12 14v4" /></> :
      stage === "urgent" ? <path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z" /> :
      stage === "appointments" ? <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 18h2" /></> :
      stage === "payment_required" ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h3M15 15h2" /></> :
      stage === "paperwork_pending" ? <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></> :
      <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>}
  </svg>;
}

const descriptions: Record<ClientStageFilter, readonly [string, string]> = {
  new_intake: ["Review incoming files", "مراجعة الملفات الواردة"],
  account_setup: ["Prepare client accounts", "تجهيز حسابات العملاء"],
  job_ready: ["View job-ready files", "عرض الملفات الجاهزة للوظيفة"],
  urgent: ["Open priority files", "فتح ملفات الأولوية"],
  appointments: ["Manage interviews", "إدارة المقابلات"],
  payment_required: ["Follow up payment", "متابعة الدفع"],
  paperwork_pending: ["Complete final documents", "استكمال الوثائق النهائية"],
  completed: ["Review completed files", "عرض الملفات المكتملة"],
};

function moveSpotlight(event: PointerEvent<HTMLAnchorElement>) {
  if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const element = event.currentTarget;
  const bounds = element.getBoundingClientRect();
  element.style.setProperty("--registry-spot-x", `${event.clientX - bounds.left}px`);
  element.style.setProperty("--registry-spot-y", `${event.clientY - bounds.top}px`);
}

function resetSpotlight(event: PointerEvent<HTMLAnchorElement>) {
  event.currentTarget.style.removeProperty("--registry-spot-x");
  event.currentTarget.style.removeProperty("--registry-spot-y");
}

export function ClientStageDock({ stage, counts }: { stage?: string; counts?: Record<string, number> }) {
  const { t } = useStaffLanguage();
  return <nav aria-label={t("Operational client lifecycle stages", "أقسام مسار عمل العملاء")} className="registry-stage-dock" data-testid="client-stage-dock">
    {CLIENT_STAGES.map(station => {
      const count = counts?.[station.id];
      const description = descriptions[station.id];
      return <Link key={station.id} prefetch={false} href={station.href} aria-current={stage === station.id ? "page" : undefined}
        className={`cg-stage-tab registry-stage-tab ${station.id === "urgent" ? "cg-urgent-tab" : ""}`}
        data-stage={station.id} data-alert={station.id === "urgent" && count != null && count > 0}
        onPointerMove={moveSpotlight} onPointerLeave={resetSpotlight}>
        <span className="registry-stage-top"><span className="registry-stage-icon"><StageIcon stage={station.id}/></span><strong className="registry-stage-count">{count == null ? "—" : count.toLocaleString("en-US")}</strong></span>
        <span className="registry-stage-label">{t(station.label, station.labelAr)}</span>
        <span className="registry-stage-detail">{t(description[0], description[1])}</span>
      </Link>;
    })}
  </nav>;
}
