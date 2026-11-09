import { PRIORITY_VIEW, WORKFLOW_DESTINATIONS, isWorkflowDestination, workflowDestination, type WorkflowDestination } from "@/lib/workflow-registry";

export const CLIENT_STAGES = WORKFLOW_DESTINATIONS;
export { isWorkflowDestination } from "@/lib/workflow-registry";
export type { WorkflowDestination } from "@/lib/workflow-registry";

/** `urgent` is read compatibility for old filters, never a new destination. */
export type ClientStageFilter = WorkflowDestination | "urgent";
export const CLIENT_STAGE_IDS: readonly string[] = [...CLIENT_STAGES.map(stage => stage.id), PRIORITY_VIEW.id];

export function isClientStageFilter(value: unknown): value is ClientStageFilter {
  return value === "urgent" || isWorkflowDestination(value);
}

export const ACCOUNT_SETUP_STATUSES = workflowDestination("account_setup").statuses;
export const JOB_READY_STATUSES = workflowDestination("job_ready").statuses;
export const PAPERWORK_STATUSES = workflowDestination("paperwork_pending").statuses;

export const BULK_STAGE_LABELS: Record<ClientStageFilter, string> = Object.fromEntries(
  [...CLIENT_STAGES.map(stage => [stage.id, stage.label]), [PRIORITY_VIEW.id, PRIORITY_VIEW.label]]
) as Record<ClientStageFilter, string>;
