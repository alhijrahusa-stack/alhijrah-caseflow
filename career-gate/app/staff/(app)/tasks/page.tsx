import { StaffLabel } from "@/components/staff/StaffLabel";
import { StaffText } from "@/components/staff/StaffLanguage";
import { RoyalSelect, RoyalOption } from "@/components/forms/RoyalSelect";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NewTaskButton } from "@/components/staff/NewTaskButton";
import { TaskRowActions } from "@/components/staff/sections/Work";
import { StaffEmptyState, StaffNav } from "@/components/staff/StaffPageLabels";
import { getStaffSession } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { staffDirectory, taskPage } from "@/lib/queries";

const PAGE_SIZE = 50;

function tasksHref(view: string, assignee: string | undefined, page: number) {
  const params = new URLSearchParams();
  if (view !== "open") params.set("view", view);
  if (assignee) params.set("assignee", assignee);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/staff/tasks?${query}` : "/staff/tasks";
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; assignee?: string; page?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const sp = await searchParams;
  const view = sp.view === "closed" || sp.view === "overdue" || sp.view === "due_today" ? sp.view : "open";
  const staff = await staffDirectory(session);
  const assignee = staff.some((s) => s.id === sp.assignee) ? sp.assignee : undefined;
  const requestedPage = Number(sp.page ?? "1");
  const result = await taskPage(session, view, assignee, requestedPage, PAGE_SIZE);
  const {page, total, pages: pageCount} = result;
  const rows = JSON.parse(JSON.stringify(result.rows));
  return (
    <div className="ops-page space-y-4">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker"><StaffText en="CAREER GATE · TASK CONTROL" ar="CAREER GATE · إدارة المهام"/></p>
          <h1><StaffText en="Tasks" ar="المهام"/></h1>
          <p><StaffText en={`${total} ${view === "closed" ? "completed / cancelled" : view === "overdue" ? "overdue" : view === "due_today" ? "due today" : "open"} task${total === 1 ? "" : "s"}${pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""}`} ar={`${total} مهمة ${view === "closed" ? "مكتملة / ملغاة" : view === "overdue" ? "متأخرة" : view === "due_today" ? "مستحقة اليوم" : "مفتوحة"}${pageCount > 1 ? ` · الصفحة ${page} من ${pageCount}` : ""}`}/></p>
        </div>
        <div><NewTaskButton /></div>
      </header>

      <section className="ops-glass-card flex flex-wrap items-center gap-3">
        <StaffNav className="flex flex-wrap gap-3 text-sm" aria-label="Views" ariaLabelAr="عروض المهام">
          <Link href="/staff/tasks" className={view === "open" ? "font-semibold text-brand-700" : "text-slate-500"}><StaffText en="Open" ar="مفتوح"/></Link>
          <Link href="/staff/tasks?view=overdue" className={view === "overdue" ? "font-semibold text-brand-700" : "text-slate-500"}><StaffText en="Overdue" ar="متأخر"/></Link>
          <Link href="/staff/tasks?view=due_today" className={view === "due_today" ? "font-semibold text-brand-700" : "text-slate-500"}><StaffText en="Due Today" ar="مستحق اليوم"/></Link>
          <Link href="/staff/tasks?view=closed" className={view === "closed" ? "font-semibold text-brand-700" : "text-slate-500"}><StaffText en="Completed / cancelled" ar="مكتمل / ملغى"/></Link>
        </StaffNav>
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="view" value={view} />
          <RoyalSelect name="assignee" defaultValue={assignee ?? ""} className="input w-44" aria-label="Assigned to" ariaLabelAr="الموظف المسؤول">
            <RoyalOption value="" labelAr="الجميع">Everyone</RoyalOption>
            {staff.filter((s) => s.active).map((s) => <RoyalOption key={s.id} value={s.id}>{s.display_name}</RoyalOption>)}
          </RoyalSelect>
          <button className="ops-primary-button"><StaffText en="Filter" ar="تصفية"/></button>
        </form>
      </section>

      {rows.length === 0 ? (
        <StaffEmptyState title={view === "closed" ? "No completed tasks" : view === "overdue" ? "No overdue tasks" : view === "due_today" ? "No tasks due today" : "No open tasks"} titleAr={view === "closed" ? "لا توجد مهام مكتملة" : view === "overdue" ? "لا توجد مهام متأخرة" : view === "due_today" ? "لا توجد مهام مستحقة اليوم" : "لا توجد مهام مفتوحة"} text="Tasks added to client files or the office appear here." textAr="تظهر هنا المهام المضافة إلى ملفات العملاء أو أعمال المكتب." />
      ) : (
        <div className="ops-glass-card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th><StaffText en="Task" ar="المهمة"/></th><th><StaffText en="Client" ar="العميل"/></th><th><StaffText en="Assigned" ar="الموظف المسؤول"/></th><th><StaffText en="Due" ar="الاستحقاق"/></th><th><StaffText en="Status" ar="الحالة"/></th><th /></tr></thead>
            <tbody>
              {rows.map((t: Record<string, string> & { overdue?: boolean }) => {
                const overdue = view !== "closed" && Boolean(t.overdue);
                return (
                  <tr key={t.id}>
                    <td>{t.title}{t.description && <span className="block text-xs text-slate-500">{t.description}</span>}</td>
                    <td>{t.client_id ? <Link href={`/staff/client/${t.client_id}`} className="text-brand-700 hover:underline">{t.full_name}</Link> : <span className="text-slate-400"><StaffText en="Office" ar="المكتب"/></span>}</td>
                    <td>{t.assigned_to_name ?? "—"}</td>
                    <td className={`whitespace-nowrap ${overdue ? "font-medium text-red-600" : ""}`}>{dateTime(t.due_at)}</td>
                    <td><StaffLabel en={t.status.replace("_", " ")}/>{t.completed_at && <span className="block text-xs text-slate-500">{t.completed_by_name} · {dateTime(t.completed_at)}</span>}</td>
                    <td><TaskRowActions task={t} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pageCount > 1 && (
        <StaffNav aria-label="Task pages" ariaLabelAr="صفحات المهام" className="flex items-center justify-between gap-3" data-testid="tasks-pager">
          {page > 1 ? <Link href={tasksHref(view, assignee, page - 1)} className="ops-secondary-button"><StaffText en="Previous" ar="السابق"/></Link> : <span />}
          <span className="text-sm text-slate-300"><StaffText en="Page" ar="الصفحة"/> {page} <StaffText en="of" ar="من"/> {pageCount}</span>
          {page < pageCount ? <Link href={tasksHref(view, assignee, page + 1)} className="ops-primary-button"><StaffText en="Next" ar="التالي"/></Link> : <span />}
        </StaffNav>
      )}
    </div>
  );
}
