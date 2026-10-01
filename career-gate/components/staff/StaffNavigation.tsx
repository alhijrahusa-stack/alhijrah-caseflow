"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef } from "react";

function active(pathname: string, href: string) {
  return href === "/staff" ? pathname === "/staff" : pathname === href || pathname.startsWith(`${href}/`);
}

type Tone = "gold" | "cyan" | "violet" | "green";

export function StaffNavigation({ management }: { management: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const prefetched = useRef(new Set<string>());

  function warm(href: string) {
    if (href === pathname || prefetched.current.has(href)) return;
    prefetched.current.add(href);
    router.prefetch(href);
  }

  const item = (label: string, href: string, tone?: Tone) => (
    <Link
      key={href}
      className="staff-nav-link"
      data-tone={tone}
      data-executive-tactile="true"
      aria-current={active(pathname, href) ? "page" : undefined}
      href={href}
      prefetch={false}
      onPointerEnter={() => warm(href)}
      onFocus={() => warm(href)}
      onClick={() => window.dispatchEvent(new CustomEvent("career-gate:navigation-start", { detail: { at: performance.now(), href } }))}
    >
      {label}
    </Link>
  );

  return (
    <nav className="staff-nav-strip" aria-label="Staff operations">
      {item("Dashboard", "/staff")}
      {item("Pipeline", "/staff/pipeline", "gold")}
      {item("Clients", "/staff/clients")}
      {item("Appointments", "/staff/appointments")}
      {item("Tasks", "/staff/tasks")}
      {item("Follow-Ups", "/staff/follow-ups")}
      {item("Staff", "/staff/staff", "cyan")}
      {management && item("Reports", "/staff/reports")}
      {management && <span className="staff-nav-divider" aria-hidden="true" />}
      {management && item("Accounting", "/staff/accounting", "gold")}
      {management && item("Import", "/staff/import", "violet")}
      {management && <span className="staff-nav-divider" aria-hidden="true" />}
      {management && item("New Client", "/staff/new-client", "green")}
    </nav>
  );
}
