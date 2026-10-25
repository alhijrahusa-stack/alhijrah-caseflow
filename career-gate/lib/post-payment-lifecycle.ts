import "server-only";
import type { Tx } from "@/lib/auth";

const POST_HIRE = ["pre_hire_completed","screening_pending","i9_available","post_hire_tasks","ready_for_first_day"];

export async function syncPostPaymentLifecycle(
  tx: Tx,
  clientId: string,
  staffId: string,
  traceId: string
): Promise<{ changed: boolean; paymentReady: boolean }> {
  const [client] = await tx`
    select id,current_status,pipeline_stage,next_step from clients
    where id=${clientId} and deleted_at is null for update`;
  if (!client || !POST_HIRE.includes(String(client.current_status))) return { changed: false, paymentReady: false };

  const [passed] = await tx`select 1 from appointment_outcomes
    where client_id=${clientId} and decision='pass' limit 1`;
  if (!passed) return { changed: false, paymentReady: false };
  const [account] = await tx`select payment_status from client_accounts where client_id=${clientId}`;
  const paymentReady = account?.payment_status === "paid";
  const newStatus = paymentReady && client.current_status === "pre_hire_completed"
    ? "screening_pending" : String(client.current_status);
  const newStage = paymentReady ? "post_interview_completion" : "payment_required";
  const nextStep = paymentReady && client.current_status === "pre_hire_completed"
    ? "Complete screening and remaining post-hire paperwork."
    : !paymentReady && client.pipeline_stage === "post_interview_completion"
      ? "Office payment balance requires verification before remaining paperwork."
      : String(client.next_step);

  const statusChanged = newStatus !== client.current_status;
  const stageChanged = newStage !== client.pipeline_stage;
  const nextStepChanged = nextStep !== client.next_step;
  if (!statusChanged && !stageChanged && !nextStepChanged) return { changed: false, paymentReady };
  await tx`update clients set current_status=${newStatus},pipeline_stage=${newStage},next_step=${nextStep}
    where id=${clientId}`;
  if (statusChanged) {
    await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
      values(${clientId},'status_changed',${staffId},'client',${clientId},
      ${tx.json({status:client.current_status})},${tx.json({status:newStatus})},${traceId})`;
  }
  if (stageChanged) {
    await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
      values(${clientId},'pipeline_stage_changed',${staffId},'client',${clientId},
      ${tx.json({pipeline_stage:client.pipeline_stage})},${tx.json({pipeline_stage:newStage})},${traceId})`;
  }
  if (nextStepChanged) {
    await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
      values(${clientId},'next_step_changed',${staffId},'client',${clientId},
      ${tx.json({next_step:client.next_step})},${tx.json({next_step:nextStep})},${traceId})`;
  }
  return { changed: true, paymentReady };
}
