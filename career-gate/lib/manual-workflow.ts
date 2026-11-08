import "server-only";
import type { StaffSession, Tx } from "@/lib/auth";
import type { ClientStageFilter } from "@/lib/client-lifecycle-filters";
import { resolveOverrideRoute } from "@/lib/client-lifecycle-routing";
import { ensurePendingWorksiteChange } from "@/lib/worksite-changes";

type WorkflowClient = { id: string; current_status: string; pipeline_stage: string; next_step: string; is_urgent?: boolean };

/** Caller holds the client lock inside withStaff; RLS retains the staff's client scope. */
export async function moveWorkflowClient(tx: Tx, session: StaffSession, client: WorkflowClient, destination: ClientStageFilter, note: string | undefined, traceId: string, metadata: Record<string, unknown> = {}) {
  const [state]=await tx`select manager_review_id,is_urgent from clients where id=${client.id}`;
  if(state?.manager_review_id){const {ActionError}=await import('@/lib/service');throw new ActionError('manager_review_pending','This file is awaiting a manager decision',409);}
  if(destination==='urgent'){
    if(['completed','cancelled'].includes(client.current_status)){const {ActionError}=await import('@/lib/service');throw new ActionError('closed_case','Move this file to an active workflow section before marking it Urgent',409);}
    if(state?.is_urgent)return false;
    await tx`update clients set is_urgent=true where id=${client.id}`;
    await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
      values(${client.id},'client_updated',${session.staff.id},'client',${client.id},${tx.json({operation:'manual_workflow_routed',target_stage:'urgent',...metadata})},${traceId})`;
    return true;
  }
  const route = resolveOverrideRoute(destination, client.current_status);
  if (client.current_status === route.status && client.pipeline_stage === route.pipelineStage && !state?.is_urgent) return false;
  const reason = note?.trim() || "Direct workflow move";
  const [prior] = await tx`select current_setting('cg.status_override',true) status_override, current_setting('cg.workflow_route',true) workflow_route`;
  await tx`select set_config('cg.status_override',${reason},true),set_config('cg.workflow_route','direct',true)`;
  await tx`update clients set is_urgent=false,current_status=${route.status},pipeline_stage=${route.pipelineStage},next_step=${route.nextStep} where id=${client.id}`;
  if(destination==='worksite_change')await ensurePendingWorksiteChange(tx,session,client.id);
  await tx`select set_config('cg.status_override',${prior.status_override ?? ""},true),set_config('cg.workflow_route',${prior.workflow_route ?? ""},true)`;
  await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
    values(${client.id},'status_overridden',${session.staff.id},'client',${client.id},
      ${tx.json({ status: client.current_status, pipeline_stage: client.pipeline_stage })},
      ${tx.json({ status: route.status, pipeline_stage: route.pipelineStage, target_stage: destination, reason, skipped_prerequisites: true, operation: "manual_workflow_routed", ...metadata })},${traceId})`;
  return true;
}
