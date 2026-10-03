"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function active(pathname: string, href: string) {
  return href === "/staff" ? pathname === "/staff" : pathname === href || pathname.startsWith(`${href}/`);
}

export function StaffNavigation({ management }: { management: boolean }) {
  const pathname = usePathname();
  const item = (label: string, href: string) => (
    <Link
      key={href}
      className="staff-nav-link"
      data-executive-tactile="true"
      aria-current={active(pathname, href) ? "page" : undefined}
      href={href}
    >
      {label}
    </Link>
  );

  return (
    <nav className="staff-nav-strip" aria-label="Staff operations">
      {item("Dashboard", "/staff")}
      {item("Pipeline", "/staff/pipeline")}
      {item("Clients", "/staff/clients")}
      {item("Gate Job Account", "/staff/gate-job-account")}
      {item("Appointments", "/staff/appointments")}
      {item("Tasks", "/staff/tasks")}
      {item("Follow-Ups", "/staff/follow-ups")}
      {item("Staff", "/staff/staff")}
      {management && item("Reports", "/staff/reports")}
      {management && <span className="staff-nav-divider" aria-hidden="true" />}
      {management && item("Accounting", "/staff/accounting")}
      {management && item("Import", "/staff/import")}
      {management && <span className="staff-nav-divider" aria-hidden="true" />}
      {management && item("New Client", "/staff/new-client")}
    </nav>
  );
}
