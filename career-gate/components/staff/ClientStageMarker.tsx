"use client";

import { ACTIVE_WORKFLOW_GROUPS, WORKFLOW_DESTINATIONS, workflowGroupForStatus } from "@/lib/workflow-registry";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import "./client-priority.css";

/** A location marker, not a completion percentage: manual moves can skip or
 * revisit any group without asserting that the preceding work was completed. */
export function ClientStageMarker({ location, status }: { location?: string; status: string }) {
  const { t } = useStaffLanguage();
  const destination = WORKFLOW_DESTINATIONS.find(stage => stage.id === location);
  const groupId = destination?.groupId ?? (!location ? workflowGroupForStatus(status) : null);
  const group = ACTIVE_WORKFLOW_GROUPS.find(stage => stage.id === groupId);
  if (!group) return null;
  return <div className="registry-stage-marker" data-testid="current-workflow-group">
    <span>{t(destination?.label ?? group.label, destination?.labelAr ?? group.labelAr)}</span>
    <ol aria-label={t("Current workflow group", "مجموعة العمل الحالية")}>
      {ACTIVE_WORKFLOW_GROUPS.map(stage => <li key={stage.id} aria-current={stage.id === groupId ? "step" : undefined} data-current={stage.id === groupId} title={t(stage.label, stage.labelAr)}><span className="sr-only">{t(stage.label, stage.labelAr)}</span></li>)}
    </ol>
  </div>;
}
