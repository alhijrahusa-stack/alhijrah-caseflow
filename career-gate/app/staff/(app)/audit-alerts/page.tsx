import { StaffLabel } from "@/components/staff/StaffLabel";
import { StaffText } from "@/components/staff/StaffLanguage";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertActions } from "@/components/staff/AlertActions";
import { RunAuditButton } from "@/components/staff/RunAuditButton";
import { RecoverSearchIndexButton } from "@/components/staff/RecoverSearchIndexButton";
import { StaffEmptyState, StaffNav } from "@/components/staff/StaffPageLabels";
import { getStaffSession } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { auditAlertsPage } from "@/lib/queries";

const SEV: Record<string, string> = { critical: "bg-red-700", high: "bg-red-500", medium: "bg-amber-500", low: "bg-slate-400" };
const PAGE_SIZE = 50;

export default async function AuditAlertsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="forbidden"><StaffText en="403 — Admin or manager only." ar="403 — متاح للمسؤول أو المدير فقط."/></p>;
  const { status: s, page: rawPage } = await searchParams;
  const status = ["open", "resolved", "ignored"].includes(s ?? "") ? s! : "open";
  const result = await auditAlertsPage(session, status, Number(rawPage ?? "1"), PAGE_SIZE);
  const { total, page, pages } = result;
  const rows = JSON.parse(JSON.stringify(result.rows));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold"><StaffText en="Audit Alerts" ar="تنبيهات التدقيق"/></h1>
        <StaffNav className="flex flex-wrap gap-3 text-sm" aria-label="Alert status" ariaLabelAr="حالة التنبيهات">
          {["open", "resolved", "ignored"].map((k) => <Link key={k} href={`/staff/audit-alerts?status=${k}`} aria-current={k === status ? "page" : undefined} className={k === status ? "font-semibold capitalize text-brand-700" : "capitalize text-slate-500"}><StaffLabel en={k}/></Link>)}
        </StaffNav>
        <div className="ml-auto flex flex-wrap gap-2">{session.staff.role === "admin" && <RecoverSearchIndexButton />}<RunAuditButton /></div>
      </div>
      <p className="text-sm text-slate-500"><StaffText en="Deterministic rules flag inconsistencies. Alerts never change client data." ar="تكشف قواعد التدقيق تناقضات البيانات؛ ولا تعدّل التنبيهات بيانات العملاء."/></p>
      <p data-testid="audit-alert-total" className="text-sm text-slate-500"><StaffText en={`${total} ${status} alert${total === 1 ? "" : "s"} · Page ${page} of ${pages}`} ar={`${total} تنبيه ${status === "open" ? "مفتوح" : status === "resolved" ? "تمت معالجته" : "متجاهَل"} · الصفحة ${page} من ${pages}`}/></p>
      {rows.length === 0 ? <StaffEmptyState title={`No ${status} alerts`} titleAr={`لا توجد تنبيهات ${status === "open" ? "مفتوحة" : status === "resolved" ? "معالجة" : "متجاهَلة"}`} text="The rule scan runs after every change and daily." textAr="يعمل فحص القواعد بعد كل تغيير وبصورة يومية." /> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead><tr><th><StaffText en="Severity" ar="الخطورة"/></th><th><StaffText en="Client" ar="العميل"/></th><th><StaffText en="Rule" ar="القاعدة"/></th><th><StaffText en="Evidence" ar="الأدلة"/></th><th><StaffText en="Recommended action" ar="الإجراء المقترح"/></th><th><StaffText en="Created" ar="تاريخ الإنشاء"/></th><th>{status === "open" ? "" : <StaffText en="Outcome" ar="النتيجة"/>}</th></tr></thead>
            <tbody>
              {rows.map((a: Record<string, string>) => (
                <tr key={a.id} data-testid="alert-row" data-rule={a.rule}>
                  <td><span className={`rounded px-1.5 text-xs uppercase text-white ${SEV[a.severity]}`}><StaffLabel en={a.severity}/></span></td>
                  <td><Link href={`/staff/client/${a.client_id}`} className="text-brand-700 hover:underline">{a.full_name}</Link><span className="block font-mono text-xs text-slate-400">{a.ref}</span></td>
                  <td className="font-mono text-xs">{a.rule}<span className="block font-sans text-slate-600"><StaffLabel en={a.explanation}/></span></td>
                  <td className="max-w-xs text-xs"><code className="break-all">{JSON.stringify(a.evidence)}</code></td>
                  <td><StaffLabel en={a.recommended_action}/></td>
                  <td className="whitespace-nowrap">{dateTime(a.created_at)}</td>
                  <td>{status === "open" ? <AlertActions id={a.id} clientId={a.client_id ?? null} /> : <span className="text-xs">{a.resolved_by_name ?? <StaffLabel en="System"/>} · {a.resolution_note}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <StaffNav aria-label="Audit alert pages" ariaLabelAr="صفحات تنبيهات التدقيق" data-testid="audit-alert-pager" className="flex items-center justify-between gap-3">
          {page > 1 ? <Link className="ops-secondary-button" href={`/staff/audit-alerts?status=${status}&page=${page - 1}`}><StaffText en="Previous" ar="السابق"/></Link> : <span />}
          <span className="text-sm text-slate-500"><StaffText en="Page" ar="الصفحة"/> {page} <StaffText en="of" ar="من"/> {pages}</span>
          {page < pages ? <Link className="ops-primary-button" href={`/staff/audit-alerts?status=${status}&page=${page + 1}`}><StaffText en="Next" ar="التالي"/></Link> : <span />}
        </StaffNav>
      )}
    </div>
  );
}
