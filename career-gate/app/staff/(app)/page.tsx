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
  if (params.tab === "today") redirect("/staff/today");
  if (params.tab === "week") redirect("/staff/week");

  const started = performance.now();
  try {
    const data = await dashboardCommandData(session);
    const duration = Math.round(performance.now() - started);
    if (duration > 2000) console.warn(JSON.stringify({ event: "slow_dashboard_load", duration_ms: duration }));
    return <OperationalDashboard data={data} />;
  } catch (cause) {
    console.error(JSON.stringify({ event: "dashboard_load_failed", duration_ms: Math.round(performance.now() - started), error_type: cause instanceof Error ? cause.name : "Unknown" }));
    throw cause;
  }
}
