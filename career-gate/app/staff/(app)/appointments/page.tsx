import Link from "next/link";
import { redirect } from "next/navigation";
import { AppointmentRowActions } from "@/components/staff/sections/Work";
import { EmptyState } from "@/components/ui/EmptyState";
import { getStaffSession } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { appointmentList } from "@/lib/queries";

const VIEWS = [["upcoming", "Upcoming"], ["today", "Today"], ["past", "Past"], ["all", "All"]] as const;

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const { view: v } = await searchParams;
  const view = VIEWS.some(([k]) => k === v) ? v! : "upcoming";
  const rows = JSON.parse(JSON.stringify(await appointmentList(session, view)));
  return (
    <div className="ops-page space-y-4">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · SCHEDULING</p>
          <h1>Appointments</h1>
          <p>{rows.length} appointment{rows.length === 1 ? "" : "s"} in this view · internal office calendar</p>
        </div>
        <nav className="flex gap-3 text-sm" aria-label="Views">
          {VIEWS.map(([k, l]) => <Link key={k} href={`/staff/appointments?view=${k}`} aria-current={k === view ? "page" : undefined} className={k === view ? "font-semibold text-brand-700" : "text-slate-500"}>{l}</Link>)}
        </nav>
      </header>
      {rows.length === 0 ? (
        <EmptyState title="No appointments in this view" text="Open a client file and use Add Appointment to book the next free slot." action={<Link href="/staff/clients" className="text-sm text-brand-700 hover:underline">Go to clients</Link>} />
      ) : (
        <div className="ops-glass-card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>When</th><th>Client</th><th>Type</th><th>Location</th><th>Status</th><th>Booked by</th><th /></tr></thead>
            <tbody>
              {rows.map((a: Record<string, string>) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap">{dateTime(a.scheduled_at)}</td>
                  <td><Link href={`/staff/client/${a.client_id}`} className="text-brand-700 hover:underline">{a.full_name}</Link><span className="block font-mono text-xs text-slate-400">{a.ref}</span></td>
                  <td>{a.appointment_type}</td>
                  <td>{a.location ?? "—"}</td>
                  <td>{a.status}</td>
                  <td>{a.created_by_name ?? "—"}</td>
                  <td><AppointmentRowActions appt={a} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
