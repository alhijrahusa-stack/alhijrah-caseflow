import { redirect } from "next/navigation";
import { AccountingBoard } from "@/components/staff/AccountingBoard";
import { getStaffSession } from "@/lib/auth";
import { accountingData, parseAccountingFilters, staffDirectory } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function AccountingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") return <p className="ops-error">403 — Management access required.</p>;
  const filters = parseAccountingFilters(params);
  const [data, staff] = await Promise.all([accountingData(session, filters), staffDirectory(session)]);
  return <AccountingBoard data={data} filters={filters} staff={staff} />;
}
