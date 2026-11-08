import "server-only";
import { z } from "zod";
import { withStaff, type StaffSession, type Tx } from "@/lib/auth";
import { ActionError } from "@/lib/service";
import { staffOperation } from "@/lib/staff-operation";

export const ClientPriorityInput = z.object({
  client_id: z.uuid(),
  is_urgent: z.boolean(),
  operation_id: z.uuid(),
  expected_updated_at: z.string().min(1).max(100),
});
export type ClientPriorityCommand = z.infer<typeof ClientPriorityInput>;

/** Shared by the strict priority endpoint and the receipt-compatible dispatch
 * endpoint. RLS scopes the locked original; this command never routes it. */
export async function setClientUrgency(tx: Tx, session: StaffSession, input: { client_id: string; urgent: boolean; expected_updated_at?: string }, traceId: string) {
  const [client] = await tx`select id,is_urgent,current_status,pipeline_stage,assigned_staff,manager_review_id,operational_location,updated_at::text updated_at
    from clients where id=${input.client_id} and deleted_at is null for update`;
  if (!client) throw new ActionError("not_found", "Client unavailable or not assigned to you", 404);
  if (client.manager_review_id) throw new ActionError("manager_review_pending", "This file is awaiting a manager decision", 409);
  if (input.expected_updated_at && input.expected_updated_at !== client.updated_at) {
    throw new ActionError("client_changed", "This file changed. Refresh before updating its priority.", 409);
  }
  if (input.urgent && ["completed", "cancelled"].includes(String(client.current_status))) {
    throw new ActionError("closed_case", "Priority is available for active files only", 409);
  }
  const changed = client.is_urgent !== input.urgent;
  if (changed) {
    await tx`update clients set is_urgent=${input.urgent} where id=${input.client_id}`;
    await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
      values(${input.client_id},'client_updated',${session.staff.id},'client',${input.client_id},
        ${tx.json({ is_urgent: client.is_urgent, operational_location: client.operational_location })},
        ${tx.json({ operation: "client_priority_changed", is_urgent: input.urgent, operational_location: client.operational_location })},${traceId})`;
  }
  const [next] = await tx`select id,is_urgent,manager_review_id,operational_location,updated_at::text updated_at from clients where id=${input.client_id}`;
  return { client: next, changed };
}

export async function executeClientPriority(session: StaffSession, input: ClientPriorityCommand, traceId: string) {
  return withStaff(session, tx => staffOperation(tx, session, input.operation_id, "client_priority", input,
    () => setClientUrgency(tx, session, { client_id: input.client_id, urgent: input.is_urgent, expected_updated_at: input.expected_updated_at }, traceId)));
}
