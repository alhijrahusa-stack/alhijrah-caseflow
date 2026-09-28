import Link from "next/link";
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
  const serialized = JSON.parse(JSON.stringify(data));

  return (
    <>
      <div className="mx-auto mb-3 flex max-w-[1600px] justify-end">
        <Link
          href="/staff/clients?status=new_intake"
          data-testid="card-new_intake"
          className="staff-kpi inline-flex min-w-40 items-center justify-between gap-4 rounded-2xl px-4 py-3 transition hover:border-slate-400/30 hover:bg-white/[.04]"
        >
          <span className="text-xs text-slate-400">New Intake</span>
          <span data-testid="count-new_intake" className="font-mono text-lg font-semibold text-slate-100">{data.attention.new_clients}</span>
        </Link>
      </div>
      <StaffDashboard
        data={serialized}
        initialTab={initialTab}
        meRole={session.staff.role}
      />
    </>
  );
}
