import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export type ClientAccountSummary = {
  fee_amount: number;
  amount_paid: number;
  refund_amount: number;
  balance: number;
  payment_status: "unpaid" | "partially_paid" | "paid" | "refunded";
  payment_method: string | null;
  payment_date: string | null;
  commission_amount: number;
  commission_status: string | null;
  staff_code: string | null;
  staff_name: string | null;
} | null;

export async function clientAccountSummary(session: StaffSession, clientId: string): Promise<ClientAccountSummary> {
  return withStaff(session, async (tx) => {
    const [row] = await tx`
      select b.fee_amount,b.amount_paid,b.refund_amount,b.balance,b.payment_status,
             last_tx.payment_method,last_tx.payment_date,
             coalesce(cm.amount,0) commission_amount,cm.status commission_status,
             s.staff_code,s.display_name staff_name
      from client_account_balances b
      join client_accounts a on a.id=b.account_id
      left join lateral (
        select t.payment_method,(t.occurred_at at time zone 'America/Detroit')::date::text payment_date
        from payment_transactions t
        where t.account_id=a.id and t.transaction_type='payment' and t.status='confirmed'
        order by t.occurred_at desc,t.created_at desc limit 1
      ) last_tx on true
      left join commissions cm on cm.account_id=a.id and cm.trigger_event='account_paid'
      left join staff s on s.id=coalesce(cm.employee_id,a.commission_staff_id,a.assigned_staff)
      where a.client_id=${clientId}`;
    if (!row) return null;
    return {
      fee_amount: Number(row.fee_amount),
      amount_paid: Number(row.amount_paid),
      refund_amount: Number(row.refund_amount),
      balance: Number(row.balance),
      payment_status: row.payment_status as "unpaid" | "partially_paid" | "paid" | "refunded",
      payment_method: row.payment_method as string | null,
      payment_date: row.payment_date as string | null,
      commission_amount: Number(row.commission_amount),
      commission_status: row.commission_status as string | null,
      staff_code: row.staff_code as string | null,
      staff_name: row.staff_name as string | null,
    };
  });
}
