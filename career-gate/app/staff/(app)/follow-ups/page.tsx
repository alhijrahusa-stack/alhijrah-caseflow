import { StaffText } from "@/components/staff/StaffLanguage";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FollowupRowActions } from "@/components/staff/sections/Work";
import { StaffEmptyState, StaffNav } from "@/components/staff/StaffPageLabels";
import { getStaffSession } from "@/lib/auth";
import { dateOnly, dateTime, formatPhone } from "@/lib/format";
import { followupPage } from "@/lib/queries";

const PAGE_SIZE = 50;
const VIEWS = [["today", "Due Today", "مستحق اليوم"], ["upcoming", "Upcoming", "القادمة"], ["overdue", "Overdue", "المتأخرة"], ["completed", "Completed", "المكتملة"]] as const;

export default async function FollowupsPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; overdue_page?: string; today_page?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const params = await searchParams;
  const v = params.view;
  const views = v === "due" ? ["overdue", "today"] : [VIEWS.some(([k]) => k === v) ? v! : "today"];
  const parsePage = (raw?: string) => {
    const n = Number(raw ?? "1");
    return Number.isSafeInteger(n) && n > 0 ? n : 1;
  };
  const lists = await Promise.all(views.map(async (k) => {
    const key = v === "due" ? (k === "overdue" ? "overdue_page" : "today_page") : "page";
    const result = await followupPage(session, k, parsePage(params[key as keyof typeof params]), PAGE_SIZE);
    return { view: k, ...result, rows: JSON.parse(JSON.stringify(result.rows)), key };
  }));
  const total = lists.reduce((sum, list) => sum + list.total, 0);
  const href = (key: string, next: number) => {
    const query = new URLSearchParams({ view: v === "due" ? "due" : views[0] });
    if (v === "due") {
      if (key !== "overdue_page" && lists[0].page > 1) query.set("overdue_page", String(lists[0].page));
      if (key !== "today_page" && lists[1].page > 1) query.set("today_page", String(lists[1].page));
    }
    if (next > 1) query.set(key, String(next));
    return `/staff/follow-ups?${query.toString()}`;
  };
  return (
    <div className="ops-page space-y-4">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker"><StaffText en="CAREER GATE · FOLLOW-UP CONTROL" ar="CAREER GATE · إدارة المتابعات"/></p>
          <h1><StaffText en="Follow-Ups" ar="المتابعات"/></h1>
          <p><StaffText en={`${total} follow-up item${total === 1 ? "" : "s"} in the selected view`} ar={`${total} بند متابعة في العرض المحدد`}/></p>
        </div>
        <StaffNav className="flex gap-3 text-sm" aria-label="Views" ariaLabelAr="عروض المتابعات">
          <Link href="/staff/follow-ups?view=due" className={v === "due" ? "font-semibold text-brand-700" : "text-slate-500"}><StaffText en="All due" ar="جميع المستحقات"/></Link>
          {VIEWS.map(([k, l, ar]) => <Link key={k} href={`/staff/follow-ups?view=${k}`} className={views.length === 1 && views[0] === k ? "font-semibold text-brand-700" : "text-slate-500"}><StaffText en={l} ar={ar}/></Link>)}
        </StaffNav>
      </header>
      {lists.map(({view: k, rows, total: sectionTotal, page: currentPage, pages, key}) => (
        <section key={k} className="ops-glass-card space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold"><StaffText en={VIEWS.find(([x]) => x === k)?.[1] ?? "Follow-Ups"} ar={VIEWS.find(([x]) => x === k)?.[2] ?? "المتابعات"}/></h2>
            <span className="rounded-full border border-white/[.08] px-2.5 py-1 font-mono text-[10px] text-slate-400">{sectionTotal}</span>
          </div>
          {rows.length === 0 ? <StaffEmptyState title="Nothing here" titleAr="لا توجد عناصر هنا" text="Follow-ups created from client files appear in these views." textAr="تظهر هنا المتابعات التي أُنشئت من ملفات العملاء." /> : (
            <div className="overflow-x-auto rounded-2xl border border-white/[.06]">
              <table className="table">
                <thead><tr><th><StaffText en="Due" ar="الاستحقاق"/></th><th><StaffText en="Client" ar="العميل"/></th><th><StaffText en="Phone" ar="الهاتف"/></th><th><StaffText en="Reason" ar="السبب"/></th><th><StaffText en="Created by" ar="أنشأه"/></th><th>{k === "completed" ? <StaffText en="Completed" ar="مكتمل"/> : ""}</th></tr></thead>
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
          {pages > 1 && (
            <StaffNav aria-label={`${k} follow-up pages`} ariaLabelAr="صفحات المتابعات" className="flex items-center justify-between gap-3" data-testid={`followup-pager-${k}`}>
              {currentPage > 1 ? <Link href={href(key, currentPage-1)} className="ops-secondary-button"><StaffText en="Previous" ar="السابق"/></Link> : <span />}
              <span className="text-sm text-slate-300"><StaffText en="Page" ar="الصفحة"/> {currentPage} <StaffText en="of" ar="من"/> {pages}</span>
              {currentPage < pages ? <Link href={href(key, currentPage+1)} className="ops-primary-button"><StaffText en="Next" ar="التالي"/></Link> : <span />}
            </StaffNav>
          )}
        </section>
      ))}
    </div>
  );
}
