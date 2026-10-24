"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function active(pathname: string, href: string) {
  return href === "/staff" ? pathname === "/staff" : pathname === href || pathname.startsWith(`${href}/`);
}

export function StaffNavigation({ management }: { management: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => setOpening(null), [pathname]);
  const item = (label: string, href: string) => (
    <Link
      key={href}
      className="staff-nav-link"
      data-executive-tactile="true"
      aria-current={active(pathname, href) ? "page" : undefined}
      href={href}
      prefetch={false}
      onMouseEnter={() => router.prefetch(href)}
      onFocus={() => router.prefetch(href)}
      onClick={() => setOpening(href)}
    >
      {label}{opening === href && !active(pathname,href) && <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-amber-300" aria-hidden="true" />}
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
      {management && item("Accounting", "/staff/accounting")}
      {management && item("Archive", "/staff/archive")}
      {management && item("Smart Career Collect Client", "/staff/import")}
      {management && <span className="staff-nav-divider" aria-hidden="true" />}
      {management && item("New Client", "/staff/new-client")}
    </nav>
  );
}
