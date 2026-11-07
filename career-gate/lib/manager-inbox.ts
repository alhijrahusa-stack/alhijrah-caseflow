import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";
import { permissionAllows } from "@/lib/authz";
import { CLIENT_STAGES, type ClientStageFilter } from "@/lib/client-lifecycle-filters";
import { moveWorkflowClient } from "@/lib/manual-workflow";
import { reportIntelligence, type ReportPeriod } from "@/lib/reports";
import { ActionError } from "@/lib/service";

export type ManagerInboxItem = {
  id: string;
  kind: "client" | "report";
  client_id: string | null;
  title: string;
  submitted_note: string;
  source_path: string;
  snapshot: Record<string, unknown>;
  submitted_by: string;
  sender_name: string;
  submitted_at: string;
  full_name: string | null;
  ref: string | null;
  current_status: string | null;
  client_version: string | null;
};
export type ManagerInboxPage = { items: ManagerInboxItem[]; total: number; page: number; pages: number };
export type SubmitManagerReview =
  | { kind: "client"; client_id: string; note: string; request_key: string }
  | { kind: "report"; period: ReportPeriod; note: string; request_key: string };
export type ResolveManagerReview = {
  id: string;
  destination: ClientStageFilter | "keep_current";
  note: string;
  expected_client_version?: string | null;
};

function requireManagement(session: StaffSession) {
  if (session.staff.role !== "admin" && session.staff.role !== "manager")
    throw new ActionError("forbidden", "Manager Task Center requires manager or admin access", 403);
}

export async function managerInbox(session: StaffSession, requestedPage = 1): Promise<ManagerInboxPage> {
  requireManagement(session);
  return withStaff(session, async tx => {
    const [count] = await tx`select count(*)::int total from manager_inbox where status='open'`;
    const total = Number(count.total);
    const pages = Math.max(1, Math.ceil(total / 10));
    const page = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
    const items = await tx`
      select i.id,i.kind,i.client_id,i.title,i.submitted_note,i.source_path,i.snapshot,i.submitted_by,
        i.submitted_at::text,s.display_name sender_name,c.full_name,c.ref,c.current_status,c.updated_at::text client_version
      from manager_inbox i join staff s on s.id=i.submitted_by left join clients c on c.id=i.client_id
      where i.status='open' order by i.submitted_at,i.id limit 10 offset ${(page - 1) * 10}`;
    return { items: items as unknown as ManagerInboxItem[], total, page, pages };
  });
}

/** A submission never changes the client's workflow. Only the manager may route it. */
export async function submitManagerReview(session: StaffSession, input: SubmitManagerReview, traceId: string) {
  if (input.kind === "report") requireManagement(session);
  else if (!(await permissionAllows(session, "add_task")))
    throw new ActionError("forbidden", "Your current permissions do not allow sending review tasks", 403);
  const report = input.kind === "report" ? await reportIntelligence(session, input.period) : null;
  return withStaff(session, async tx => {
    let title: string;
    let sourcePath: string;
    let clientId: string | null = null;
    let snapshot: Record<string, unknown>;
    if (input.kind === "client") {
      // Read the actual scoped client; INSERT RLS checks access again. Avoid a
      // client->inbox lock order opposite to the manager's inbox->client lock.
      const [client] = await tx`select id,ref,full_name,current_status from clients where id=${input.client_id} and deleted_at is null`;
      if (!client) throw new ActionError("not_found", "Client is unavailable or not assigned to you", 404);
      clientId = String(client.id);
      title = `${client.ref} · ${client.full_name}`.slice(0, 200);
      sourcePath = `/staff/client/${clientId}`;
      snapshot = { ref: client.ref, full_name: client.full_name, current_status: client.current_status };
    } else {
      title = `Operations report · ${input.period} days`;
      sourcePath = `/staff/reports?period=${input.period}`;
      snapshot = { period: input.period, generated_at: new Date().toISOString(), kpis: report!.kpis, insights: report!.insights, funnel: report!.funnel };
    }
    const [inserted] = await tx`
      insert into manager_inbox(request_key,kind,client_id,title,submitted_note,source_path,snapshot,submitted_by)
      values(${input.request_key},${input.kind},${clientId},${title},${input.note},${sourcePath},${tx.json(snapshot as never)},${session.staff.id})
      on conflict do nothing returning id`;
    if (!inserted) {
      const [existing] = await tx`select id from manager_inbox where status='open'
        and ((${clientId}::uuid is not null and client_id=${clientId}) or (submitted_by=${session.staff.id} and source_path=${sourcePath})) limit 1`;
      if (existing) return { id: String(existing.id), created: false };
      throw new ActionError("conflict", "This review request was already processed. Refresh before sending it again.", 409);
    }
    if (clientId) await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
      values(${clientId},'client_updated',${session.staff.id},'manager_review',${inserted.id},
        ${tx.json({ operation: "manager_review_requested", note: input.note, request_id: String(inserted.id) })},${traceId})`;
    return { id: String(inserted.id), created: true };
  });
}

/** Resolve, direct routing and audit commit together; concurrent resolution cannot repeat it. */
export async function resolveManagerReview(session: StaffSession, input: ResolveManagerReview, traceId: string) {
  requireManagement(session);
  return withStaff(session, async tx => {
    const [item] = await tx`select * from manager_inbox where id=${input.id} for update`;
    if (!item) throw new ActionError("not_found", "Review request is unavailable", 404);
    if (item.status !== "open") return { id: input.id, already_resolved: true, client_id: item.client_id as string | null, task_id: item.routed_task_id as string | null };
    let taskId: string | null = null;
    if (item.client_id) {
      const [client] = await tx`select id,current_status,pipeline_stage,next_step,updated_at::text client_version
        from clients where id=${item.client_id} and deleted_at is null for update`;
      if (!client) throw new ActionError("not_found", "Client is no longer available", 404);
      if (!input.expected_client_version || client.client_version !== input.expected_client_version)
        throw new ActionError("client_changed", "This client changed during your review. Reopen the item to review the latest data before routing.", 409);
      if (input.destination !== "keep_current") {
        await moveWorkflowClient(tx, session, client as { id:string; current_status:string; pipeline_stage:string; next_step:string }, input.destination, input.note, traceId, { operation: "manager_review_routed", request_id: input.id });
      }
      if (input.note) await tx`insert into notes(client_id,note,staff_id) values(${client.id},${input.note},${session.staff.id})`;
      await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
        values(${client.id},'client_updated',${session.staff.id},'manager_review',${input.id},
          ${tx.json({ operation: "manager_review_resolved", destination: input.destination, note: input.note })},${traceId})`;
    } else if (input.destination !== "keep_current") {
      // An aggregate report has no client to move. Route an actual follow-up
      // task back to its sender and retain the selected workflow destination.
      const destination = CLIENT_STAGES.find(stage => stage.id === input.destination)!.label;
      const [task] = await tx`insert into tasks(title,description,assigned_to,created_by)
        values(${`${destination} · ${String(item.title)}`.slice(0, 200)},
          ${`Manager review: ${input.id}\nWorkflow destination: ${destination}\nSource: ${item.source_path}`},
          ${item.submitted_by},${session.staff.id}) returning id`;
      taskId = String(task.id);
    }
    await tx`update manager_inbox set status='resolved',destination=${input.destination},resolution_note=${input.note},
      resolved_by=${session.staff.id},resolved_at=now(),routed_task_id=${taskId} where id=${input.id}`;
    return { id: input.id, already_resolved: false, client_id: item.client_id as string | null, task_id: taskId };
  });
}
