import { redirect } from "next/navigation";
import { AccountingBoard } from "@/components/staff/AccountingBoard";
import { getStaffSession } from "@/lib/auth";
import { accountingData, distributionData } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function AccountingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const clientParam = params.client;
  const initialClient = typeof clientParam === "string" && clientParam ? clientParam : null;
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") return <p className="ops-error">403 — Management access required.</p>;
  const [rows, distribution] = await Promise.all([accountingData(session), distributionData(session)]);
  return <AccountingBoard rows={rows} staff={distribution.staff} initialClient={initialClient} />;
}
