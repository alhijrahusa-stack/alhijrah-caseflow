import Link from "next/link";
import { redirect } from "next/navigation";
import { FollowupRowActions } from "@/components/staff/sections/Work";
import { EmptyState } from "@/components/ui/EmptyState";
import { getStaffSession } from "@/lib/auth";
import { dateOnly, dateTime, formatPhone } from "@/lib/format";
import { followupList } from "@/lib/queries";

const VIEWS = [["today", "Due Today"], ["upcoming", "Upcoming"], ["overdue", "Overdue"], ["completed", "Completed"]] as const;

export default async function FollowupsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const { view: v } = await searchParams;
  const views = v === "due" ? ["overdue", "today"] : [VIEWS.some(([k]) => k === v) ? v! : "today"];
  const lists = await Promise.all(views.map(async (k) => [k, JSON.parse(JSON.stringify(await followupList(session, k)))] as const));
  const total = lists.reduce((sum, [, rows]) => sum + rows.length, 0);
  return (
    <div className="ops-page space-y-4">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · FOLLOW-UP CONTROL</p>
          <h1>Follow-Ups</h1>
          <p>{total} follow-up item{total === 1 ? "" : "s"} in the selected view</p>
        </div>
        <nav className="flex gap-3 text-sm" aria-label="Views">
          <Link href="/staff/follow-ups?view=due" className={v === "due" ? "font-semibold text-brand-700" : "text-slate-500"}>All due</Link>
          {VIEWS.map(([k, l]) => <Link key={k} href={`/staff/follow-ups?view=${k}`} className={views.length === 1 && views[0] === k ? "font-semibold text-brand-700" : "text-slate-500"}>{l}</Link>)}
        </nav>
      </header>
      {lists.map(([k, rows]) => (
        <section key={k} className="ops-glass-card space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{VIEWS.find(([x]) => x === k)?.[1]}</h2>
            <span className="rounded-full border border-white/[.08] px-2.5 py-1 font-mono text-[10px] text-slate-400">{rows.length}</span>
          </div>
          {rows.length === 0 ? <EmptyState title="Nothing here" text="Follow-ups created from client files appear in these views." /> : (
            <div className="overflow-x-auto rounded-2xl border border-white/[.06]">
              <table className="table">
                <thead><tr><th>Due</th><th>Client</th><th>Phone</th><th>Reason</th><th>Created by</th><th>{k === "completed" ? "Completed" : ""}</th></tr></thead>
                <tbody>
                  {rows.map((f: Record<string, string>) => (
                    <tr key={f.id}>
                      <td className={`whitespace-nowrap ${k === "overdue" ? "font-medium text-red-600" : ""}`}>{dateOnly(f.due_date)}</td>
                      <td><Link href={`/staff/client/${f.client_id}`} className="text-brand-700 hover:underline">{f.full_name}</Link><span className="block font-mono text-xs text-slate-400">{f.ref}</span></td>
                      <td className="whitespace-nowrap">{formatPhone(f.phone)}</td>
                      <td>{f.reason}{f.completion_note && <span className="block text-xs text-slate-500">{f.completion_note}</span>}</td>
                      <td>{f.created_by_name ?? "—"}</td>
                      <td>{k === "completed" ? `${f.completed_by_name ?? "—"} · ${dateTime(f.completed_at)}` : <FollowupRowActions f={f} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
