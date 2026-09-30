import { redirect } from "next/navigation";
import { OperationalDashboard } from "@/components/staff/OperationalDashboard";
import { getStaffSession } from "@/lib/auth";
import { dashboardCommandData } from "@/lib/operational-dashboard";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ tab?: string; period?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");

  const params = await searchParams;
  if (params.tab === "reports") redirect(`/staff/reports${params.period ? `?period=${params.period}` : ""}`);
  if (params.tab === "settings") redirect("/staff/settings");
  if (params.tab === "week") redirect("/staff/week");

  const data = await dashboardCommandData(session);
  return <OperationalDashboard data={data} />;
}
