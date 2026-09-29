import Link from "next/link";
import { redirect } from "next/navigation";
import { CommandPalette } from "@/components/staff/CommandPalette";
import { ExecutiveTactileFeedback } from "@/components/staff/ExecutiveTactileFeedback";
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
import "../executive-tactile.css";

export const dynamic = "force-dynamic";

type NavIconName = "accounting" | "distribution" | "import" | "new-client";

function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="staff-nav-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "accounting" && (
        <>
          <rect x="3.5" y="6" width="17" height="12" rx="2.5" />
          <path d="M3.5 10h17M7 14h3" />
        </>
      )}
      {name === "distribution" && (
        <>
          <circle cx="6" cy="7" r="2.5" />
          <circle cx="18" cy="7" r="2.5" />
          <circle cx="12" cy="17" r="2.5" />
          <path d="M8.5 7h7M8.1 8.8l2.6 5.4M15.9 8.8l-2.6 5.4" />
        </>
      )}
      {name === "import" && (
        <>
          <path d="M12 3v11" />
          <path d="m8 10 4 4 4-4" />
          <path d="M5 17.5v1A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-1" />
        </>
      )}
      {name === "new-client" && (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20a5.5 5.5 0 0 1 11 0M18 8v6M15 11h6" />
        </>
      )}
    </svg>
  );
}

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");

  const [staff, counts] = await Promise.all([
    staffDirectory(session),
    dashboardCounts(session),
  ]);

  const mgmt = session.staff.role !== "staff";
  const alertCount = mgmt ? Number(counts.audit_alerts ?? 0) : 0;

  return (
    <StaffProvider
      me={{
        id: session.staff.id,
        display_name: session.staff.display_name,
        role: session.staff.role,
      }}
      staff={staff}
    >
      <ExecutiveTactileFeedback />

      <div className="staff-shell">
        <header className="staff-topbar sticky top-0 z-30">
          <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2 px-4 py-3 lg:px-6">
            <Link
              href="/staff"
              aria-label="Career Gate — بوابة التوظيف"
              className="staff-brand-link group mr-4 flex min-w-0 items-center gap-3.5"
            >
              <div className="staff-brand-mark">
                <img
                  src="https://rvhhtgbkktlqqcetymqs.supabase.co/storage/v1/object/public/company-logos/Carrer%20Logo.jpg"
                  alt=""
                  className="h-[38px] w-[38px] object-contain"
                />
                <span aria-hidden="true" className="staff-brand-edge" />
                <span aria-hidden="true" className="staff-brand-sheen" />
              </div>

              <div className="min-w-0 leading-none">
                <div className="flex items-center gap-2.5">
                  <strong className="staff-brand-title">CAREER GATE</strong>
                  <span aria-hidden="true" className="staff-brand-status" />
                </div>

                <div dir="rtl" className="mt-1.5 flex min-w-0 items-center gap-2">
                  <span className="staff-brand-ar">بوابة التوظيف</span>
                  <span aria-hidden="true" className="h-3 w-px shrink-0 bg-white/[0.12]" />
                  <span className="staff-brand-office">مكتب الهجرة — عبدالله المريسي</span>
                </div>

                <p className="staff-brand-meta">
                  {OFFICE.company} · {OFFICE.location}
                </p>
              </div>
            </Link>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2 max-sm:w-full">
              <QuickClientSearch />
              <CommandPalette />
              <RealtimeRefresher />

              {mgmt && (
                <Link
                  href="/staff/audit-alerts"
                  className="executive-control executive-control-alert relative"
                  aria-label="Audit alerts"
                >
                  Alerts
                  {alertCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 font-mono text-[9px] text-white">
                      {alertCount}
                    </span>
                  )}
                </Link>
              )}

              <div className="executive-session-cluster" role="group" aria-label="Profile and session management">
                <span className="executive-user-chip" data-testid="me">
                  <span className="executive-user-dot" />
                  <span className="max-w-32 truncate">{session.staff.display_name}</span>
                  <span className="executive-role-badge">{session.staff.role}</span>
                </span>

                <Link href="/staff?tab=settings" className="executive-control">
                  Settings
                </Link>

                {session.staff.role === "admin" && (
                  <Link href="/staff/settings/team" className="executive-control">
                    Roles
                  </Link>
                )}

                <SignOutButton />
              </div>
            </div>

            <nav className="staff-nav-strip" aria-label="Staff operations">
              <Link className="staff-nav-link" href="/staff">Dashboard</Link>
              <Link className="staff-nav-link" data-tone="blue" href="/staff/pipeline">Pipeline</Link>
              <Link className="staff-nav-link" href="/staff/clients">Clients</Link>
              <Link className="staff-nav-link" href="/staff/appointments">Appointments</Link>
              <Link className="staff-nav-link" href="/staff/tasks">Tasks</Link>
              <Link className="staff-nav-link" href="/staff/follow-ups">Follow-Ups</Link>
              {mgmt && <Link className="staff-nav-link" href="/staff/reports">Reports</Link>}

              {mgmt && <span className="staff-nav-divider" aria-hidden="true" />}

              {mgmt && (
                <Link className="staff-nav-link staff-nav-priority" data-tone="gold" href="/staff/accounting">
                  <NavIcon name="accounting" />
                  <span>Accounting</span>
                </Link>
              )}
              {mgmt && (
                <Link className="staff-nav-link staff-nav-priority" data-tone="cyan" href="/staff/distribution">
                  <NavIcon name="distribution" />
                  <span>Distribution</span>
                </Link>
              )}
              {mgmt && (
                <Link className="staff-nav-link staff-nav-priority" data-tone="violet" href="/staff/import">
                  <NavIcon name="import" />
                  <span>Import</span>
                </Link>
              )}

              {mgmt && <span className="staff-nav-divider" aria-hidden="true" />}

              {mgmt && (
                <Link className="staff-nav-link staff-nav-priority" data-tone="emerald" href="/staff/new-client">
                  <NavIcon name="new-client" />
                  <span>New Client</span>
                </Link>
              )}
            </nav>
          </div>
        </header>

        <main className="px-4 py-5 lg:px-6">{children}</main>
      </div>
    </StaffProvider>
  );
}
