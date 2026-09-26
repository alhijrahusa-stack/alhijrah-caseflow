import Link from "next/link";
import { StatusBadge } from "@/components/staff/StatusBadge";
import { STATUS_LABELS, STATUSES } from "@/lib/domain";
import { dateOnly, dateTime, formatPhone } from "@/lib/format";
import { clientCities, clientList, staffDirectory } from "@/lib/queries";

const UUID = /^[0-9a-f-]{36}$/i;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const filters = {
    q: sp.q?.slice(0, 100),
    status: (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined,
    city: sp.city || undefined,
    handled_by: sp.handled_by && UUID.test(sp.handled_by) ? sp.handled_by : undefined,
    appointment_date: sp.appointment_date && /^\d{4}-\d{2}-\d{2}$/.test(sp.appointment_date) ? sp.appointment_date : undefined,
    followup: sp.followup === "due" ? "due" : undefined,
  };
  const [rows, cities, staff] = await Promise.all([clientList(filters), clientCities(), staffDirectory()]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Clients</h1>
      <form className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <input name="q" defaultValue={filters.q} placeholder="Reference, name, phone or email" className="input w-64" aria-label="Search" />
        <select name="status" defaultValue={filters.status ?? ""} className="input w-52" aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select name="city" defaultValue={filters.city ?? ""} className="input w-40" aria-label="City">
          <option value="">All cities</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select name="handled_by" defaultValue={filters.handled_by ?? ""} className="input w-40" aria-label="Handled by">
          <option value="">Anyone</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="text-xs text-slate-500">Appointment on
          <input type="date" name="appointment_date" defaultValue={filters.appointment_date} className="input w-40" />
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="followup" value="due" defaultChecked={filters.followup === "due"} /> Follow-up due
        </label>
        <button className="rounded-md bg-slate-800 px-4 py-2 text-sm text-white">Apply</button>
        <Link href="/staff/clients" className="px-2 py-2 text-sm text-slate-500">Clear</Link>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="table">
          <thead>
            <tr>
              <th>Reference</th><th>Client Name</th><th>Phone</th><th>Email</th><th>City</th><th>Current Status</th>
              <th>Next Step</th><th>Appointment</th><th>Follow-up Date</th><th>Handled By</th><th>Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap font-mono text-xs"><Link href={`/staff/client/${c.id}`} className="text-brand-700 hover:underline">{c.ref}</Link></td>
                <td><Link href={`/staff/client/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.full_name}</Link></td>
                <td className="whitespace-nowrap">{formatPhone(c.phone)}</td>
                <td>{c.email ?? "—"}</td>
                <td>{c.city ?? "—"}</td>
                <td><StatusBadge status={c.current_status} /></td>
                <td className="max-w-xs">{c.next_step}</td>
                <td className="whitespace-nowrap">{c.next_appointment ? dateTime(c.next_appointment) : "—"}</td>
                <td className="whitespace-nowrap">{dateOnly(c.next_followup)}</td>
                <td>{c.handled_by_name ?? "—"}</td>
                <td className="whitespace-nowrap text-slate-500">{dateTime(c.updated_at)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={11} className="py-8 text-center text-slate-500">No clients match.</td></tr>}
          </tbody>
        </table>
      </div>
      {rows.length === 200 && <p className="text-sm text-slate-500">Showing the 200 most recently updated matches. Narrow the search to see others.</p>}
    </div>
  );
}
