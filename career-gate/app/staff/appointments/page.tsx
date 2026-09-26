import Link from "next/link";
import { AppointmentRowActions } from "@/components/staff/ClientFile";
import { dateTime } from "@/lib/format";
import { appointmentList } from "@/lib/queries";

const VIEWS = [["upcoming", "Upcoming"], ["today", "Today"], ["past", "Past"], ["all", "All"]] as const;

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view: v } = await searchParams;
  const view = VIEWS.some(([k]) => k === v) ? v! : "upcoming";
  const rows = JSON.parse(JSON.stringify(await appointmentList(view)));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">Appointments</h1>
        <nav className="flex gap-3 text-sm">
          {VIEWS.map(([k, l]) => (
            <Link key={k} href={`/staff/appointments?view=${k}`} className={k === view ? "font-semibold text-brand-700" : "text-slate-500"}>{l}</Link>
          ))}
        </nav>
        <p className="ml-auto text-sm text-slate-500">Add appointments from a Client File.</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="table">
          <thead><tr><th>When</th><th>Client</th><th>Type</th><th>Location</th><th>Status</th><th>Handled By</th><th /></tr></thead>
          <tbody>
            {rows.map((a: Record<string, string>) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap">{dateTime(a.scheduled_at)}</td>
                <td><Link href={`/staff/client/${a.client_id}`} className="text-brand-700 hover:underline">{a.full_name}</Link><span className="block font-mono text-xs text-slate-400">{a.ref}</span></td>
                <td>{a.appointment_type}</td>
                <td>{a.location ?? "—"}</td>
                <td>{a.status}</td>
                <td>{a.handled_by_name ?? "—"}</td>
                <td><AppointmentRowActions appt={a} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="py-8 text-center text-slate-500">No appointments.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
