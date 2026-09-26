import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { findSite } from "@/lib/catalog";
import { money } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { STAGE_LABELS, STAGES, type Stage } from "@/lib/workflow/engine";

export const metadata: Metadata = { title: "Reports" };

const RANGES = { "30": 30, "90": 90, "365": 365 } as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days = "90" } = await searchParams;
  const span = RANGES[days as keyof typeof RANGES] ?? 90;
  const since = new Date(Date.now() - span * 86_400_000).toISOString();
  const db = await createClient();

  const [clients, payments] = await Promise.all([
    db.from("clients").select("stage, city, site_code").gte("created_at", since).limit(10_000),
    db.from("payments").select("amount_cents, method, status").gte("received_at", since).limit(10_000),
  ]);

  const byStage = new Map<Stage, number>();
  const bySite = new Map<string, { name: string; total: number; hired: number }>();
  for (const c of clients.data ?? []) {
    byStage.set(c.stage as Stage, (byStage.get(c.stage as Stage) ?? 0) + 1);
    const key = `${c.city}/${c.site_code}`;
    const row = bySite.get(key) ?? { name: findSite(c.city, c.site_code)?.name ?? c.site_code, total: 0, hired: 0 };
    row.total++;
    if (c.stage === "hired") row.hired++;
    bySite.set(key, row);
  }
  const totalApps = clients.data?.length ?? 0;
  const received = (payments.data ?? []).filter((p) => p.status === "received");
  const byMethod = new Map<string, number>();
  for (const p of received) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount_cents);
  const revenue = received.reduce((s, p) => s + p.amount_cents, 0);
  const truncated = totalApps === 10_000 || (payments.data?.length ?? 0) === 10_000;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <form className="flex gap-2 text-sm">
          <select name="days" defaultValue={String(span)} className="input">
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
          </select>
          <button className="rounded-md bg-slate-800 px-3 text-white">Apply</button>
        </form>
      </div>
      {truncated && <p className="text-sm text-amber-700">Row limit reached; figures are incomplete for this range.</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <Card title={`Applications by stage (${totalApps})`}>
          <ul className="space-y-2 text-sm">
            {STAGES.map((s) => {
              const n = byStage.get(s) ?? 0;
              return (
                <li key={s}>
                  <div className="flex justify-between"><span>{STAGE_LABELS[s]}</span><span>{n}</span></div>
                  <div className="h-2 rounded bg-slate-100">
                    <div className="h-2 rounded bg-brand-500" style={{ width: `${totalApps ? (n / totalApps) * 100 : 0}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title={`Payments received · ${money(revenue)}`}>
          <table className="table">
            <thead><tr><th>Method</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {[...byMethod].map(([m, c]) => (
                <tr key={m}><td className="capitalize">{m}</td><td className="text-right">{money(c)}</td></tr>
              ))}
              {!byMethod.size && <tr><td colSpan={2} className="text-slate-500">No payments in range.</td></tr>}
            </tbody>
          </table>
        </Card>

        <Card title="By site" className="md:col-span-2">
          <table className="table">
            <thead><tr><th>Site</th><th className="text-right">Applications</th><th className="text-right">Hired</th><th className="text-right">Hire rate</th></tr></thead>
            <tbody>
              {[...bySite.values()].sort((a, b) => b.total - a.total).map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="text-right">{r.total}</td>
                  <td className="text-right">{r.hired}</td>
                  <td className="text-right">{((r.hired / r.total) * 100).toFixed(0)}%</td>
                </tr>
              ))}
              {!bySite.size && <tr><td colSpan={4} className="text-slate-500">No applications in range.</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
