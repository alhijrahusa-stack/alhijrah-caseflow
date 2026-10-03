import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { DOC_STATUS_LABELS, STATUS_LABELS, type DocStatus, type Status } from "@/lib/domain";
import { reports } from "@/lib/queries";

function Table({ title, rows, label, extra }: { title: string; rows: Record<string, unknown>[]; label: (r: Record<string, unknown>) => string; extra?: (r: Record<string, unknown>) => string }) {
  return (
    <section className="report-glass-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        <span className="rounded-full border border-white/[.08] bg-white/[.02] px-2.5 py-1 font-mono text-[10px] text-slate-400">{rows.length}</span>
      </div>
      {rows.length === 0 ? <p className="text-sm text-slate-500">No data.</p> : (
        <div className="overflow-x-auto">
          <table className="table">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}><td>{label(r)}</td><td className="text-right font-medium">{String(r.n)}</td>{extra && <td className="text-right text-slate-500">{extra(r)}</td>}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Counts straight from the database; nothing is estimated. */
export default async function ReportsPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") return <p className="ops-error" data-testid="forbidden">403 — Admin or manager only.</p>;
  const r = JSON.parse(JSON.stringify(await reports(session)));
  const last30 = Number(r.last30[0]?.n ?? 0);
  const statusTotal = r.byStatus.reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.n ?? 0), 0);
  const completed = r.byStatus.reduce((sum: number, row: Record<string, unknown>) => sum + (row.current_status === "completed" ? Number(row.n ?? 0) : 0), 0);
  const completionRate = statusTotal === 0 ? 0 : Math.round((completed / statusTotal) * 100);

  return (
    <div className="ops-page space-y-4">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · MANAGEMENT INTELLIGENCE</p>
          <h1>Reports</h1>
          <p>Live operational counts from the production database · no estimated values</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="ops-metric min-w-44">
            <span>New clients · 30 days</span>
            <strong data-testid="report-last30">{last30}</strong>
          </div>
          <div className="report-performance" aria-label={`Completed client ratio ${completionRate}%`}>
            <div className="report-performance-ring" style={{ "--value": completionRate } as React.CSSProperties}><strong>{completionRate}%</strong></div>
            <div className="report-performance-copy"><span>Completion performance</span><strong>{completed} of {statusTotal} client records</strong></div>
          </div>
        </div>
      </header>
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
