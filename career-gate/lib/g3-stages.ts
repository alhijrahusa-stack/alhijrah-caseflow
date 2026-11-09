import { STATUSES } from "@/lib/domain";
import { WORKFLOW_GROUPS, workflowGroupForStatus, type WorkflowGroupId } from "@/lib/workflow-registry";

/** Compatibility export: navigation and operational groups share one model. */
export const G3_STAGES = WORKFLOW_GROUPS;
export type G3StageId = WorkflowGroupId;

const classified = G3_STAGES.flatMap(stage => stage.statuses);
if (new Set(classified).size !== STATUSES.filter(status => status !== "cancelled").length) {
  throw new Error("Workflow groups must classify every non-cancelled canonical status exactly once");
}

export const g3StageForStatus = workflowGroupForStatus;

export function g3Counts(statusCounts: readonly { status: string; total: number }[]) {
  return G3_STAGES.map(stage => ({
    ...stage,
    total: statusCounts.reduce((total, item) => total + (g3StageForStatus(item.status) === stage.id ? item.total : 0), 0),
  }));
}
