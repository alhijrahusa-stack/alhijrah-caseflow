import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export type ClientAccountSummary = {
  fee_amount: number;
  total_paid: number;
  total_refunded: number;
  balance: number;
  payment_status: "unpaid" | "partially_paid" | "paid" | "overdue" | "refunded";
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
      select b.total_charged,b.total_paid,b.total_refunded,b.balance,b.payment_status,
             lp.payment_method,lp.occurred_at payment_date,
             coalesce(cs.total_commission,0) commission_amount,cs.commission_status,
             s.staff_code,s.display_name staff_name
        from client_account_balances b
        join client_accounts a on a.id=b.account_id
        left join lateral (
          select payment_method,occurred_at
            from account_transactions t
           where t.account_id=a.id and t.transaction_type='payment'
           order by occurred_at desc,created_at desc
           limit 1
        ) lp on true
        left join lateral (
          select sum(amount) total_commission,
                 case
                   when bool_or(status='paid') then 'paid'
                   when bool_or(status='approved') then 'approved'
                   when bool_or(status='eligible') then 'eligible'
                   when bool_or(status='pending') then 'pending'
                   else null end commission_status
            from commissions cm where cm.account_id=a.id and cm.status not in ('cancelled','reversed')
        ) cs on true
        left join staff s on s.id=a.assigned_staff
       where b.client_id=${clientId}`;
    if (!row) return null;
    return {
      fee_amount: Number(row.total_charged),
      total_paid: Number(row.total_paid),
      total_refunded: Number(row.total_refunded),
      balance: Number(row.balance),
      payment_status: row.payment_status,
      payment_method: row.payment_method as string | null,
      payment_date: row.payment_date ? String(row.payment_date) : null,
      commission_amount: Number(row.commission_amount),
      commission_status: row.commission_status as string | null,
      staff_code: row.staff_code as string | null,
      staff_name: row.staff_name as string | null,
    };
  });
}
