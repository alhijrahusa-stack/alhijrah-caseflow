"use client";

import Link from "next/link";
import type { PointerEvent } from "react";
import { useWorkspaceActions } from "@/components/staff/WorkspaceSearchProvider";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { LiveWorkflowCount } from "@/components/staff/LiveWorkflowCount";
import { ACTIVE_WORKFLOW_GROUPS, WORKFLOW_DESTINATIONS, type WorkflowGroupId } from "@/lib/workflow-registry";

function StageIcon({ group }: { group: WorkflowGroupId }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {group === "intake" ? <><path d="M4 5h16v15H4zM4 12h5l2 3h2l2-3h5"/><path d="M9 8h6"/></> :
      group === "account" ? <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M19 8v6M16 11h6"/></> :
      group === "job" ? <><rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V4h8v3M3 12l9 4 9-4M12 14v4"/></> :
      group === "appointments" ? <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18M8 14h2M14 14h2M8 18h2"/></> :
      <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3M15 15h2"/></>}
  </svg>;
}
function moveSpotlight(event: PointerEvent<HTMLAnchorElement>) {
  if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const bounds=event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--registry-spot-x",`${event.clientX-bounds.left}px`);
  event.currentTarget.style.setProperty("--registry-spot-y",`${event.clientY-bounds.top}px`);
}
function resetSpotlight(event: PointerEvent<HTMLAnchorElement>) {
  event.currentTarget.style.removeProperty("--registry-spot-x");event.currentTarget.style.removeProperty("--registry-spot-y");
}

/** Only the five active groups live here. The final registry is sidebar-only. */
export function ClientStageDock({ stage, group, counts, urgentCounts }: { stage?: string;group?:string;counts?:Record<string,number>;urgentCounts?:Record<string,number> }) {
  const { t } = useStaffLanguage();
  const { prepareNavigation } = useWorkspaceActions();
  return <nav aria-label={t("Operational client lifecycle stages","أقسام مسار عمل العملاء")} className="registry-stage-dock registry-active-stage-dock" data-testid="client-stage-dock">
    {ACTIVE_WORKFLOW_GROUPS.map(item=>{
      const total=counts ? item.destinations.reduce((sum,id)=>sum+(counts[id]??0),0) : undefined;
      const priority=item.destinations.reduce((sum,id)=>sum+(urgentCounts?.[id]??0),0);
      const current=group===item.id || item.destinations.some(id=>id===stage);
      return <div key={item.id} className="registry-stage-group">
        <Link prefetch={false} href={item.href} onNavigate={()=>prepareNavigation(item.href)} aria-current={current?"page":undefined} className="cg-stage-tab registry-stage-tab" data-stage={item.id} onPointerMove={moveSpotlight} onPointerLeave={resetSpotlight}>
          <span className="registry-stage-top"><span className="registry-stage-icon"><StageIcon group={item.id}/></span><strong className="registry-stage-count"><LiveWorkflowCount value={total}/></strong></span>
          <span className="registry-stage-label">{t(item.label,item.labelAr)}</span>
          {priority>0 && <span className="registry-stage-urgent" aria-label={t(`${priority} urgent in this section`,`${priority} ملفات عاجلة في هذا القسم`)}>✦ {priority}</span>}
        </Link>
        {item.id === "paperwork" && <div className="registry-payment-leaves" aria-label={t("Payment and paperwork sections","أقسام الدفع والوثائق")}>
          {WORKFLOW_DESTINATIONS.filter(destination=>destination.groupId==="paperwork").map(destination=><Link prefetch={false} key={destination.id} href={destination.href} onNavigate={()=>prepareNavigation(destination.href)} aria-current={stage===destination.id?"page":undefined}>{t(destination.label,destination.labelAr)} <span>{counts?.[destination.id]??"—"}</span></Link>)}
        </div>}
      </div>;
    })}
  </nav>;
}
