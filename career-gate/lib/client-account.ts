import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

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
  commission_amount: number;
  commission_status: string | null;
  /** The commission owner: the employee who completed the application, or null. */
  staff_code: string | null;
  staff_name: string | null;
  application_status: string;
  application_completed_by: string | null;
  application_completed_name: string | null;
  application_completed_at: string | null;
} | null;

export async function clientAccountSummary(session: StaffSession, clientId: string): Promise<ClientAccountSummary> {
  return withStaff(session, async (tx) => {
    const [row] = await tx`
      select b.fee_amount,b.discount_amount,b.net_fee,b.amount_paid,b.refund_amount,b.balance,b.payment_status,
             a.discount_reason,
             last_tx.payment_method,last_tx.payment_date,
             coalesce(cm.amount,0) commission_amount,cm.status commission_status,
             owner.staff_code,owner.display_name staff_name,
             c.application_status,c.application_completed_by,
             completer.display_name application_completed_name,
             (c.application_completed_at at time zone 'America/Detroit')::date::text application_completed_at
      from client_account_balances b
      join client_accounts a on a.id=b.account_id
      join clients c on c.id=a.client_id
      left join lateral (
        select t.payment_method,(t.occurred_at at time zone 'America/Detroit')::date::text payment_date
        from payment_transactions t
        where t.account_id=a.id and t.transaction_type='payment' and t.status='confirmed'
        order by t.occurred_at desc,t.created_at desc limit 1
      ) last_tx on true
      left join commissions cm on cm.account_id=a.id and cm.trigger_event='account_paid'
      -- The commission owner is read from the commission itself. There is no
      -- fallback to the current assignment: showing the assigned staff member
      -- where no commission exists would name the wrong earner.
      left join staff owner on owner.id=cm.employee_id
      left join staff completer on completer.id=c.application_completed_by
      where a.client_id=${clientId}`;
    if (!row) return null;
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
      commission_amount: Number(row.commission_amount),
      commission_status: row.commission_status as string | null,
      staff_code: row.staff_code as string | null,
      staff_name: row.staff_name as string | null,
      application_status: String(row.application_status ?? "not_started"),
      application_completed_by: row.application_completed_by as string | null,
      application_completed_name: row.application_completed_name as string | null,
      application_completed_at: row.application_completed_at as string | null,
    };
  });
}
