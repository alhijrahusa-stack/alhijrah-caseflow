import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export type ClientAccountSummary = {
  fee_amount: number;
  payment_status: "pending" | "paid" | "refunded";
  payment_method: string | null;
  payment_date: string | null;
  commission_amount: number;
  staff_code: string | null;
  staff_name: string | null;
} | null;

export async function clientAccountSummary(session: StaffSession, clientId: string): Promise<ClientAccountSummary> {
  return withStaff(session, async (tx) => {
    const [row] = await tx`
      select a.fee_amount,a.payment_status,a.payment_method,a.payment_date,a.commission_amount,
             s.staff_code,s.display_name staff_name
      from client_accounts a
      left join staff s on s.id=coalesce(a.commission_staff_id,a.assigned_staff)
      where a.client_id=${clientId}`;
    if (!row) return null;
    return {
      fee_amount: Number(row.fee_amount),
      payment_status: row.payment_status as "pending" | "paid" | "refunded",
      payment_method: row.payment_method as string | null,
      payment_date: row.payment_date as string | null,
      commission_amount: Number(row.commission_amount),
      staff_code: row.staff_code as string | null,
      staff_name: row.staff_name as string | null,
    };
  });
}
