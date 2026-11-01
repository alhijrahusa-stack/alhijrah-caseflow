import { StaffLabel } from "@/components/staff/StaffLabel";
import { arabicStaffLabel } from "@/lib/staff-ui-labels";
import { StaffText } from "@/components/staff/StaffLanguage";
import Link from "next/link";
import { StaffNav } from "@/components/staff/StaffPageLabels";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { SendToManagerButton } from "@/components/staff/SendToManagerButton";
import { DOC_STATUS_LABELS, STATUS_LABELS, type DocStatus, type Status } from "@/lib/domain";
import { parseReportPeriod, percentChange, REPORT_PERIODS, reportIntelligence, STALL_DAYS, type CountRow, type Insight, type ReportIntelligence, type ReportPeriod } from "@/lib/reports";

export const dynamic = "force-dynamic";

const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function Table({ title, rows, label, extra }: { title: string; rows: (CountRow | { name: string; n: number; ready_or_done: number })[]; label: (r: never) => React.ReactNode; extra?: (r: never) => React.ReactNode }) {
  return (
    <section className="report-glass-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-100"><StaffLabel en={title}/></h2>
        <span className="rounded-full border border-white/[.08] bg-white/[.02] px-2.5 py-1 font-mono text-[10px] text-slate-400">{rows.length}</span>
      </div>
      {rows.length === 0 ? <p className="text-sm text-slate-500"><StaffText en="No data." ar="لا توجد بيانات."/></p> : (
        <div className="overflow-x-auto">
          <table className="table">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}><td>{label(r as never)}</td><td className="text-right font-medium tabular-nums">{String(r.n)}</td>{extra && <td className="text-right text-slate-500">{extra(r as never)}</td>}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Delta({ current, previous, inverse = false }: { current: number; previous: number; inverse?: boolean }) {
  const change = percentChange(current, previous);
  if (change === null) return <span className="text-xs text-slate-500"><StaffText en="no prior period" ar="لا توجد فترة سابقة"/></span>;
  const good = inverse ? change < 0 : change > 0;
  const tone = change === 0 ? "text-slate-400" : good ? "text-emerald-300" : "text-rose-300";
  return <span className={`text-xs font-semibold tabular-nums ${tone}`}>{change > 0 ? "▲" : change < 0 ? "▼" : "■"} {Math.abs(change)}<StaffText en="% vs prior" ar="% مقارنة بالفترة السابقة"/></span>;
}

function Kpi({ label, value, children, testId }: { label: React.ReactNode; value: string | number; children?: React.ReactNode; testId?: string }) {
  return (
    <div className="ops-metric min-w-0">
      <span>{label}</span>
      <strong className="tabular-nums" data-testid={testId}>{value}</strong>
      {children}
    </div>
  );
}

const INSIGHT_TONE: Record<Insight["tone"], string> = {
  attention: "border-[#e8b4a0]/40 bg-[#e8b4a0]/[.07]",
  positive: "border-emerald-400/30 bg-emerald-400/[.06]",
  neutral: "border-white/10 bg-white/[.03]",
};

/** Translate the same recorded figures; keep the report's calculation and ordering unchanged. */
function insightArabic(insight: Insight, report: ReportIntelligence, period: ReportPeriod): string {
  const k = report.kpis;
  switch (insight.action) {
    case "Review alerts": return `${k.urgentAlerts} تنبيه تدقيق مرتفع أو حرج ما زال مفتوحاً.`;
    case "Open pipeline": {
      const top = report.stalled[0];
      return `${k.stalled} ملف نشط دون تحديث منذ ${STALL_DAYS}+ يوماً.${top ? ` أكبر مجموعة هي ${arabicStaffLabel(STATUS_LABELS[top.status])} (${top.n} ملفات، والأقدم منذ ${top.oldest_days} يوماً).` : ""}`;
    }
    case "Assign owners": return `${k.unassignedActive} ملف نشط دون موظف مسؤول.`;
    case "Open clients": {
      const change = percentChange(k.newCurrent, k.newPrevious) ?? 0;
      return `الطلبات الجديدة ${change > 0 ? "أعلى" : "أقل"} بنسبة ${Math.abs(change)}% مقارنة بالفترة السابقة من ${period} يوماً (${k.newCurrent} مقابل ${k.newPrevious}).`;
    }
    case "Open accounts": {
      const change = percentChange(k.collectedCurrent, k.collectedPrevious) ?? 0;
      return `المبالغ المحصلة ${change > 0 ? "أعلى" : "أقل"} بنسبة ${Math.abs(change)}% مقارنة بالفترة السابقة من ${period} يوماً.`;
    }
    case "Open archive": return `اكتمل ${k.completedCurrent} ملف خلال آخر ${period} يوماً؛ والمدة الوسيطة من الاستقبال إلى الإنجاز ${k.medianDaysToComplete} يوماً.`;
    case "Open dashboard": return k.documentsAwaitingReview > 0 ? `${k.documentsAwaitingReview} وثيقة بانتظار مراجعة الموظفين.` : "لا توجد استثناءات مفتوحة: لم يُعثر على عمل متوقف أو غير مسند أو دون مراجعة.";
    default: return insight.text;
  }
}

/** Counts straight from the database; every comparison and finding is derived from them, nothing is estimated. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") return <p className="ops-error" data-testid="forbidden"><StaffText en="403 — Admin or manager only." ar="403 — متاح للمسؤول أو المدير فقط."/></p>;
  const period = parseReportPeriod((await searchParams).period);
  const r = await reportIntelligence(session, period);
  const k = r.kpis;
  const statusTotal = r.byStatus.reduce((sum, row) => sum + row.n, 0);
  const completed = r.byStatus.find((row) => row.key === "completed")?.n ?? 0;
  const completionRate = statusTotal === 0 ? 0 : Math.round((completed / statusTotal) * 100);
  const funnelMax = Math.max(1, ...r.funnel.map((f) => f.n));
  const weeklyMax = Math.max(1, ...r.weekly.map((w) => w.n));

  return (
    <div className="ops-page space-y-4">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker"><StaffText en="CAREER GATE · MANAGEMENT INTELLIGENCE" ar="CAREER GATE · ذكاء الإدارة"/></p>
          <h1><StaffText en="Reports" ar="التقارير"/></h1>
          <p><StaffText en="Live operational counts from the production database · no estimated values" ar="مؤشرات تشغيلية فعلية من قاعدة البيانات · دون قيم تقديرية"/></p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SendToManagerButton reportPeriod={period} />
          <div className="ops-metric min-w-44">
            <span><StaffText en="New clients · 30 days" ar="عملاء جدد · 30 يوماً"/></span>
            <strong data-testid="report-last30">{k.last30}</strong>
          </div>
          <div className="report-performance" aria-label={`Completed client ratio ${completionRate}%`}>
            <div className="report-performance-ring" style={{ "--value": completionRate } as React.CSSProperties}><strong>{completionRate}%</strong></div>
            <div className="report-performance-copy"><span><StaffText en="Completion performance" ar="أداء الإنجاز"/></span><strong>{completed} <StaffText en="of" ar="من"/> {statusTotal} <StaffText en="client records" ar="سجل عميل"/></strong></div>
          </div>
        </div>
      </header>

      <StaffNav className="flex flex-wrap items-center gap-2" aria-label="Report period" ariaLabelAr="فترة التقرير" data-testid="report-period">
        {REPORT_PERIODS.map((days) => (
          <Link
            key={days}
            href={`/staff/reports?period=${days}`}
            aria-current={days === period ? "page" : undefined}
            className={days === period
              ? "inline-flex min-h-11 items-center rounded-xl border border-[#e8b4a0]/60 bg-[#e8b4a0]/10 px-4 text-sm font-semibold text-[#f6d5c6]"
              : "inline-flex min-h-11 items-center rounded-xl border border-white/10 px-4 text-sm text-slate-300 transition hover:border-[#e8b4a0]/40 hover:bg-white/5"}
          >
            <StaffText en="Last" ar="آخر"/> {days} <StaffText en="days" ar="يوماً"/>
          </Link>
        ))}
      </StaffNav>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Period indicators">
        <Kpi label={<StaffText en={`New applications · ${period}d`} ar={`الطلبات الجديدة · ${period} يوماً`}/>} value={k.newCurrent} testId="report-new-current"><Delta current={k.newCurrent} previous={k.newPrevious} /></Kpi>
        <Kpi label={<StaffText en={`Completed · ${period}d`} ar={`مكتمل · ${period} يوماً`}/>} value={k.completedCurrent} testId="report-completed-current"><Delta current={k.completedCurrent} previous={k.completedPrevious} /></Kpi>
        <Kpi label={<StaffText en={`Collected · ${period}d`} ar={`المبالغ المحصّلة · ${period} يوماً`}/>} value={money(k.collectedCurrent)} testId="report-collected-current"><Delta current={k.collectedCurrent} previous={k.collectedPrevious} /></Kpi>
        <Kpi label={<StaffText en="Receivables · active files" ar="المستحقات · الملفات النشطة"/>} value={money(k.receivables)} testId="report-receivables" />
        <Kpi label={<StaffText en="Active files" ar="الملفات النشطة"/>} value={k.active} testId="report-active" />
        <Kpi label={<StaffText en="Unassigned active" ar="ملفات نشطة غير مسندة"/>} value={k.unassignedActive} testId="report-unassigned" />
        <Kpi label={<StaffText en={`Stalled ${STALL_DAYS}+ days`} ar={`متوقف منذ ${STALL_DAYS}+ يوماً`}/>} value={k.stalled} testId="report-stalled" />
        <Kpi label={<StaffText en="Median days to completion" ar="المدة الوسيطة للإنجاز (يوم)"/>} value={k.medianDaysToComplete ?? "—"} testId="report-median-days" />
      </section>

      <section className="report-glass-card p-4" aria-label="Findings" data-testid="report-insights">
        <h2 className="mb-3 text-sm font-semibold text-slate-100"><StaffText en="Findings" ar="النتائج"/></h2>
        <ul className="grid gap-2 lg:grid-cols-2">
          {r.insights.map((insight, i) => (
            <li key={i} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${INSIGHT_TONE[insight.tone]}`}>
              <span className="text-sm leading-relaxed text-slate-100"><StaffText en={insight.text} ar={insightArabic(insight, r, period)}/></span>
              <Link href={insight.href} className="ops-secondary-button shrink-0"><StaffLabel en={insight.action}/></Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="report-glass-card p-4" aria-label="Status funnel" data-testid="report-funnel">
          <h2 className="mb-3 text-sm font-semibold text-slate-100"><StaffText en="Workflow funnel" ar="مراحل مسار العمل"/></h2>
          <ol className="space-y-1.5">
            {r.funnel.map((f) => (
              <li key={f.status} className="grid grid-cols-[minmax(0,11rem)_1fr_3rem] items-center gap-3 text-sm">
                <span className="truncate text-slate-300"><StaffLabel en={f.label}/></span>
                <span className="h-2.5 overflow-hidden rounded-full bg-white/[.06]" aria-hidden="true">
                  <span className="block h-full rounded-full bg-gradient-to-r from-[#e8b4a0] to-[#c9a27e]" style={{ width: `${(f.n / funnelMax) * 100}%` }} />
                </span>
                <span className="text-right font-medium tabular-nums text-slate-100">{f.n}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="report-glass-card p-4" aria-label="Weekly intake" data-testid="report-weekly">
          <h2 className="mb-3 text-sm font-semibold text-slate-100"><StaffText en="New applications · last 12 weeks" ar="الطلبات الجديدة · آخر 12 أسبوعاً"/></h2>
          <div className="flex h-40 items-end gap-1.5" role="img" aria-label={r.weekly.map((w) => `${w.week_start}: ${w.n}`).join(", ")}>
            {r.weekly.map((w) => (
              <div key={w.week_start} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] tabular-nums text-slate-400">{w.n}</span>
                <span className="w-full rounded-t-md bg-gradient-to-t from-[#c9a27e]/70 to-[#f2cdbb]" style={{ height: `${Math.max(2, (w.n / weeklyMax) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-slate-500"><span>{r.weekly[0]?.week_start}</span><span>{r.weekly[r.weekly.length - 1]?.week_start}</span></div>
        </section>
      </div>

      <section className="report-glass-card p-4" aria-label="Staff performance" data-testid="report-staff">
        <h2 className="mb-3 text-sm font-semibold text-slate-100"><StaffText en="Staff performance ·" ar="أداء الموظفين ·"/> {period} <StaffText en="days" ar="يوماً"/></h2>
        {r.staff.length === 0 ? <p className="text-sm text-slate-500"><StaffText en="No active staff." ar="لا يوجد موظفون نشطون."/></p> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th><StaffText en="Staff" ar="الموظفون"/></th><th className="text-right"><StaffText en="Active files" ar="الملفات النشطة"/></th><th className="text-right"><StaffText en="Completed ·" ar="مكتمل ·"/> {period}<StaffText en="d" ar="يوم"/></th><th className="text-right"><StaffText en="Ready / completed" ar="جاهز / مكتمل"/></th><th className="text-right"><StaffText en="Overdue tasks" ar="المهام المتأخرة"/></th></tr></thead>
              <tbody>
                {r.staff.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="text-right tabular-nums">{s.active}</td>
                    <td className="text-right tabular-nums">{s.completed_period}</td>
                    <td className="text-right tabular-nums">{s.ready_or_done}</td>
                    <td className={`text-right tabular-nums ${s.overdue_tasks > 0 ? "font-semibold text-rose-300" : ""}`}>{s.overdue_tasks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {r.stalled.length > 0 && (
        <section className="report-glass-card p-4" aria-label="Stalled files" data-testid="report-stalled-table">
          <h2 className="mb-3 text-sm font-semibold text-slate-100"><StaffText en="Stalled files · no update for" ar="ملفات متوقفة · دون تحديث منذ"/> {STALL_DAYS}<StaffText en="+ days" ar="+ يوماً"/></h2>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th><StaffText en="Status" ar="الحالة"/></th><th className="text-right"><StaffText en="Files" ar="الملفات"/></th><th className="text-right"><StaffText en="Oldest (days)" ar="الأقدم (بالأيام)"/></th></tr></thead>
              <tbody>
                {r.stalled.map((row) => <tr key={row.status}><td><StaffLabel en={STATUS_LABELS[row.status]}/></td><td className="text-right tabular-nums">{row.n}</td><td className="text-right tabular-nums">{row.oldest_days}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Table title="Clients by status" rows={r.byStatus} label={(x: CountRow) => <StaffLabel en={STATUS_LABELS[x.key as Status] ?? x.key}/>} />
        <Table title="Clients by source" rows={r.bySource} label={(x: CountRow) => <StaffText en={x.key === "public_intake" ? "Online application" : "Office-created"} ar={x.key === "public_intake" ? "طلب إلكتروني" : "أُنشئ في المكتب"}/>} />
        <Table title="Clients by staff" rows={r.byStaff} label={(x: { name: string }) => x.name} extra={(x: { ready_or_done: number }) => <StaffText en={`${x.ready_or_done} ready/completed`} ar={`${x.ready_or_done} جاهز / مكتمل`}/>} />
        <Table title="Primary site preference" rows={r.bySite} label={(x: CountRow) => x.key ?? <StaffText en="Not selected" ar="غير محدد"/>} />
        <Table title="Documents by review state" rows={r.docs} label={(x: CountRow) => <StaffLabel en={DOC_STATUS_LABELS[x.key as DocStatus] ?? x.key}/>} />
        <Table title="Open audit alerts" rows={r.alerts} label={(x: CountRow) => x.key} />
      </div>
    </div>
  );
}
