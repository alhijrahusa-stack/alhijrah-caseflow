import { redirect } from "next/navigation";
import { StaffDashboard } from "@/components/staff/StaffDashboard";
import { getStaffSession } from "@/lib/auth";
import { staffDashboard, type DashboardPeriod, type DashboardTab } from "@/lib/staff-dashboard";

export const dynamic = "force-dynamic";

const TABS = new Set<DashboardTab>(["today", "week", "reports", "settings"]);
const PERIODS = new Set<DashboardPeriod>([7, 30, 90]);

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; period?: string }>;
}) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");

  const params = await searchParams;
  const requestedTab = params.tab as DashboardTab | undefined;
  const initialTab: DashboardTab = requestedTab && TABS.has(requestedTab) ? requestedTab : "today";

  const requestedPeriod = Number(params.period ?? 7) as DashboardPeriod;
  const initialPeriod: DashboardPeriod = PERIODS.has(requestedPeriod) ? requestedPeriod : 7;

  const data = await staffDashboard(session, initialTab, initialPeriod);

  return (
    <StaffDashboard
      data={JSON.parse(JSON.stringify(data))}
      initialTab={initialTab}
      initialPeriod={initialPeriod}
      meRole={session.staff.role}
    />
  );
}
