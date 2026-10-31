import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertActions } from "@/components/staff/AlertActions";
import { RunAuditButton } from "@/components/staff/RunAuditButton";
import { RecoverSearchIndexButton } from "@/components/staff/RecoverSearchIndexButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { getStaffSession } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { auditAlertsPage } from "@/lib/queries";

const SEV: Record<string, string> = { critical: "bg-red-700", high: "bg-red-500", medium: "bg-amber-500", low: "bg-slate-400" };
const PAGE_SIZE = 50;

export default async function AuditAlertsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="forbidden">403 — Admin or manager only.</p>;
  const { status: s, page: rawPage } = await searchParams;
  const status = ["open", "resolved", "ignored"].includes(s ?? "") ? s! : "open";
  const result = await auditAlertsPage(session, status, Number(rawPage ?? "1"), PAGE_SIZE);
  const { total, page, pages } = result;
  const rows = JSON.parse(JSON.stringify(result.rows));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">Audit Alerts</h1>
        <nav className="flex flex-wrap gap-3 text-sm" aria-label="Alert status">
          {["open", "resolved", "ignored"].map((k) => <Link key={k} href={`/staff/audit-alerts?status=${k}`} aria-current={k === status ? "page" : undefined} className={k === status ? "font-semibold capitalize text-brand-700" : "capitalize text-slate-500"}>{k}</Link>)}
        </nav>
        <div className="ml-auto flex flex-wrap gap-2">{session.staff.role === "admin" && <RecoverSearchIndexButton />}<RunAuditButton /></div>
      </div>
      <p className="text-sm text-slate-500">Deterministic rules flag inconsistencies. Alerts never change client data.</p>
      <p data-testid="audit-alert-total" className="text-sm text-slate-500">{total} {status} alert{total === 1 ? "" : "s"} · Page {page} of {pages}</p>
      {rows.length === 0 ? <EmptyState title={`No ${status} alerts`} text="The rule scan runs after every change and daily." /> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead><tr><th>Severity</th><th>Client</th><th>Rule</th><th>Evidence</th><th>Recommended action</th><th>Created</th><th>{status === "open" ? "" : "Outcome"}</th></tr></thead>
            <tbody>
              {rows.map((a: Record<string, string>) => (
                <tr key={a.id} data-testid="alert-row" data-rule={a.rule}>
                  <td><span className={`rounded px-1.5 text-xs uppercase text-white ${SEV[a.severity]}`}>{a.severity}</span></td>
                  <td><Link href={`/staff/client/${a.client_id}`} className="text-brand-700 hover:underline">{a.full_name}</Link><span className="block font-mono text-xs text-slate-400">{a.ref}</span></td>
                  <td className="font-mono text-xs">{a.rule}<span className="block font-sans text-slate-600">{a.explanation}</span></td>
                  <td className="max-w-xs text-xs"><code className="break-all">{JSON.stringify(a.evidence)}</code></td>
                  <td>{a.recommended_action}</td>
                  <td className="whitespace-nowrap">{dateTime(a.created_at)}</td>
                  <td>{status === "open" ? <AlertActions id={a.id} clientId={a.client_id ?? null} /> : <span className="text-xs">{a.resolved_by_name ?? "System"} · {a.resolution_note}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="Audit alert pages" data-testid="audit-alert-pager" className="flex items-center justify-between gap-3">
          {page > 1 ? <Link className="ops-secondary-button" href={`/staff/audit-alerts?status=${status}&page=${page - 1}`}>Previous</Link> : <span />}
          <span className="text-sm text-slate-500">Page {page} of {pages}</span>
          {page < pages ? <Link className="ops-primary-button" href={`/staff/audit-alerts?status=${status}&page=${page + 1}`}>Next</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
