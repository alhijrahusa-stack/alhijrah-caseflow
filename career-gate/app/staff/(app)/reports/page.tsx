import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { DOC_STATUS_LABELS, STATUS_LABELS, type DocStatus, type Status } from "@/lib/domain";
import { reports } from "@/lib/queries";

function Table({ title, rows, label, extra }: { title: string; rows: Record<string, unknown>[]; label: (r: Record<string, unknown>) => string; extra?: (r: Record<string, unknown>) => string }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-slate-500">No data.</p> : (
        <table className="table">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}><td>{label(r)}</td><td className="text-right font-medium">{String(r.n)}</td>{extra && <td className="text-right text-slate-500">{extra(r)}</td>}</tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Counts straight from the database; nothing is estimated. */
export default async function ReportsPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="forbidden">403 — Admin or manager only.</p>;
  const r = JSON.parse(JSON.stringify(await reports(session)));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <p className="text-sm text-slate-500">New clients in the last 30 days: <strong data-testid="report-last30">{r.last30[0].n}</strong></p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Table title="Clients by status" rows={r.byStatus} label={(x) => STATUS_LABELS[x.current_status as Status]} />
        <Table title="Clients by source" rows={r.bySource} label={(x) => (x.source === "public_intake" ? "Online application" : "Office-created")} />
        <Table title="Clients by staff" rows={r.byStaff} label={(x) => String(x.name)} extra={(x) => `${x.ready_or_done} ready/completed`} />
        <Table title="Primary site preference" rows={r.bySite} label={(x) => String(x.site_name)} />
        <Table title="Documents by review state" rows={r.docs} label={(x) => DOC_STATUS_LABELS[x.status as DocStatus]} />
        <Table title="Open audit alerts" rows={r.alerts} label={(x) => String(x.severity)} />
      </div>
    </div>
  );
}
