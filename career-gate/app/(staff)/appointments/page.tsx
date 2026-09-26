import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { dateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Appointments" };

type Row = {
  id: string;
  client_id: string;
  kind: string;
  starts_at: string;
  location: string | null;
  status: string;
  clients: { ref: string; first_name: string; last_name: string } | null;
};

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const past = show === "past";
  const db = await createClient();
  const now = new Date().toISOString();

  let q = db
    .from("appointments")
    .select("id, client_id, kind, starts_at, location, status, clients(ref, first_name, last_name)")
    .order("starts_at", { ascending: !past })
    .limit(200);
  q = past ? q.lt("starts_at", now) : q.gte("starts_at", now).eq("status", "scheduled");
  const { data, error } = await q.returns<Row[]>();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Appointments</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/appointments" className={past ? "text-slate-500" : "font-medium text-brand-700"}>Upcoming</Link>
          <Link href="/appointments?show=past" className={past ? "font-medium text-brand-700" : "text-slate-500"}>Past</Link>
        </div>
      </div>
      <Card>
        {error ? (
          <p className="text-sm text-red-600">{error.message}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>When</th><th>Client</th><th>Type</th><th>Location</th><th>Status</th></tr></thead>
              <tbody>
                {data?.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{dateTime(a.starts_at)}</td>
                    <td>
                      <Link href={`/clients/${a.client_id}`} className="text-brand-700 hover:underline">
                        {a.clients ? `${a.clients.first_name} ${a.clients.last_name}` : a.client_id}
                      </Link>
                    </td>
                    <td className="capitalize">{a.kind.replace("_", " ")}</td>
                    <td>{a.location ?? "—"}</td>
                    <td className="capitalize">{a.status.replace("_", " ")}</td>
                  </tr>
                ))}
                {!data?.length && <tr><td colSpan={5} className="py-6 text-center text-slate-500">None.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
