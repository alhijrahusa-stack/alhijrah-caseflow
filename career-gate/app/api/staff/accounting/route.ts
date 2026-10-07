import { z } from "zod";
import { withStaff } from "@/lib/auth";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { applyAccountDiscount, lockAccount, reconcileAccount, recordApplicationCompletion } from "@/lib/accounting-ledger";
import { missingAccountingSchema } from "@/lib/accounting-schema";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

const id = z.uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().positive().max(1_000_000);
const nonNegativeMoney = z.number().min(0).max(1_000_000);
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

const Input = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("record_transaction"),
    client_id: id,
    transaction_type: z.enum(["payment", "refund", "adjustment", "waiver"]),
    direction: z.enum(["credit", "debit"]).nullable().optional(),
    amount: money,
    payment_method: z.enum(["zelle", "bank_transfer", "cash", "card", "other"]).nullable().optional(),
    occurred_on: date,
    transaction_reference: nullableText(200),
    receipt_document_id: id.nullable().optional(),
    related_transaction_id: id.nullable().optional(),
    reason: nullableText(500),
    idempotency_key: id,
  }),
  z.object({
    operation: z.literal("update_commission"),
    commission_id: id,
    status: z.enum(["approved", "paid", "cancelled", "reversed"]),
    payment_reference: nullableText(200),
    reason: nullableText(500),
  }),
  // Records who completed the client's application. This is the sole source of
  // commission ownership — see lib/accounting-commission.ts.
  z.object({
    operation: z.literal("record_application_completion"),
    client_id: id,
    completed_by: id,
    completed_on: date,
  }),
  z.object({
    operation: z.literal("apply_discount"),
    client_id: id,
    // `discount_type` with `discount_value` is the current contract. A lone
    // `discount_amount` still means an amount, so a caller written before
    // percentages existed keeps working unchanged.
    discount_type: z.enum(["amount", "percentage"]).optional(),
    discount_value: nonNegativeMoney.optional(),
    discount_amount: nonNegativeMoney.optional(),
    reason: nullableText(500),
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

  // Recording one's own application completion is ordinary case work, so it is
  // open to the staff member who did it. Everything that moves money is
  // management-only. Nobody may record a completion for someone else unless
  // they are management, which keeps the commission owner out of self-service.
  const selfCompletion = input.operation === "record_application_completion" && input.completed_by === session.staff.id;
  if (!management(session.staff.role) && !selfCompletion) {
    return err("forbidden", "Management access required", 403, traceId);
  }

  try {
    const result = await withStaff(session, async (tx) => {
      if (input.operation === "record_transaction") {
        if (input.transaction_type === "payment" && !input.payment_method) throw new Error("PAYMENT_METHOD_REQUIRED");
        if (input.transaction_type === "refund" && !input.related_transaction_id) throw new Error("REFUND_LINK_REQUIRED");
        if (input.transaction_type === "adjustment" && !input.direction) throw new Error("ADJUSTMENT_DIRECTION_REQUIRED");

        const account = await lockAccount(tx, input.client_id);

        if (input.receipt_document_id) {
          const [doc] = await tx`select id from documents where id=${input.receipt_document_id} and client_id=${input.client_id}`;
          if (!doc) throw new Error("INVALID_RECEIPT");
        }

        let related: { id: string; amount: string | number; account_id: string } | undefined;
        if (input.related_transaction_id) {
          const relatedRows = await tx`
            select id,amount,account_id from payment_transactions
            where id=${input.related_transaction_id} and account_id=${account.id}
              and transaction_type='payment' and status='confirmed'`;
          related = relatedRows[0] as { id: string; amount: string | number; account_id: string } | undefined;
          if (!related) throw new Error("RELATED_TRANSACTION_NOT_FOUND");
          if (input.transaction_type === "refund") {
            const [{ refunded }] = await tx`
              select coalesce(sum(amount),0)::numeric(10,2) refunded
              from payment_transactions
              where related_transaction_id=${input.related_transaction_id}
                and transaction_type='refund' and status='confirmed'`;
            if (Number(refunded) + input.amount > Number(related.amount)) throw new Error("REFUND_EXCEEDS_PAYMENT");
          }
        }

        const direction = input.transaction_type === "refund"
          ? "debit"
          : input.transaction_type === "adjustment"
            ? input.direction!
            : "credit";

        let [transaction] = await tx`
          insert into payment_transactions(
            account_id,client_id,transaction_type,direction,amount,status,payment_method,occurred_at,
            transaction_reference,receipt_document_id,related_transaction_id,reason,source,recorded_by,idempotency_key
          ) values (
            ${account.id},${input.client_id},${input.transaction_type},${direction},${input.amount},'confirmed',
            ${input.payment_method ?? null},${input.occurred_on}::date::timestamptz,${input.transaction_reference ?? null},
            ${input.receipt_document_id ?? null},${input.related_transaction_id ?? null},${input.reason ?? null},
            'staff',${session.staff.id},${input.idempotency_key}
          )
          on conflict(idempotency_key) do nothing
          returning *`;

        let idempotent = false;
        if (!transaction) {
          [transaction] = await tx`select * from payment_transactions where idempotency_key=${input.idempotency_key}`;
          if (!transaction || transaction.client_id !== input.client_id || transaction.account_id !== account.id) {
            throw new Error("IDEMPOTENCY_CONFLICT");
          }
          idempotent = true;
        }

        if (!idempotent) {
          await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
                   values(${input.client_id},'payment_transaction_recorded',${session.staff.id},'payment_transaction',${transaction.id},
                          ${tx.json({ type: input.transaction_type, direction, amount: input.amount, status: "confirmed" })},${traceId})`;
        }

        const settled = await reconcileAccount(tx, {
          account,
          staffId: session.staff.id,
          traceId,
          eligibilityDate: input.occurred_on,
          refundRecorded: input.transaction_type === "refund",
          triggerTransactionId: transaction.id,
          paymentMethod: input.transaction_type === "payment" ? input.payment_method ?? null : null,
          paymentDate: input.transaction_type === "payment" ? input.occurred_on : null,
          receiptDocumentId: input.receipt_document_id ?? null,
        });

        return { transaction, ...settled, idempotent };
      }

      if (input.operation === "record_application_completion") {
        return recordApplicationCompletion(tx, {
          clientId: input.client_id,
          completedBy: input.completed_by,
          completedOn: input.completed_on,
          staffId: session.staff.id,
          traceId,
        });
      }

      if (input.operation === "apply_discount") {
        const discountValue = input.discount_value ?? input.discount_amount;
        if (discountValue == null) throw new Error("DISCOUNT_VALUE_INVALID");
        return applyAccountDiscount(tx, {
          clientId: input.client_id,
          discountType: input.discount_type ?? "amount",
          discountValue,
          reason: input.reason ?? null,
          staffId: session.staff.id,
          traceId,
        });
      }

      const [commission] = await tx`
        select cm.*,c.id client_id from commissions cm join clients c on c.id=cm.client_id
        where cm.id=${input.commission_id} and c.deleted_at is null for update of cm`;
      if (!commission) throw new Error("COMMISSION_NOT_FOUND");

      const allowed: Record<string, readonly string[]> = {
        pending: ["eligible", "cancelled"],
        eligible: ["approved", "cancelled"],
        approved: ["paid", "cancelled"],
        paid: ["reversed"],
        cancelled: [],
        reversed: [],
      };
      if (!allowed[String(commission.status)]?.includes(input.status)) throw new Error("INVALID_COMMISSION_TRANSITION");
      if (input.status === "paid" && !input.payment_reference) throw new Error("COMMISSION_PAYMENT_REFERENCE_REQUIRED");
      if ((input.status === "cancelled" || input.status === "reversed") && !input.reason) throw new Error("COMMISSION_REASON_REQUIRED");

      const [updated] = await tx`
        update commissions set
          status=${input.status},
          approved_by=case when ${input.status}='approved' then ${session.staff.id} else approved_by end,
          approved_at=case when ${input.status}='approved' then now() else approved_at end,
          paid_at=case when ${input.status}='paid' then now() else paid_at end,
          payment_reference=case when ${input.status}='paid' then ${input.payment_reference ?? null} else payment_reference end,
          cancel_reason=case when ${input.status} in ('cancelled','reversed') then ${input.reason ?? null} else cancel_reason end,
          updated_at=now()
        where id=${input.commission_id}
        returning id,employee_id,client_id,amount,status,approved_at,paid_at,payment_reference,cancel_reason`;
      await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
               values(${commission.client_id},'commission_updated',${session.staff.id},'commission',${commission.id},
                      ${tx.json({ status: commission.status })},${tx.json({ status: input.status })},${traceId})`;
      return { commission: updated };
    });
    return ok(result, 200, traceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "accounting_operation_failed";
    if (message === "PAYMENT_METHOD_REQUIRED") return err("invalid_payment", "Payment method is required", 400, traceId);
    if (message === "REFUND_LINK_REQUIRED") return err("invalid_refund", "Refund must reference the original payment", 400, traceId);
    if (message === "ADJUSTMENT_DIRECTION_REQUIRED") return err("invalid_adjustment", "Adjustment direction is required", 400, traceId);
    if (message === "ACCOUNT_NOT_FOUND") return err("account_not_found", "Accounting record not found", 404, traceId);
    if (message === "CLIENT_NOT_FOUND") return err("client_not_found", "Client was not found", 404, traceId);
    if (message === "COMPLETION_STAFF_NOT_FOUND") return err("completion_staff_not_found", "The selected employee is not an active staff member", 400, traceId);
    if (message === "DISCOUNT_REASON_REQUIRED") return err("discount_reason_required", "A reason is required for a discount", 400, traceId);
    if (message === "DISCOUNT_EXCEEDS_FEE") return err("discount_exceeds_fee", "Discount cannot exceed the account fee", 400, traceId);
    if (message === "DISCOUNT_TYPE_INVALID") return err("discount_type_invalid", "Choose an amount or a percentage", 400, traceId);
    if (message === "DISCOUNT_VALUE_INVALID") return err("discount_value_invalid", "Enter a discount value of zero or more", 400, traceId);
    if (message === "DISCOUNT_PERCENTAGE_OUT_OF_RANGE") return err("discount_percentage_out_of_range", "A percentage discount cannot exceed 100%", 400, traceId);
    if (message === "INVALID_RECEIPT") return err("invalid_receipt", "Receipt must belong to this client", 400, traceId);
    if (message === "RELATED_TRANSACTION_NOT_FOUND") return err("related_transaction_not_found", "Referenced transaction was not found", 404, traceId);
    if (message === "REFUND_EXCEEDS_PAYMENT") return err("refund_exceeds_payment", "Refund exceeds the remaining refundable amount", 409, traceId);
    if (message === "IDEMPOTENCY_CONFLICT") return err("idempotency_conflict", "Idempotency key belongs to another operation", 409, traceId);
    if (message === "BALANCE_NOT_FOUND") return err("balance_not_found", "Account balance could not be calculated", 500, traceId);
    if (message === "COMMISSION_NOT_FOUND") return err("commission_not_found", "Commission was not found", 404, traceId);
    if (message === "INVALID_COMMISSION_TRANSITION") return err("invalid_commission_transition", "Commission transition is not allowed", 409, traceId);
    if (message === "COMMISSION_PAYMENT_REFERENCE_REQUIRED") return err("payment_reference_required", "Payment reference is required", 400, traceId);
    if (message === "COMMISSION_REASON_REQUIRED") return err("commission_reason_required", "A reason is required", 400, traceId);
    // Reads degrade when the accounting schema is behind the code; writes must
    // not, and must name the migration rather than leaking a column error.
    if (missingAccountingSchema(message)) {
      return err(
        "accounting_schema_pending",
        "This database is missing accounting columns this operation writes. Apply the pending career-gate migrations (033 application completion and discount, 034 discount input metadata), then retry.",
        503,
        traceId,
      );
    }
    // Migration 035 drops the migration-006 check that demanded a payment method
    // on a paid account. Until it is applied, a settling waiver, credit
    // adjustment or full discount cannot be recorded at all.
    if (/client_accounts_check/.test(message)) {
      return err(
        "accounting_schema_pending",
        "This account cannot be settled without a recorded payment until migration 035_account_projection_settlement_without_cash.sql is applied.",
        503,
        traceId,
      );
    }
    if (message.includes("application_completion_locked_by_commission")) {
      return err("application_completion_locked", "Application ownership cannot change while a live commission is derived from it; cancel the commission first", 409, traceId);
    }
    return err("accounting_operation_failed", message, 409, traceId);
  }
}
