import { z } from "zod";
import { withStaff } from "@/lib/auth";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

const id = z.uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().positive().max(1_000_000);
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
  if (!management(session.staff.role)) return err("forbidden", "Management access required", 403, traceId);

  try {
    const result = await withStaff(session, async (tx) => {
      if (input.operation === "record_transaction") {
        if (input.transaction_type === "payment" && !input.payment_method) throw new Error("PAYMENT_METHOD_REQUIRED");
        if (input.transaction_type === "refund" && !input.related_transaction_id) throw new Error("REFUND_LINK_REQUIRED");
        if (input.transaction_type === "adjustment" && !input.direction) throw new Error("ADJUSTMENT_DIRECTION_REQUIRED");

        const [account] = await tx`
          select a.id,a.client_id,a.fee_amount,a.assigned_staff,c.assigned_staff client_owner
          from client_accounts a join clients c on c.id=a.client_id
          where a.client_id=${input.client_id} and c.deleted_at is null
          for update of a`;
        if (!account) throw new Error("ACCOUNT_NOT_FOUND");

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

        let [balance] = await tx`select * from client_account_balances where account_id=${account.id}`;
        if (!balance) throw new Error("BALANCE_NOT_FOUND");

        const projectedStatus = Number(balance.balance) <= 0
          ? "paid"
          : input.transaction_type === "refund" && Number(balance.net_credits) <= 0
            ? "refunded"
            : "pending";

        // client_accounts is now compatibility projection only. The DB guard rejects
        // financial writes unless the canonical ledger command enables this local flag.
        await tx`select set_config('cg.finance_projection_sync','1',true)`;
        await tx`
          update client_accounts
          set payment_status=${projectedStatus},
              payment_method=case when ${input.transaction_type}='payment' then ${input.payment_method ?? null} else payment_method end,
              payment_date=case when ${input.transaction_type}='payment' then ${input.occurred_on}::date else payment_date end,
              receipt_document_id=coalesce(${input.receipt_document_id ?? null},receipt_document_id),
              commission_amount=0,
              commission_staff_id=null,
              paid_at=case when ${projectedStatus}='paid' then coalesce(paid_at,now()) else null end,
              updated_by=${session.staff.id}
          where id=${account.id}`;

        [balance] = await tx`select * from client_account_balances where account_id=${account.id}`;

        let commission = null;
        if (balance?.payment_status === "paid") {
          const employeeId = account.assigned_staff ?? account.client_owner;
          if (employeeId) {
            const [rule] = await tx`
              select id,version,commission_type,commission_value
              from commission_rules where employee_id=${employeeId} and active
              order by version desc limit 1`;
            if (rule) {
              const amount = rule.commission_type === "percent"
                ? Math.round(Number(account.fee_amount) * Number(rule.commission_value)) / 100
                : Number(rule.commission_value);
              [commission] = await tx`
                insert into commissions(
                  employee_id,client_id,account_id,trigger_event,trigger_transaction_id,rule_id,rule_version,
                  calculation_basis,commission_type,rate_value,amount,eligibility_date,status
                ) values (
                  ${employeeId},${input.client_id},${account.id},'account_paid',${transaction.id},${rule.id},${rule.version},
                  ${account.fee_amount},${rule.commission_type},${rule.commission_value},${amount},${input.occurred_on}::date,'eligible'
                )
                on conflict(account_id,trigger_event) do nothing
                returning id,employee_id,amount,status`;
              if (commission) {
                await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
                         values(${input.client_id},'commission_created',${session.staff.id},'commission',${commission.id},
                                ${tx.json({ employee_id: employeeId, amount, status: "eligible", rule_version: rule.version })},${traceId})`;
              } else {
                [commission] = await tx`select id,employee_id,amount,status from commissions where account_id=${account.id} and trigger_event='account_paid'`;
              }
            }
          }
        } else {
          const reversed = await tx`
            update commissions set status='reversed',cancel_reason='Account no longer fully paid',updated_at=now()
            where account_id=${account.id} and trigger_event='account_paid' and status not in ('cancelled','reversed')
            returning id,employee_id,amount,status`;
          for (const row of reversed) {
            await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
                     values(${input.client_id},'commission_updated',${session.staff.id},'commission',${row.id},
                            ${tx.json({ status: "reversed", reason: "Account no longer fully paid" })},${traceId})`;
          }
        }

        return { transaction, balance, commission, idempotent };
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
    if (message === "INVALID_RECEIPT") return err("invalid_receipt", "Receipt must belong to this client", 400, traceId);
    if (message === "RELATED_TRANSACTION_NOT_FOUND") return err("related_transaction_not_found", "Referenced transaction was not found", 404, traceId);
    if (message === "REFUND_EXCEEDS_PAYMENT") return err("refund_exceeds_payment", "Refund exceeds the remaining refundable amount", 409, traceId);
    if (message === "IDEMPOTENCY_CONFLICT") return err("idempotency_conflict", "Idempotency key belongs to another operation", 409, traceId);
    if (message === "BALANCE_NOT_FOUND") return err("balance_not_found", "Account balance could not be calculated", 500, traceId);
    if (message === "COMMISSION_NOT_FOUND") return err("commission_not_found", "Commission was not found", 404, traceId);
    if (message === "INVALID_COMMISSION_TRANSITION") return err("invalid_commission_transition", "Commission transition is not allowed", 409, traceId);
    if (message === "COMMISSION_PAYMENT_REFERENCE_REQUIRED") return err("payment_reference_required", "Payment reference is required", 400, traceId);
    if (message === "COMMISSION_REASON_REQUIRED") return err("commission_reason_required", "A reason is required", 400, traceId);
    return err("accounting_operation_failed", message, 409, traceId);
  }
}
