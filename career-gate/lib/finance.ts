import "server-only";
import type postgres from "postgres";
import { withStaff, type StaffSession } from "@/lib/auth";
import { ActionError, logActivity, type Actor } from "@/lib/service";

export type FinanceTransactionType = "payment" | "refund" | "adjustment_debit" | "adjustment_credit" | "waiver" | "reversal_debit" | "reversal_credit";
export type FinancePaymentMethod = "zelle" | "bank_transfer" | "cash" | "card" | "other";

export type AccountLedgerRow = {
  account_id: string;
  client_id: string;
  ref: string;
  full_name: string;
  phone: string;
  email: string | null;
  site_code: string | null;
  site_name: string | null;
  assigned_staff: string | null;
  assigned_name: string | null;
  staff_code: string | null;
  service_code: string;
  due_date: string | null;
  total_charged: number;
  total_paid: number;
  total_refunded: number;
  balance: number;
  payment_status: "unpaid" | "partially_paid" | "paid" | "overdue" | "refunded";
  updated_at: string;
};

export type LedgerEntry = {
  id: string;
  account_id: string;
  client_id: string;
  transaction_type: string;
  amount: number;
  payment_method: string | null;
  transaction_reference: string | null;
  receipt_document_id: string | null;
  related_transaction_id: string | null;
  occurred_at: string;
  note: string | null;
  source: string;
  recorded_by: string | null;
  recorded_by_name: string | null;
  created_at: string;
};

export async function accountLedgerData(session: StaffSession): Promise<AccountLedgerRow[]> {
  return withStaff(session, async (tx) => {
    const rows = await tx`
      select b.account_id,b.client_id,c.ref,c.full_name,c.phone,c.email,
             p.site_code,p.site_name,
             a.assigned_staff,s.display_name assigned_name,s.staff_code,
             b.service_code,b.due_date,b.total_charged,b.total_paid,b.total_refunded,b.balance,b.payment_status,
             a.updated_at
        from client_account_balances b
        join client_accounts a on a.id=b.account_id
        join clients c on c.id=b.client_id and c.deleted_at is null
        left join staff s on s.id=a.assigned_staff
        left join lateral (
          select site_code,site_name from client_preferences p
           where p.client_id=c.id
           order by case p.rank when 'primary' then 0 else 1 end,p.preference_order,p.created_at
           limit 1
        ) p on true
       order by case b.payment_status when 'overdue' then 0 when 'unpaid' then 1 when 'partially_paid' then 2 else 3 end,
                a.updated_at desc
       limit 1000`;
    return rows.map((r) => ({
      ...r,
      total_charged: Number(r.total_charged),
      total_paid: Number(r.total_paid),
      total_refunded: Number(r.total_refunded),
      balance: Number(r.balance),
    })) as AccountLedgerRow[];
  });
}

export async function accountLedgerEntries(session: StaffSession, clientId: string): Promise<LedgerEntry[]> {
  return withStaff(session, async (tx) => {
    const rows = await tx`
      select t.*,s.display_name recorded_by_name
        from account_transactions t
        left join staff s on s.id=t.recorded_by
       where t.client_id=${clientId}
       order by t.occurred_at desc,t.created_at desc,t.id desc`;
    return rows.map((r) => ({ ...r, amount: Number(r.amount) })) as LedgerEntry[];
  });
}

type Tx = postgres.TransactionSql;

export async function recordFinancialTransaction(tx: Tx, actor: Actor & { staffId: string }, input: {
  clientId: string;
  type: FinanceTransactionType;
  amount: number;
  method?: FinancePaymentMethod | null;
  reference?: string | null;
  receiptDocumentId?: string | null;
  relatedTransactionId?: string | null;
  occurredAt: Date;
  note?: string | null;
  idempotencyKey: string;
}) {
  const [account] = await tx`
    select id,client_id from client_accounts where client_id=${input.clientId} for update`;
  if (!account) throw new ActionError("account_not_found", "Accounting record not found", 404);
  if (input.amount <= 0 || !Number.isFinite(input.amount)) throw new ActionError("invalid_amount", "Amount must be greater than zero");
  if (input.type === "payment" && !input.method) throw new ActionError("payment_method_required", "Payment method is required");

  if (input.receiptDocumentId) {
    const [doc] = await tx`select id from documents where id=${input.receiptDocumentId} and client_id=${input.clientId}`;
    if (!doc) throw new ActionError("invalid_receipt", "Receipt must belong to this client");
  }

  const [existing] = await tx`select id from account_transactions where idempotency_key=${input.idempotencyKey}`;
  if (existing) return { id: existing.id as string, idempotent: true };

  const [row] = await tx`
    insert into account_transactions(
      account_id,client_id,transaction_type,amount,payment_method,transaction_reference,
      receipt_document_id,related_transaction_id,occurred_at,note,idempotency_key,recorded_by,source,trace_id
    ) values (
      ${account.id},${input.clientId},${input.type},${input.amount},${input.method ?? null},${input.reference ?? null},
      ${input.receiptDocumentId ?? null},${input.relatedTransactionId ?? null},${input.occurredAt},${input.note ?? null},
      ${input.idempotencyKey},${actor.staffId},'staff',${actor.traceId}
    ) returning id`;

  const [balance] = await tx`
    select balance,payment_status,total_paid,total_refunded from client_account_balances where client_id=${input.clientId}`;
  await logActivity(tx, {
    clientId: input.clientId,
    action: "payment_updated",
    actor,
    entityType: "account_transaction",
    entityId: row.id,
    newValue: {
      transaction_type: input.type,
      amount: input.amount,
      payment_method: input.method ?? null,
      transaction_reference: input.reference ?? null,
      balance: balance ? Number(balance.balance) : null,
      payment_status: balance?.payment_status ?? null,
    },
  });

  return {
    id: row.id as string,
    idempotent: false,
    balance: balance ? Number(balance.balance) : null,
    payment_status: balance?.payment_status ?? null,
  };
}
