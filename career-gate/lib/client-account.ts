import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";
import { LEDGER_JSON, normalizeLedger, type PaymentTransactionRow } from "@/lib/accounting-ledger-read";
import { BALANCE_NET_FEE, CLIENT_FIELD, DISCOUNT_AMOUNT } from "@/lib/accounting-schema";

export type ClientAccountSummary = {
  fee_amount: number;
  discount_amount: number;
  net_fee: number;
  amount_paid: number;
  refund_amount: number;
  balance: number;
  payment_status: "unpaid" | "partially_paid" | "paid" | "refunded";
  payment_method: string | null;
  payment_date: string | null;
  discount_reason: string | null;
  discount_input_type: "amount" | "percentage" | null;
  discount_input_value: number | null;
  /** False for a non-management session, where the ledger detail is withheld. */
  amount_paid_visible: boolean;
  commission_amount: number;
  commission_status: string | null;
  /** The commission owner: the employee who completed the application, or null. */
  staff_code: string | null;
  staff_name: string | null;
  application_status: string;
  application_completed_by: string | null;
  application_completed_name: string | null;
  application_completed_at: string | null;
  /** The canonical ledger, newest first — the same rows Accounting renders. */
  transactions: PaymentTransactionRow[];
} | null;

export async function clientAccountSummary(session: StaffSession, clientId: string): Promise<ClientAccountSummary> {
  return withStaff(session, async (tx) => {
    const [row] = await tx`
      select b.fee_amount,${tx.unsafe(DISCOUNT_AMOUNT("b"))} discount_amount,${tx.unsafe(BALANCE_NET_FEE("b"))} net_fee,
             b.amount_paid,b.refund_amount,b.balance,b.payment_status,
             ${tx.unsafe(`to_jsonb(a)->>'discount_reason'`)} discount_reason,
             ${tx.unsafe(`to_jsonb(a)->>'discount_input_type'`)} discount_input_type,
             ${tx.unsafe(`(to_jsonb(a)->>'discount_input_value')::numeric`)} discount_input_value,
             coalesce(tr.transactions,'[]'::jsonb) transactions,
             last_tx.payment_method,last_tx.payment_date,
             coalesce(cm.amount,0) commission_amount,cm.status commission_status,
             owner.staff_code,owner.display_name staff_name,
             ${tx.unsafe(CLIENT_FIELD("c", "application_status"))} application_status,
             ${tx.unsafe(CLIENT_FIELD("c", "application_completed_by"))} application_completed_by,
             completer.display_name application_completed_name,
             ${tx.unsafe(`${CLIENT_FIELD("c", "application_completed_at")}::timestamptz::date::text`)} application_completed_at
      from client_account_balances b
      join client_accounts a on a.id=b.account_id
      join clients c on c.id=a.client_id
      left join lateral (
        select t.payment_method,t.occurred_at::date::text payment_date
        from payment_transactions t
        where t.account_id=a.id and t.transaction_type='payment' and t.status='confirmed'
        order by t.occurred_at desc,t.created_at desc limit 1
      ) last_tx on true
      left join lateral (${tx.unsafe(LEDGER_JSON("a"))}) tr on true
      left join commissions cm on cm.account_id=a.id and cm.trigger_event='account_paid'
      -- The commission owner is read from the commission itself. There is no
      -- fallback to the current assignment: showing the assigned staff member
      -- where no commission exists would name the wrong earner.
      left join staff owner on owner.id=cm.employee_id
      left join staff completer on completer.id=${tx.unsafe(CLIENT_FIELD("c", "application_completed_by"))}::uuid
      where a.client_id=${clientId}`;
    if (!row) return null;
    // Commission is compensation data and the Accounting screen is management-only,
    // so the ledger detail is withheld from a non-management session rather than
    // merely hidden in the markup, where it would still reach the page payload.
    const management = session.staff.role === "admin" || session.staff.role === "manager";
    return {
      fee_amount: Number(row.fee_amount),
      discount_amount: Number(row.discount_amount),
      net_fee: Number(row.net_fee),
      amount_paid: Number(row.amount_paid),
      refund_amount: Number(row.refund_amount),
      balance: Number(row.balance),
      payment_status: row.payment_status as "unpaid" | "partially_paid" | "paid" | "refunded",
      payment_method: row.payment_method as string | null,
      payment_date: row.payment_date as string | null,
      discount_reason: row.discount_reason as string | null,
      discount_input_type: (row.discount_input_type as "amount" | "percentage" | null) ?? null,
      discount_input_value: row.discount_input_value == null ? null : Number(row.discount_input_value),
      transactions: management ? normalizeLedger(row.transactions) : [],
      amount_paid_visible: management,
      commission_amount: management ? Number(row.commission_amount) : 0,
      commission_status: management ? (row.commission_status as string | null) : null,
      staff_code: management ? (row.staff_code as string | null) : null,
      staff_name: management ? (row.staff_name as string | null) : null,
      application_status: String(row.application_status ?? "not_started"),
      application_completed_by: row.application_completed_by as string | null,
      application_completed_name: row.application_completed_name as string | null,
      application_completed_at: row.application_completed_at as string | null,
    };
  });
}
