import Link from "next/link";
import { redirect } from "next/navigation";
import { StatusBadge } from "@/components/staff/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getStaffSession } from "@/lib/auth";
import { STATUS_LABELS, STATUSES } from "@/lib/domain";
import { dateOnly, dateTime, formatPhone } from "@/lib/format";
import { clientCities, clientList, staffDirectory } from "@/lib/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 25;

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const sp = await searchParams;
  const filters = {
    q: sp.q?.slice(0, 100) || undefined,
    status: (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined,
    city: sp.city || undefined,
    assigned: sp.assigned === "none" ? "none" : sp.assigned && UUID.test(sp.assigned) ? sp.assigned : undefined,
    appointment_date: sp.appointment_date && /^\d{4}-\d{2}-\d{2}$/.test(sp.appointment_date) ? sp.appointment_date : undefined,
    followup: sp.followup === "due" ? ("due" as const) : undefined,
    page: Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1),
    pageSize: PAGE_SIZE,
  };
  const [{ rows, total }, cities, staff] = await Promise.all([clientList(session, filters), clientCities(session), staffDirectory(session)]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v && k !== "page" && k !== "pageSize") p.set(k, String(v));
    p.set("page", String(page));
    return `?${p}`;
  };
  const filtered = Boolean(filters.q || filters.status || filters.city || filters.assigned || filters.appointment_date || filters.followup);

  return (
    <div className="ops-page space-y-4">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · CLIENT OPERATIONS</p>
          <h1>Clients</h1>
          <p>{total} active client file{total === 1 ? "" : "s"} · searchable operational record</p>
        </div>
        {session.staff.role !== "staff" && <Link href="/staff/new-client" className="ops-primary-button">+ New Client</Link>}
      </header>

      <form className="ops-glass-card flex flex-wrap items-end gap-2" role="search">
        <input name="q" defaultValue={filters.q} placeholder="Reference, name, phone or email" className="input w-64" aria-label="Search" />
        <select name="status" defaultValue={filters.status ?? ""} className="input w-52" aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select name="city" defaultValue={filters.city ?? ""} className="input w-40" aria-label="City">
          <option value="">All cities</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select name="assigned" defaultValue={filters.assigned ?? ""} className="input w-40" aria-label="Handled by">
          <option value="">Anyone</option>
          <option value="none">Unassigned</option>
          {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
        </select>
        <label className="text-xs text-slate-500">Appointment on
          <input type="date" name="appointment_date" defaultValue={filters.appointment_date} className="input w-40" />
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="followup" value="due" defaultChecked={filters.followup === "due"} /> Follow-up due
        </label>
        <button className="ops-primary-button">Apply</button>
        <Link href="/staff/clients" className="px-3 py-2 text-sm text-slate-500">Clear</Link>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No clients match these filters" : "No clients yet"}
          text={filtered ? "Change or clear the filters to see more clients." : "Applications from /apply and files created by the office appear here."}
          action={session.staff.role !== "staff" ? <Link href="/staff/new-client" className="ops-primary-button">+ New Client</Link> : undefined}
        />
      ) : (
        <div className="ops-glass-card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Reference</th><th>Name</th><th>Phone</th><th>Email</th><th>City</th><th>Status</th>
                <th>Next Step</th><th>Appointment</th><th>Follow-Up Date</th><th>Handled By</th><th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap font-mono text-xs"><Link href={`/staff/client/${c.id}`} className="text-brand-700 hover:underline">{c.ref}</Link></td>
                  <td><Link href={`/staff/client/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.full_name}</Link></td>
                  <td className="whitespace-nowrap">{formatPhone(c.phone)}</td>
                  <td>{c.email ?? "—"}</td>
                  <td>{c.city ?? "—"}</td>
                  <td><StatusBadge status={c.current_status} /></td>
                  <td className="max-w-xs">{c.next_step}</td>
                  <td className="whitespace-nowrap">{c.next_appointment ? dateTime(c.next_appointment) : "—"}</td>
                  <td className="whitespace-nowrap">{dateOnly(c.next_followup)}</td>
                  <td>{c.assigned_name ?? "Unassigned"}</td>
                  <td className="whitespace-nowrap text-slate-500">{dateTime(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className="flex items-center justify-between text-sm text-slate-500" aria-label="Pagination">
        <span data-testid="client-total">{total} client{total === 1 ? "" : "s"} · page {filters.page} of {pages}</span>
        <span className="flex gap-4">
          {filters.page > 1 && <Link href={qs(filters.page - 1)} className="text-brand-600">Previous</Link>}
          {filters.page < pages && <Link href={qs(filters.page + 1)} className="text-brand-600">Next</Link>}
        </span>
      </nav>
    </div>
  );
}
