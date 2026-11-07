import "server-only";
import type { StaffSession, Tx } from "@/lib/auth";
import type { ClientStageFilter } from "@/lib/client-lifecycle-filters";
import { resolveOverrideRoute } from "@/lib/client-lifecycle-routing";

type WorkflowClient = { id: string; current_status: string; pipeline_stage: string; next_step: string };

/** Caller holds the client lock inside withStaff; RLS retains the staff's client scope. */
export async function moveWorkflowClient(tx: Tx, session: StaffSession, client: WorkflowClient, destination: ClientStageFilter, note: string | undefined, traceId: string, metadata: Record<string, unknown> = {}) {
  const route = resolveOverrideRoute(destination, client.current_status);
  if (client.current_status === route.status && client.pipeline_stage === route.pipelineStage) return false;
  const reason = note?.trim() || "Direct workflow move";
  const [prior] = await tx`select current_setting('cg.status_override',true) status_override, current_setting('cg.workflow_route',true) workflow_route`;
  await tx`select set_config('cg.status_override',${reason},true),set_config('cg.workflow_route','direct',true)`;
  await tx`update clients set current_status=${route.status},pipeline_stage=${route.pipelineStage},next_step=${route.nextStep} where id=${client.id}`;
  await tx`select set_config('cg.status_override',${prior.status_override ?? ""},true),set_config('cg.workflow_route',${prior.workflow_route ?? ""},true)`;
  await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
    values(${client.id},'status_overridden',${session.staff.id},'client',${client.id},
      ${tx.json({ status: client.current_status, pipeline_stage: client.pipeline_stage })},
      ${tx.json({ status: route.status, pipeline_stage: route.pipelineStage, target_stage: destination, reason, skipped_prerequisites: true, operation: "manual_workflow_routed", ...metadata })},${traceId})`;
  return true;
}
