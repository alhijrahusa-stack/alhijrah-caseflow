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
import "../dashboard-luxury.css";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const [staff, counts] = await Promise.all([staffDirectory(session), dashboardCounts(session)]);
  const mgmt = session.staff.role !== "staff";
  const alertCount = mgmt ? Number(counts.audit_alerts ?? 0) : 0;
  const currentMember = staff.find((member) => member.id === session.staff.id);
  const staffCode = currentMember?.staff_code ?? "Staff";

  return (
    <StaffProvider me={{ id: session.staff.id, display_name: session.staff.display_name, role: session.staff.role }} staff={staff}>
      <div className="staff-shell">
        <header className="staff-topbar sticky top-0 z-30">
          <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2 px-4 py-3 lg:px-6">
            <Link href="/staff" className="staff-brand me-2 min-w-0" aria-label="Career Gate dashboard">
              <div className="flex items-center gap-2.5">
                <span className="staff-brand-mark" aria-hidden="true" />
                <strong className="staff-brand-title">CAREER GATE</strong>
              </div>
              <p className="staff-brand-subtitle hidden truncate sm:block">
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

            <div className="ms-auto flex flex-wrap items-center justify-end gap-2 max-sm:w-full">
              <QuickClientSearch />
              <CommandPalette />
              <RealtimeRefresher />
              {mgmt && (
                <Link href="/staff/audit-alerts" className="staff-header-action relative" aria-label="Audit alerts">
                  Alerts
                  {alertCount > 0 && <span className="ms-1.5 rounded-full bg-red-500 px-1.5 py-0.5 font-mono text-[10px] text-white">{alertCount}</span>}
                </Link>
              )}
              <span className="staff-user-badge hidden sm:flex" data-testid="me" aria-label={`Signed in as ${session.staff.display_name}`}>
                <span className="staff-user-avatar" aria-hidden="true">{session.staff.display_name.trim().slice(0, 1).toUpperCase()}</span>
                <span className="staff-user-copy">
                  <strong>{session.staff.display_name}</strong>
                  <small>{staffCode} · {session.staff.role}</small>
                </span>
              </span>
              <Link href="/staff?tab=settings" className="staff-header-action">Settings</Link>
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
