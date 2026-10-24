import Link from "next/link";
import { dateOnly, dateTime } from "@/lib/format";
import type { WorkWindowData, WorkWindowItem, WorkWindowKind } from "@/lib/operational-work-window";

function WorkList({ title, href, items, total, dateOnlyFormat = false }: {
  title: string; href: string; items: WorkWindowItem[]; total: number; dateOnlyFormat?: boolean;
}) {
  return (
    <section className="ops-glass-card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-100">{title} <span className="text-amber-200 tabular-nums">({total})</span></h2>
        <Link className="text-sm text-amber-200 hover:underline" href={href}>Open all</Link>
      </div>
      {items.length === 0 ? <p className="text-sm text-slate-400">No outstanding items in this window.</p> : (
        <ol className="divide-y divide-white/10">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <Link href={item.clientId ? `/staff/client/${item.clientId}?tab=work` : href} className="font-semibold text-slate-100 hover:text-amber-200">{item.label}</Link>
                <p className="mt-1 text-xs text-slate-400">{item.clientName ?? "Office"}{item.clientRef ? ` · ${item.clientRef}` : ""}</p>
              </div>
              <span className={item.overdue ? "text-xs font-semibold text-red-300" : "text-xs text-slate-400"}>
                {item.overdue ? "Overdue · " : ""}{dateOnlyFormat ? dateOnly(item.due) : dateTime(item.due)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {items.length < total && <p className="text-xs text-slate-400">Showing {items.length} of {total}. Open all to continue.</p>}
    </section>
  );
}

export function OperationalWorkWindow({ kind, data }: { kind: WorkWindowKind; data: WorkWindowData }) {
  const today = kind === "today";
  return (
    <div className="ops-page space-y-5">
      <header className="ops-hero flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="ops-kicker">CAREER GATE · DAILY OPERATIONS</p>
          <h1>{today ? "Today" : "This Week"}</h1>
          <p>{today ? "Today's and overdue work" : "Current Detroit business week (Monday–Sunday) and overdue work"} · live, permission-scoped records.</p>
        </div>
        <nav className="flex gap-3 text-sm" aria-label="Work windows">
          <Link href="/staff/today" aria-current={today ? "page" : undefined} className={today ? "font-semibold text-amber-200" : "text-slate-300 hover:text-white"}>Today</Link>
          <Link href="/staff/week" aria-current={!today ? "page" : undefined} className={!today ? "font-semibold text-amber-200" : "text-slate-300 hover:text-white"}>Week</Link>
          <Link href="/staff" className="text-slate-300 hover:text-white">Dashboard</Link>
        </nav>
      </header>
      <div className="grid gap-4 xl:grid-cols-2">
        <WorkList title="Open Tasks Due" href="/staff/tasks" items={data.tasks} total={data.totals.tasks} />
        <WorkList title="Upcoming Appointments" href="/staff/appointments?view=upcoming" items={data.appointments} total={data.totals.appointments} />
        <WorkList title="Open Follow-Ups Due" href="/staff/follow-ups?view=due" items={data.followups} total={data.totals.followups} dateOnlyFormat />
      </div>
    </div>
  );
}
