import type { Metadata } from "next";
import Link from "next/link";
import { StageBadge } from "@/components/StageBadge";
import { Card } from "@/components/ui/Card";
import { findJob, findSite, shiftLabel } from "@/lib/catalog";
import { dateTime, phone } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { isStage, STAGE_LABELS, STAGES, type Stage } from "@/lib/workflow/engine";

export const metadata: Metadata = { title: "Clients" };

const PAGE_SIZE = 50;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string; page?: string }>;
}) {
  const { q = "", stage, page = "1" } = await searchParams;
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const db = await createClient();

  let query = db
    .from("clients")
    .select("id, ref, first_name, last_name, phone, city, site_code, job_code, primary_shift, stage, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE - 1);

  if (isStage(stage)) query = query.eq("stage", stage);
  const term = q.trim().replace(/[%,()]/g, "");
  if (term) {
    const digits = term.replace(/\D/g, "");
    const ors = [`first_name.ilike.%${term}%`, `last_name.ilike.%${term}%`, `ref.ilike.%${term}%`];
    if (digits.length >= 3) ors.push(`phone.ilike.%${digits}%`);
    query = query.or(ors.join(","));
  }
  const { data: clients, count, error } = await query;

  const qs = (p: number) => `?${new URLSearchParams({ ...(q && { q }), ...(stage && { stage }), page: String(p) })}`;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Clients</h1>
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Name, ref or phone" className="input max-w-xs" />
        <select name="stage" defaultValue={stage ?? ""} className="input max-w-[14rem]">
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <button className="rounded-md bg-slate-800 px-4 py-2 text-sm text-white">Filter</button>
      </form>

      <Card>
        {error ? (
          <p className="text-sm text-red-600">{error.message}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Ref</th><th>Phone</th><th>Site / job</th><th>Shift</th><th>Stage</th><th>Applied</th></tr>
              </thead>
              <tbody>
                {clients?.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td><Link href={`/clients/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.first_name} {c.last_name}</Link></td>
                    <td className="font-mono text-xs">{c.ref}</td>
                    <td>{phone(c.phone)}</td>
                    <td>
                      {findSite(c.city, c.site_code)?.name ?? c.site_code}
                      <br />
                      <span className="text-slate-500">{findJob(c.city, c.site_code, c.job_code)?.title ?? c.job_code}</span>
                    </td>
                    <td>{shiftLabel(c.primary_shift)}</td>
                    <td><StageBadge stage={c.stage as Stage} /></td>
                    <td className="whitespace-nowrap text-slate-500">{dateTime(c.created_at)}</td>
                  </tr>
                ))}
                {!clients?.length && <tr><td colSpan={7} className="py-6 text-center text-slate-500">No clients found.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{count ?? 0} total</span>
        <span className="flex gap-4">
          {pageNum > 1 && <Link href={qs(pageNum - 1)} className="text-brand-600">Previous</Link>}
          {(count ?? 0) > pageNum * PAGE_SIZE && <Link href={qs(pageNum + 1)} className="text-brand-600">Next</Link>}
        </span>
      </div>
    </div>
  );
}
