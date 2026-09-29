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
import "../executive-upgrade.css";
import "../recent-clients-titanium.css";

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
              <Link  
  href="/staff"  
  aria-label="Career Gate — بوابة التوظيف"  
  className="group mr-4 flex min-w-0 items-center gap-3.5"  
>  
  <div  
    className="  
      relative flex h-[52px] w-[52px] shrink-0 items-center justify-center  
      overflow-hidden rounded-[15px]  
      border border-white/[0.10]  
      bg-[linear-gradient(145deg,rgba(255,255,255,.08),rgba(255,255,255,.025))]  
      shadow-[0_12px_32px_rgba(0,0,0,.28),inset_0_1px_0_rgba(255,255,255,.10)]  
      transition-all duration-200  
      group-hover:border-amber-300/25  
      group-hover:bg-white/[0.055]  
    "  
  >  
    <img  
      src="https://rvhhtgbkktlqqcetymqs.supabase.co/storage/v1/object/public/company-logos/Carrer%20Logo.jpg"  
      alt=""  
      className="h-[38px] w-[38px] object-contain"  
    />  <span  
  aria-hidden="true"  
  className="  
    pointer-events-none absolute inset-x-2 bottom-0 h-px  
    bg-gradient-to-r from-transparent via-amber-300/55 to-transparent  
  "  
/>

  </div>    <div className="min-w-0">  
    <div className="flex items-center gap-2.5">  
      <strong  
        className="  
          truncate text-[13px] font-semibold  
          tracking-[0.18em] text-slate-100  
        "  
      >  
        CAREER GATE  
      </strong>  <span  
    aria-hidden="true"  
    className="h-1 w-1 shrink-0 rounded-full bg-amber-300/80"  
  />  
</div>  

<div  
  dir="rtl"  
  className="mt-1 flex min-w-0 items-center gap-2"  
>  
  <span className="whitespace-nowrap text-[12px] font-semibold text-slate-200">  
    بوابة التوظيف  
  </span>  

  <span  
    aria-hidden="true"  
    className="h-3 w-px shrink-0 bg-white/[0.12]"  
  />  

  <span className="truncate text-[10px] font-medium tracking-[0.01em] text-slate-500">  
    مكتب الهجرة — عبدالله المريسي  
  </span>  
</div>

  </div>  
</Link>

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

            <nav className="staff-nav-strip" aria-label="Staff operations">
              <Link className="staff-nav-link" href="/staff">Dashboard</Link>
              <Link className="staff-nav-link" data-tone="gold" href="/staff/pipeline">Pipeline</Link>
              <Link className="staff-nav-link" href="/staff/clients">Clients</Link>
              <Link className="staff-nav-link" href="/staff/appointments">Appointments</Link>
              <Link className="staff-nav-link" href="/staff/tasks">Tasks</Link>
              <Link className="staff-nav-link" href="/staff/follow-ups">Follow-Ups</Link>
              {mgmt && <Link className="staff-nav-link" href="/staff/reports">Reports</Link>}
              {mgmt && <span className="staff-nav-divider" aria-hidden="true" />}
              {mgmt && <Link className="staff-nav-link" data-tone="cyan" href="/staff/accounting">Accounting</Link>}
              {mgmt && <Link className="staff-nav-link" data-tone="cyan" href="/staff/distribution">Distribution</Link>}
              {mgmt && <Link className="staff-nav-link" data-tone="cyan" href="/staff/import">Import</Link>}
              {mgmt && <span className="staff-nav-divider" aria-hidden="true" />}
              {mgmt && <Link className="staff-nav-link" href="/staff/new-client">New Client</Link>}
            </nav>
          </div>
        </header>
        <main className="px-4 py-5 lg:px-6">{children}</main>
      </div>
    </StaffProvider>
  );
}
