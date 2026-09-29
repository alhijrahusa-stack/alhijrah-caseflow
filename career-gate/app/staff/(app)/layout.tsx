import Link from "next/link";
import { redirect } from "next/navigation";
import { CommandPalette } from "@/components/staff/CommandPalette";
import { QuickClientSearch } from "@/components/staff/QuickClientSearch";
import { RealtimeRefresher } from "@/components/staff/RealtimeRefresher";
import { SignOutButton } from "@/components/staff/SignOutButton";
import { StaffProvider } from "@/components/staff/StaffContext";
import { getStaffSession } from "@/lib/auth";
import { OFFICE } from "@/lib/office";
import { dashboardCounts, staffDirectory } from "@/lib/queries";
import "../operations.css";
import "../dispatcher.css";
import "../extras.css";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const [staff, counts] = await Promise.all([staffDirectory(session), dashboardCounts(session)]);
  const mgmt = session.staff.role !== "staff";
  const alertCount = mgmt ? Number(counts.audit_alerts ?? 0) : 0;

  return (
    <StaffProvider me={{ id: session.staff.id, display_name: session.staff.display_name, role: session.staff.role }} staff={staff}>
      <div className="staff-shell">
        <header className="staff-topbar sticky top-0 z-30">
          <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2 px-4 py-3 lg:px-6">
            <Link href="/staff" className="mr-2 min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-indigo-400 shadow-[0_0_18px_rgba(99,102,241,.7)]" />
                <strong className="tracking-[.08em] text-slate-100">CAREER GATE</strong>
              </div>
              <p className="mt-1 hidden truncate text-[10px] uppercase tracking-[.13em] text-slate-600 sm:block">
                {OFFICE.company} · {OFFICE.location}
              </p>
            </Link>

            <nav className="hidden items-center gap-1 lg:flex" aria-label="Staff operations">
              <Link className="staff-nav-link" href="/staff">Dashboard</Link>
              <Link className="staff-nav-link" data-tone="gold" href="/staff/pipeline">Pipeline</Link>
              {mgmt && <Link className="staff-nav-link" href="/staff/accounting">Accounting</Link>}
              {mgmt && <Link className="staff-nav-link" href="/staff/distribution">Distribution</Link>}
              {mgmt && <Link className="staff-nav-link" href="/staff/import">Import</Link>}
            </nav>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2 max-sm:w-full">
              <QuickClientSearch />
              <CommandPalette />
              <RealtimeRefresher />
              {mgmt && (
                <Link href="/staff/audit-alerts" className="relative rounded-xl border border-white/[.07] px-3 py-2 text-xs text-slate-400 hover:bg-white/[.04] hover:text-slate-100" aria-label="Audit alerts">
                  Alerts
                  {alertCount > 0 && <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 font-mono text-[9px] text-white">{alertCount}</span>}
                </Link>
              )}
              <span className="hidden items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2 text-xs sm:flex" data-testid="me">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="max-w-32 truncate text-slate-200">{session.staff.display_name}</span>
                <span className="text-[9px] uppercase tracking-wide text-slate-600">{session.staff.role}</span>
              </span>
              <Link href="/staff?tab=settings" className="rounded-xl border border-white/[.07] px-3 py-2 text-xs text-slate-400 hover:bg-white/[.04] hover:text-slate-100">Settings</Link>
              <SignOutButton />
            </div>

            <nav className="flex w-full items-center gap-1 overflow-x-auto lg:hidden" aria-label="Staff operations mobile">
              <Link className="staff-nav-link" href="/staff">Dashboard</Link>
              <Link className="staff-nav-link" data-tone="gold" href="/staff/pipeline">Pipeline</Link>
              {mgmt && <Link className="staff-nav-link" href="/staff/accounting">Accounting</Link>}
              {mgmt && <Link className="staff-nav-link" href="/staff/distribution">Distribution</Link>}
              {mgmt && <Link className="staff-nav-link" href="/staff/import">Import</Link>}
            </nav>
          </div>
        </header>
        <main className="px-4 py-5 lg:px-6">{children}</main>
      </div>
    </StaffProvider>
  );
}
