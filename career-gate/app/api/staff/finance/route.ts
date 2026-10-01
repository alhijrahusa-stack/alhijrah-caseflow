import { z } from "zod";
import { withStaff } from "@/lib/auth";
import { permissionFor, clientScope, type ActionName } from "@/lib/authz";
import { accountLedgerEntries, recordFinancialTransaction } from "@/lib/finance";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { ActionError } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

const id = z.uuid();
const money = z.number().finite().positive().max(1_000_000);
const instant = z.iso.datetime({ offset: true });
const method = z.enum(["zelle", "bank_transfer", "cash", "card", "other"]);

const Input = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("record_payment"),
    client_id: id,
    amount: money,
    payment_method: method,
    transaction_reference: z.string().trim().max(200).nullable().optional(),
    receipt_document_id: id.nullable().optional(),
    occurred_at: instant,
    note: z.string().trim().max(1000).nullable().optional(),
  }),
  z.object({
    operation: z.literal("record_refund"),
    client_id: id,
    amount: money,
    related_transaction_id: id,
    transaction_reference: z.string().trim().max(200).nullable().optional(),
    occurred_at: instant,
    note: z.string().trim().min(1).max(1000),
  }),
  z.object({
    operation: z.literal("record_adjustment"),
    client_id: id,
    direction: z.enum(["debit", "credit"]),
    amount: money,
    related_transaction_id: id.nullable().optional(),
    occurred_at: instant,
    note: z.string().trim().min(1).max(1000),
  }),
  z.object({
    operation: z.literal("record_waiver"),
    client_id: id,
    amount: money,
    occurred_at: instant,
    note: z.string().trim().min(1).max(1000),
  }),
]);

function actionOf(operation: z.infer<typeof Input>["operation"]): ActionName {
  return operation;
}

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  const raw = new URL(req.url).searchParams.get("client_id");
  const parsed = id.safeParse(raw);
  if (!parsed.success) return err("invalid_input", "Valid client_id is required", 400, traceId);
  const scope = await clientScope(guard.session, parsed.data);
  if (!scope.ok) return err(scope.status === 403 ? "forbidden" : "not_found", scope.reason, scope.status, traceId);
  const entries = await accountLedgerEntries(guard.session, parsed.data);
  return ok({ entries }, 200, traceId);
}

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;

  const key = req.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 12 || key.length > 200) return err("idempotency_key_required", "A stable Idempotency-Key is required", 400, traceId);

  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("invalid_input", parsed.error.issues[0]?.message ?? "Invalid financial transaction", 400, traceId);
  const input = parsed.data;
  const session = guard.session;

  const permission = await permissionFor(session.staff.role, actionOf(input.operation));
  if (!permission.allowed) return err("forbidden", "Your role does not allow this financial action", 403, traceId);
  const scope = await clientScope(session, input.client_id, permission.scope);
  if (!scope.ok) return err(scope.status === 403 ? "forbidden" : "not_found", scope.reason, scope.status, traceId);

  try {
    const result = await withStaff(session, async (tx) => {
      const common = {
        clientId: input.client_id,
        amount: input.amount,
        occurredAt: new Date(input.occurred_at),
        idempotencyKey: `finance:${input.operation}:${key}`,
      };
      if (input.operation === "record_payment") {
        return recordFinancialTransaction(tx, { staffId: session.staff.id, traceId }, {
          ...common,
          type: "payment",
          method: input.payment_method,
          reference: input.transaction_reference ?? null,
          receiptDocumentId: input.receipt_document_id ?? null,
          note: input.note ?? null,
        });
      }
      if (input.operation === "record_refund") {
        return recordFinancialTransaction(tx, { staffId: session.staff.id, traceId }, {
          ...common,
          type: "refund",
          relatedTransactionId: input.related_transaction_id,
          reference: input.transaction_reference ?? null,
          note: input.note,
        });
      }
      if (input.operation === "record_adjustment") {
        return recordFinancialTransaction(tx, { staffId: session.staff.id, traceId }, {
          ...common,
          type: input.direction === "debit" ? "adjustment_debit" : "adjustment_credit",
          relatedTransactionId: input.related_transaction_id ?? null,
          note: input.note,
        });
      }
      return recordFinancialTransaction(tx, { staffId: session.staff.id, traceId }, {
        ...common,
        type: "waiver",
        note: input.note,
      });
    });
    return ok(result, result.idempotent ? 200 : 201, traceId);
  } catch (e) {
    if (e instanceof ActionError) return err(e.code, e.message, e.status, traceId);
    const message = e instanceof Error ? e.message : "financial_operation_failed";
    return err("financial_operation_failed", message, 409, traceId);
  }
}
