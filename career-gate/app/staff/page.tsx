import Link from "next/link";
import { dashboardCounts } from "@/lib/queries";

const CARDS: { key: string; label: string; href: string }[] = [
  { key: "new_intake", label: "New Clients", href: "/staff/clients?status=new_intake" },
  { key: "needs_review", label: "Needs Review", href: "/staff/clients?status=needs_review" },
  { key: "ready_to_apply", label: "Ready to Apply", href: "/staff/clients?status=ready_to_apply" },
  { key: "application_in_progress", label: "Applications in Progress", href: "/staff/clients?status=application_in_progress" },
  { key: "appointments_today", label: "Appointments Today", href: "/staff/appointments?view=today" },
  { key: "screening_pending", label: "Screening Pending", href: "/staff/clients?status=screening_pending" },
  { key: "i9_available", label: "I-9 Available", href: "/staff/clients?status=i9_available" },
  { key: "followups_due", label: "Follow-ups Due", href: "/staff/follow-ups?view=due" },
  { key: "ready_for_first_day", label: "Ready for First Day", href: "/staff/clients?status=ready_for_first_day" },
];

export default async function Dashboard() {
  const counts = await dashboardCounts();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-semibold">Dashboard</h1>
        <form action="/staff/clients" className="flex gap-2">
          <input name="q" placeholder="Search client: reference, name, phone, email" className="input w-72" aria-label="Search client" />
          <button className="rounded-md bg-slate-800 px-4 py-2 text-sm text-white">Search Client</button>
        </form>
        <Link href="/staff/new-client" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">+ New Client</Link>
        <Link href="/staff/appointments" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm">Appointments</Link>
        <Link href="/staff/tasks" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm">Tasks</Link>
        <Link href="/staff/follow-ups" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm">Follow-ups</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {CARDS.map((c) => (
          <Link key={c.key} href={c.href} data-testid={`card-${c.key}`}
            className="rounded-lg border border-slate-200 bg-white p-4 transition-colors duration-200 hover:border-brand-500">
            <p className="text-sm text-slate-500">{c.label}</p>
            <p className="mt-1 text-3xl font-semibold" data-testid={`count-${c.key}`}>{counts[c.key] ?? 0}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
