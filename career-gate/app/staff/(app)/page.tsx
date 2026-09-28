import { redirect } from "next/navigation";
import { StaffDashboard } from "@/components/staff/StaffDashboard";
import { getStaffSession } from "@/lib/auth";
import { staffDashboard } from "@/lib/staff-dashboard";

export const dynamic = "force-dynamic";

type Tab = "today" | "week" | "reports" | "settings";
const TABS = new Set<Tab>(["today", "week", "reports", "settings"]);

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const params = await searchParams;
  const requested = params.tab as Tab | undefined;
  const initialTab: Tab = requested && TABS.has(requested) ? requested : "today";
  const data = await staffDashboard(session);

  return (
    <StaffDashboard
      data={JSON.parse(JSON.stringify(data))}
      initialTab={initialTab}
      meRole={session.staff.role}
    />
  );
}
