import Link from "next/link";
import { StaffAppointmentAlerts } from "@/components/staff/StaffAppointmentAlerts";
import { MobileAppointmentCards } from "@/components/staff/MobileAppointmentCards";
import { DeferredAppointmentNotification } from "@/components/staff/DeferredAppointmentNotification";
import { redirect } from "next/navigation";
import { AppointmentRowActions } from "@/components/staff/sections/Work";
import { EmptyState } from "@/components/ui/EmptyState";
import { getStaffSession } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { appointmentList } from "@/lib/queries";

const VIEWS = [["upcoming", "Upcoming"], ["today", "Today"], ["past", "Past"], ["all", "All"]] as const;
const PAGE_SIZE = 25;

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const { view: v, page: rawPage } = await searchParams;
  const view = VIEWS.some(([k]) => k === v) ? v! : "upcoming";
  const requestedPage = Number(rawPage ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10000) : 1;
  const fetched = await appointmentList(session, view, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  const hasNext = fetched.length > PAGE_SIZE;
  const rows = JSON.parse(JSON.stringify(fetched.slice(0, PAGE_SIZE)));
  return (
    <div className="ops-page min-w-0 space-y-5">
      <header className="ops-hero flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="ops-kicker">CAREER GATE · SCHEDULING</p>
          <h1>Appointments <span className="text-amber-300">/ المواعيد</span></h1>
          <p>Page {page} · {rows.length} appointment{rows.length === 1 ? "" : "s"} shown · internal office calendar</p>
        </div>
        <nav className="grid w-full grid-cols-4 gap-2 text-sm sm:flex sm:w-auto" aria-label="Views">
          {VIEWS.map(([k, l]) => <Link key={k} href={`/staff/appointments?view=${k}`} aria-current={k === view ? "page" : undefined} className={k === view ? "flex min-h-11 items-center justify-center rounded-xl border border-amber-300/50 bg-amber-300/10 px-2 py-2 font-semibold text-amber-200" : "flex min-h-11 items-center justify-center rounded-xl border border-white/10 px-2 py-2 text-slate-300 transition-all duration-300 hover:border-sky-400/40 hover:bg-white/5"}>{l}</Link>)}
        </nav>
      </header>
      <StaffAppointmentAlerts />
      {rows.length === 0 ? (
        <EmptyState title="No appointments in this view" text="Open a client file and use Add Appointment to book the next free slot." action={<Link href="/staff/clients" className="text-sm text-brand-700 hover:underline">Go to clients</Link>} />
      ) : (
        <><MobileAppointmentCards appointments={rows}/><div className="ops-glass-card hidden min-w-0 overflow-x-auto lg:block rounded-2xl border border-sky-400/20 p-0 shadow-[0_20px_55px_rgba(0,0,0,.2)]">
          <table className="table w-full min-w-[900px]">
            <thead><tr><th>When</th><th>Client</th><th>Type</th><th>Location</th><th>Status</th><th>Booked by</th><th /></tr></thead>
            <tbody>
              {rows.map((a: Record<string, string>) => (
                <tr key={a.id} className="transition-all duration-300 hover:bg-sky-400/[.06]">
                  <td className="whitespace-nowrap">{dateTime(a.scheduled_at)}</td>
                  <td><Link href={`/staff/client/${a.client_id}`} className="text-brand-700 hover:underline">{a.full_name}</Link><span className="block font-mono text-xs text-slate-400">{a.ref}</span></td>
                  <td>{a.appointment_type}</td>
                  <td className="max-w-[260px] break-words text-sm leading-6">{a.location ?? "—"}</td>
                  <td><span className={a.status === "confirmed" ? "inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200" : "inline-flex rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-200"}>{a.status}</span></td>
                  <td>{a.created_by_name ?? "—"}</td>
                  <td><AppointmentRowActions appt={a} />{a.status === "confirmed" && <DeferredAppointmentNotification appointmentId={a.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></>
      )}
      {(page > 1 || hasNext) && (
        <nav aria-label="Appointment pages" className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={`/staff/appointments?view=${view}&page=${page - 1}`} className="inline-flex min-h-11 items-center rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white">Previous</Link>
          ) : <span />}
          <span className="text-sm text-slate-300">Page {page}</span>
          {hasNext ? (
            <Link href={`/staff/appointments?view=${view}&page=${page + 1}`} className="inline-flex min-h-11 items-center rounded-xl border border-amber-300/40 px-4 py-2 text-sm font-semibold text-amber-200">Next</Link>
          ) : <span />}
        </nav>
      )}
    </div>
  );
}
