import { z } from "zod";
import { withStaff } from "@/lib/auth";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

const id = z.uuid();
const stage = z.enum([
  "portal_intake",
  "no_amazon_account",
  "amazon_account_waiting_job",
  "interview_scheduled",
  "interview_passed",
  "interview_rejected",
  "post_interview_completion",
]);
const dispatchPeriod = z.enum(["morning", "evening", "night", "needs_manual_review"]);

const Input = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("move_stage"), client_id: id, stage, expected_stage: stage }),
  z.object({
    operation: z.literal("set_dispatch"),
    client_id: id,
    mode: z.enum(["auto", "manual"]),
    shift_period: dispatchPeriod.nullable().optional(),
  }),
  z.object({ operation: z.literal("request_transfer"), client_id: id, requested_owner: id.nullable().optional(), reason: z.string().trim().max(500).nullable().optional() }),
  z.object({
    operation: z.literal("update_payment"),
    client_id: id,
    payment_status: z.enum(["pending", "paid", "refunded"]),
    payment_method: z.enum(["zelle", "bank_transfer", "cash", "card"]).nullable().optional(),
    payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    receipt_document_id: id.nullable().optional(),
  }),
  z.object({ operation: z.literal("bulk_assign"), client_ids: z.array(id).min(1).max(250), staff_id: id.nullable() }),
  z.object({ operation: z.literal("set_round_robin"), enabled: z.boolean() }),
  z.object({
    operation: z.literal("update_staff_comp"),
    staff_id: id,
    commission_type: z.enum(["fixed", "percent"]),
    commission_value: z.number().min(0).max(100000),
    eligible_for_round_robin: z.boolean(),
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
  if (!parsed.success) return err("invalid_input", parsed.error.issues[0]?.message ?? "Invalid operation", 400, traceId);
  const input = parsed.data;
  const session = guard.session;

  try {
    const result = await withStaff(session, async (tx) => {
      if (input.operation === "move_stage") {
        const [before] = await tx`select id,pipeline_stage from clients where id=${input.client_id} and deleted_at is null for update`;
        if (!before) throw new Error("CLIENT_NOT_ACCESSIBLE");
        if (before.pipeline_stage !== input.expected_stage) throw new Error("STALE_STAGE");
        if (before.pipeline_stage === input.stage) return { changed: false, stage: before.pipeline_stage };
        await tx`update clients set pipeline_stage=${input.stage} where id=${input.client_id}`;
        await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
                 values(${input.client_id},'pipeline_stage_changed',${session.staff.id},'client',${input.client_id},
                        ${tx.json({ pipeline_stage: before.pipeline_stage })},${tx.json({ pipeline_stage: input.stage })},${traceId})`;
        return { changed: true, stage: input.stage };
      }

      if (input.operation === "set_dispatch") {
        if (!management(session.staff.role)) throw new Error("FORBIDDEN");
        if (input.mode === "manual" && !input.shift_period) throw new Error("DISPATCH_PERIOD_REQUIRED");
        const [before] = await tx`
          select p.id,p.shift_period,p.dispatch_mode,p.manual_dispatch_at,p.manual_dispatch_by
          from client_preferences p
          join clients c on c.id=p.client_id
          where p.client_id=${input.client_id} and c.deleted_at is null
          order by case p.rank when 'primary' then 0 else 1 end,p.preference_order,p.created_at
          limit 1
          for update of p`;
        if (!before) throw new Error("PREFERENCE_NOT_FOUND");

        const [after] = input.mode === "manual"
          ? await tx`
              update client_preferences
              set dispatch_mode='manual',shift_period=${input.shift_period!},manual_dispatch_at=now(),manual_dispatch_by=${session.staff.id}
              where id=${before.id}
              returning id,shift_period,dispatch_mode,auto_dispatched_at,manual_dispatch_at,manual_dispatch_by`
          : await tx`
              update client_preferences
              set dispatch_mode='auto',manual_dispatch_at=null,manual_dispatch_by=null
              where id=${before.id}
              returning id,shift_period,dispatch_mode,auto_dispatched_at,manual_dispatch_at,manual_dispatch_by`;

        await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
                 values(${input.client_id},'client_updated',${session.staff.id},'client_preference',${before.id},
                        ${tx.json({ shift_period: before.shift_period, dispatch_mode: before.dispatch_mode, manual_dispatch_at: before.manual_dispatch_at, manual_dispatch_by: before.manual_dispatch_by })},
                        ${tx.json({ shift_period: after.shift_period, dispatch_mode: after.dispatch_mode, manual_dispatch_at: after.manual_dispatch_at, manual_dispatch_by: after.manual_dispatch_by })},${traceId})`;
        return { changed: true, dispatch: after };
      }

      if (input.operation === "request_transfer") {
        const [client] = await tx`select id,assigned_staff from clients where id=${input.client_id} and deleted_at is null`;
        if (!client) throw new Error("CLIENT_NOT_ACCESSIBLE");
        const [row] = await tx`
          insert into ownership_transfer_requests(client_id,requested_by,current_owner,requested_owner,reason)
          values(${input.client_id},${session.staff.id},${client.assigned_staff},${input.requested_owner ?? session.staff.id},${input.reason ?? null})
          on conflict(client_id) where status='pending'
          do update set requested_by=excluded.requested_by,requested_owner=excluded.requested_owner,reason=excluded.reason,created_at=now()
          returning id`;
        await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
                 values(${input.client_id},'transfer_requested',${session.staff.id},'ownership_transfer',${row.id},
                        ${tx.json({ requested_owner: input.requested_owner ?? session.staff.id, reason: input.reason ?? null })},${traceId})`;
        return { request_id: row.id };
      }

      if (input.operation === "update_payment") {
        if (!management(session.staff.role)) throw new Error("FORBIDDEN");
        if (input.payment_status === "paid" && (!input.payment_method || !input.payment_date)) throw new Error("PAYMENT_FIELDS_REQUIRED");
        if (input.receipt_document_id) {
          const [doc] = await tx`select id from documents where id=${input.receipt_document_id} and client_id=${input.client_id}`;
          if (!doc) throw new Error("INVALID_RECEIPT");
        }
        const [before] = await tx`select * from client_accounts where client_id=${input.client_id} for update`;
        if (!before) throw new Error("ACCOUNT_NOT_FOUND");
        const [row] = await tx`
          update client_accounts
          set payment_status=${input.payment_status},
              payment_method=${input.payment_method ?? null},
              payment_date=${input.payment_date ?? null},
              receipt_document_id=coalesce(${input.receipt_document_id ?? null},receipt_document_id),
              updated_by=${session.staff.id}
          where client_id=${input.client_id}
          returning id,payment_status,payment_method,payment_date,commission_amount`;
        await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
                 values(${input.client_id},'payment_updated',${session.staff.id},'client_account',${row.id},
                        ${tx.json({ payment_status: before.payment_status, payment_method: before.payment_method, payment_date: before.payment_date })},
                        ${tx.json({ payment_status: row.payment_status, payment_method: row.payment_method, payment_date: row.payment_date })},${traceId})`;
        return { changed: true, account: row };
      }

      if (input.operation === "bulk_assign") {
        if (!management(session.staff.role)) throw new Error("FORBIDDEN");
        if (input.staff_id) {
          const [staff] = await tx`select id from staff where id=${input.staff_id} and active`;
          if (!staff) throw new Error("STAFF_NOT_FOUND");
        }
        const rows = await tx`select id,assigned_staff from clients where id=any(${input.client_ids}) and deleted_at is null for update`;
        for (const client of rows) {
          if (client.assigned_staff === input.staff_id) continue;
          await tx`update clients set assigned_staff=${input.staff_id} where id=${client.id}`;
          await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
                   values(${client.id},'bulk_staff_assigned',${session.staff.id},'client',${client.id},
                          ${tx.json({ assigned_staff: client.assigned_staff })},${tx.json({ assigned_staff: input.staff_id })},${traceId})`;
        }
        return { changed: rows.length };
      }

      if (input.operation === "set_round_robin") {
        if (session.staff.role !== "admin") throw new Error("FORBIDDEN");
        await tx`update assignment_settings set round_robin_enabled=${input.enabled},updated_by=${session.staff.id},updated_at=now() where singleton=true`;
        return { enabled: input.enabled };
      }

      if (session.staff.role !== "admin") throw new Error("FORBIDDEN");
      const [row] = await tx`
        update staff
        set commission_type=${input.commission_type},commission_value=${input.commission_value},
            eligible_for_round_robin=${input.eligible_for_round_robin}
        where id=${input.staff_id}
        returning id,staff_code,display_name,commission_type,commission_value,eligible_for_round_robin`;
      if (!row) throw new Error("STAFF_NOT_FOUND");
      return { staff: row };
    });
    return ok(result, 200, traceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "operation_failed";
    if (message === "FORBIDDEN") return err("forbidden", "This action requires management access", 403, traceId);
    if (message === "CLIENT_NOT_ACCESSIBLE") return err("not_found", "Client not found or not accessible", 404, traceId);
    if (message === "STALE_STAGE") return err("stale_stage", "This client was moved by another staff member. Refresh before moving it again.", 409, traceId);
    if (message === "PREFERENCE_NOT_FOUND") return err("preference_not_found", "No job preference is available for dispatch", 404, traceId);
    if (message === "DISPATCH_PERIOD_REQUIRED") return err("dispatch_period_required", "Manual dispatch requires a target period", 400, traceId);
    if (message === "PAYMENT_FIELDS_REQUIRED") return err("invalid_payment", "Paid requires payment method and payment date", 400, traceId);
    if (message === "INVALID_RECEIPT") return err("invalid_receipt", "Receipt must belong to this client", 400, traceId);
    if (message === "ACCOUNT_NOT_FOUND") return err("account_not_found", "Accounting record not found", 404, traceId);
    if (message === "STAFF_NOT_FOUND") return err("staff_not_found", "Active staff member not found", 404, traceId);
    return err("operation_failed", message, 409, traceId);
  }
}
