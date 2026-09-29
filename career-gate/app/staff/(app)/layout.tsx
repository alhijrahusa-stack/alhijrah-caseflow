import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CommandPalette } from "@/components/staff/CommandPalette";
import { ExecutiveTactileFX } from "@/components/staff/ExecutiveTactileFX";
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
import "../executive-upgrade.css";
import "../recent-clients-titanium.css";
import "../executive-tactile-v2.css";
import "../interaction-layer-fix.css";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const [staff, counts] = await Promise.all([staffDirectory(session), dashboardCounts(session)]);
  const mgmt = session.staff.role !== "staff";
  const alertCount = mgmt ? Number(counts.audit_alerts ?? 0) : 0;

  return (
    <StaffProvider me={{ id: session.staff.id, display_name: session.staff.display_name, role: session.staff.role }} staff={staff}>
      <ExecutiveTactileFX />
      <div className="staff-shell">
        <header className="staff-topbar sticky top-0 z-30">
          <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2 px-4 py-3 lg:px-6">
            <Link href="/staff" className="staff-brand-lockup mr-2 min-w-0" data-executive-tactile="true">
              <span className="staff-brand-mark" aria-hidden="true">
                <Image src="/brand/career-gate.webp" alt="" width={44} height={44} priority />
              </span>
              <span className="staff-brand-office" aria-hidden="true">
                <Image src="/brand/alhijrah-services.webp" alt="" width={36} height={36} priority />
              </span>
              <span className="staff-brand-copy min-w-0">
                <strong className="block truncate text-slate-100">CAREER GATE</strong>
                <p className="truncate">{OFFICE.company} · {OFFICE.location}</p>
              </span>
            </Link>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2 max-sm:w-full">
              <QuickClientSearch />
              <CommandPalette />
              <RealtimeRefresher />
              {mgmt && (
                <Link href="/staff/audit-alerts" className="relative rounded-xl border border-white/[.07] px-3 py-2 text-xs text-slate-400 hover:bg-white/[.04] hover:text-slate-100" aria-label="Audit alerts" data-executive-tactile="true">
                  Alerts
                  {alertCount > 0 && <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 font-mono text-[9px] text-white">{alertCount}</span>}
                </Link>
              )}
              <div className="staff-session-cluster">
                <span className="staff-session-chip hidden sm:flex" data-testid="me">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.7)]" />
                  <span className="max-w-32 truncate text-xs text-slate-200">{session.staff.display_name}</span>
                  <span className="text-[9px] uppercase tracking-wide text-slate-500">{session.staff.role}</span>
                </span>
                <Link href="/staff?tab=settings" className="staff-session-link" data-executive-tactile="true">Executive Profile</Link>
                <div data-executive-tactile="true"><SignOutButton /></div>
              </div>
            </div>

            <nav className="staff-nav-strip" aria-label="Staff operations">
              <Link className="staff-nav-link" href="/staff">Dashboard</Link>
              <Link className="staff-nav-link" data-tone="gold" href="/staff/pipeline">Pipeline</Link>
              <Link className="staff-nav-link" href="/staff/clients">Clients</Link>
              <Link className="staff-nav-link" href="/staff/appointments">Appointments</Link>
              <Link className="staff-nav-link" href="/staff/tasks">Tasks</Link>
              <Link className="staff-nav-link" href="/staff/follow-ups">Follow-Ups</Link>
              {mgmt && <Link className="staff-nav-link" href="/staff/reports">Reports</Link>}
              {mgmt && <span className="staff-nav-divider" aria-hidden="true" />}
              {mgmt && <Link className="staff-nav-link" data-tone="gold" data-executive-tactile="true" href="/staff/accounting">Accounting</Link>}
              {mgmt && <Link className="staff-nav-link" data-tone="cyan" data-executive-tactile="true" href="/staff/distribution">Distribution</Link>}
              {mgmt && <Link className="staff-nav-link" data-tone="violet" data-executive-tactile="true" href="/staff/import">Import</Link>}
              {mgmt && <span className="staff-nav-divider" aria-hidden="true" />}
              {mgmt && <Link className="staff-nav-link" data-tone="green" data-executive-tactile="true" href="/staff/new-client">New Client</Link>}
            </nav>
          </div>
        </header>
        <main className="px-4 py-5 lg:px-6">{children}</main>
      </div>
    </StaffProvider>
  );
}