import Link from "next/link";
import { redirect } from "next/navigation";
import { CommandPalette } from "@/components/staff/CommandPalette";
import { RealtimeRefresher } from "@/components/staff/RealtimeRefresher";
import { SignOutButton } from "@/components/staff/SignOutButton";
import { StaffProvider } from "@/components/staff/StaffContext";
import { getStaffSession } from "@/lib/auth";
import { OFFICE } from "@/lib/office";
import { staffDirectory } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const staff = await staffDirectory(session);
  const mgmt = session.staff.role !== "staff";
  const nav = [
    { href: "/staff", label: "Dashboard" },
    { href: "/staff/clients", label: "Clients" },
    { href: "/staff/appointments", label: "Appointments" },
    { href: "/staff/tasks", label: "Tasks" },
    { href: "/staff/follow-ups", label: "Follow-ups" },
    ...(mgmt ? [{ href: "/staff/audit-alerts", label: "Audit Alerts" }, { href: "/staff/reports", label: "Reports" }, { href: "/staff/settings/availability", label: "Availability" }] : []),
    ...(session.staff.role === "admin" ? [{ href: "/staff/settings/team", label: "Team" }] : []),
  ];
  return (
    <StaffProvider me={{ id: session.staff.id, display_name: session.staff.display_name, role: session.staff.role }} staff={staff}>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 lg:px-6">
          <Link href="/staff" className="font-semibold text-brand-700">{OFFICE.product} <span className="font-normal text-slate-400">Office</span></Link>
          <nav className="flex flex-wrap gap-4 text-sm" aria-label="Main">
            {nav.map((n) => <Link key={n.href} href={n.href} className="text-slate-600 hover:text-slate-900">{n.label}</Link>)}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <CommandPalette />
            <RealtimeRefresher />
            {mgmt && <Link href="/staff/new-client" className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700">+ New Client</Link>}
            <span className="text-slate-600" data-testid="me">{session.staff.display_name} <span className="text-xs uppercase text-slate-400">{session.staff.role}</span></span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="px-4 py-6 lg:px-6">{children}</main>
    </StaffProvider>
  );
}
