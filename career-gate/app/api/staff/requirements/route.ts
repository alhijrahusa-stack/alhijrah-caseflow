import { z } from "zod";
import { withStaff } from "@/lib/auth";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

const id = z.uuid();
const status = z.enum(["complete", "missing", "pending_review", "rejected", "expired", "not_applicable"]);
const due = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();

const Input = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create_requirement"),
    client_id: id,
    requirement_key: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(240),
    why: z.string().trim().max(500).nullable().optional(),
    completion_rule: z.string().trim().max(500).nullable().optional(),
    due_on: due,
    status: status.default("missing"),
  }),
  z.object({
    operation: z.literal("update_requirement"),
    requirement_id: id,
    status,
    due_on: due,
  }),
]);

function management(role: string) {
  return role === "admin" || role === "manager";
}

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("invalid_input", parsed.error.issues[0]?.message ?? "Invalid requirement", 400, traceId);
  const input = parsed.data;
  const session = guard.session;

  try {
    const result = await withStaff(session, async (tx) => {
      if (input.operation === "create_requirement") {
        if (!management(session.staff.role)) throw new Error("FORBIDDEN");
        const [client] = await tx`select id,pipeline_stage from clients where id=${input.client_id} and deleted_at is null`;
        if (!client) throw new Error("CLIENT_NOT_ACCESSIBLE");
        const [row] = await tx`
          insert into requirements(
            client_id,requirement_key,stage,title,why,source,completion_rule,due_at,status,created_by,updated_by
          ) values (
            ${input.client_id},${input.requirement_key},${client.pipeline_stage},${input.title},${input.why ?? null},'staff',
            ${input.completion_rule ?? null},${input.due_on ?? null}::date,${input.status},${session.staff.id},${session.staff.id}
          )
          on conflict(client_id,requirement_key) do update
             set title=excluded.title,why=excluded.why,completion_rule=excluded.completion_rule,due_at=excluded.due_at,
                 status=excluded.status,updated_by=excluded.updated_by,updated_at=now()
          returning *`;
        await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
                 values(${input.client_id},'requirement_updated',${session.staff.id},'requirement',${row.id},
                        ${tx.json({ requirement_key: row.requirement_key, status: row.status })},${traceId})`;
        return { requirement: row };
      }

      const [before] = await tx`select * from requirements where id=${input.requirement_id} for update`;
      if (!before) throw new Error("REQUIREMENT_NOT_FOUND");
      const [row] = await tx`
        update requirements set status=${input.status},due_at=${input.due_on ?? null}::date,updated_by=${session.staff.id},updated_at=now()
        where id=${input.requirement_id} returning *`;
      await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
               values(${row.client_id},'requirement_updated',${session.staff.id},'requirement',${row.id},
                      ${tx.json({ status: before.status, due_at: before.due_at })},${tx.json({ status: row.status, due_at: row.due_at })},${traceId})`;
      return { requirement: row };
    });
    return ok(result, 200, traceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "requirement_operation_failed";
    if (message === "FORBIDDEN") return err("forbidden", "Management access required", 403, traceId);
    if (message === "CLIENT_NOT_ACCESSIBLE") return err("not_found", "Client not found or not accessible", 404, traceId);
    if (message === "REQUIREMENT_NOT_FOUND") return err("requirement_not_found", "Requirement not found or not accessible", 404, traceId);
    return err("requirement_operation_failed", message, 409, traceId);
  }
}
