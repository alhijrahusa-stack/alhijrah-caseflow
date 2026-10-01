import { redirect } from "next/navigation";
import { AccountingLedgerBoard } from "@/components/staff/AccountingLedgerBoard";
import { getStaffSession } from "@/lib/auth";
import { accountLedgerData } from "@/lib/finance";

export const dynamic = "force-dynamic";

export default async function AccountingPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") return <p className="ops-error">403 — Management access required.</p>;
  const rows = await accountLedgerData(session);
  return <AccountingLedgerBoard rows={rows} />;
}
