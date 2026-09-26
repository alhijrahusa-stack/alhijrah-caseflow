import type { Metadata } from "next";
import Link from "next/link";
import { HandledBySelect, StaffProvider } from "@/components/staff/StaffContext";
import { OFFICE } from "@/lib/office";
import { staffDirectory } from "@/lib/queries";

export const metadata: Metadata = { title: "Office", robots: { index: false } };
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/staff", label: "Dashboard" },
  { href: "/staff/clients", label: "Clients" },
  { href: "/staff/appointments", label: "Appointments" },
  { href: "/staff/tasks", label: "Tasks" },
  { href: "/staff/follow-ups", label: "Follow-ups" },
];

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await staffDirectory();
  return (
    <StaffProvider staff={staff}>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 lg:px-6">
          <Link href="/staff" className="font-semibold text-brand-700">{OFFICE.product} <span className="font-normal text-slate-400">Office</span></Link>
          <nav className="flex flex-wrap gap-4 text-sm">
            {NAV.map((n) => <Link key={n.href} href={n.href} className="text-slate-600 hover:text-slate-900">{n.label}</Link>)}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/staff/new-client" className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">+ New Client</Link>
            <HandledBySelect />
          </div>
        </div>
      </header>
      <main className="px-4 py-6 lg:px-6">{children}</main>
    </StaffProvider>
  );
}
