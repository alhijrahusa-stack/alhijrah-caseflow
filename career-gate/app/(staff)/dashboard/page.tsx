import type { Metadata } from "next";
import Link from "next/link";
import { StageBadge } from "@/components/StageBadge";
import { Card } from "@/components/ui/Card";
import { dateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { STAGE_LABELS, STAGES, TERMINAL, type Stage } from "@/lib/workflow/engine";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const db = await createClient();
  const now = new Date();
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);

  const [stageCounts, recent, appts, overdue] = await Promise.all([
    Promise.all(
      STAGES.filter((s) => !TERMINAL.has(s)).map(async (s) => {
        const { count } = await db.from("clients").select("id", { count: "exact", head: true }).eq("stage", s);
        return [s, count ?? 0] as const;
      }),
    ),
    db.from("clients").select("id, ref, first_name, last_name, stage, created_at")
      .order("created_at", { ascending: false }).limit(8),
    db.from("appointments").select("id, starts_at, kind, client_id, clients(ref, first_name, last_name)")
      .eq("status", "scheduled").gte("starts_at", now.toISOString()).lte("starts_at", dayEnd.toISOString())
      .order("starts_at"),
    db.from("tasks").select("id", { count: "exact", head: true })
      .eq("status", "open").lt("due_at", now.toISOString()),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {stageCounts.map(([s, n]) => (
          <Link key={s} href={`/clients?stage=${s}`} className="rounded-lg border border-slate-200 bg-white p-3 hover:border-brand-500">
            <p className="text-xs text-slate-500">{STAGE_LABELS[s]}</p>
            <p className="text-2xl font-semibold">{n}</p>
          </Link>
        ))}
        <Link href="/tasks" className="rounded-lg border border-red-200 bg-white p-3 hover:border-red-400">
          <p className="text-xs text-red-600">Overdue tasks</p>
          <p className="text-2xl font-semibold">{overdue.count ?? 0}</p>
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Today's appointments">
          {appts.data?.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {appts.data.map((a) => {
                const c = a.clients as unknown as { ref: string; first_name: string; last_name: string } | null;
                return (
                  <li key={a.id} className="flex justify-between py-2">
                    <Link href={`/clients/${a.client_id}`} className="font-medium hover:underline">
                      {c ? `${c.first_name} ${c.last_name}` : "—"}
                    </Link>
                    <span className="text-slate-500">{dateTime(a.starts_at)} · {a.kind.replace("_", " ")}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Nothing else scheduled today.</p>
          )}
        </Card>

        <Card title="Latest applications" actions={<Link href="/clients" className="text-sm text-brand-600">All</Link>}>
          <ul className="divide-y divide-slate-100 text-sm">
            {recent.data?.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <Link href={`/clients/${c.id}`} className="hover:underline">
                  <span className="font-medium">{c.first_name} {c.last_name}</span>{" "}
                  <span className="text-slate-400">{c.ref}</span>
                </Link>
                <StageBadge stage={c.stage as Stage} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
