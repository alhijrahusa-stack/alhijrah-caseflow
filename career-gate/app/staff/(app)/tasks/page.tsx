import Link from "next/link";
import { redirect } from "next/navigation";
import { NewTaskButton } from "@/components/staff/NewTaskButton";
import { TaskRowActions } from "@/components/staff/sections/Work";
import { EmptyState } from "@/components/ui/EmptyState";
import { getStaffSession } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { staffDirectory, taskList } from "@/lib/queries";

const PAGE_SIZE = 50;

function tasksHref(view: string, assignee: string | undefined, page: number) {
  const params = new URLSearchParams();
  if (view === "closed") params.set("view", "closed");
  if (assignee) params.set("assignee", assignee);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/staff/tasks?${query}` : "/staff/tasks";
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; assignee?: string; page?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const sp = await searchParams;
  const view = sp.view === "closed" ? "closed" : "open";
  const staff = await staffDirectory(session);
  const assignee = staff.some((s) => s.id === sp.assignee) ? sp.assignee : undefined;
  const requestedPage = Number(sp.page ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10000) : 1;
  const fetched = await taskList(session, view, assignee, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const total = Number(fetched[0]?.total_count ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = JSON.parse(JSON.stringify(fetched));
  return (
    <div className="ops-page space-y-4">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · TASK CONTROL</p>
          <h1>Tasks</h1>
          <p>{total} {view === "open" ? "open" : "completed / cancelled"} task{total === 1 ? "" : "s"}{pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""}</p>
        </div>
        <div><NewTaskButton /></div>
      </header>

      <section className="ops-glass-card flex flex-wrap items-center gap-3">
        <nav className="flex gap-3 text-sm" aria-label="Views">
          <Link href="/staff/tasks" className={view === "open" ? "font-semibold text-brand-700" : "text-slate-500"}>Open</Link>
          <Link href="/staff/tasks?view=closed" className={view === "closed" ? "font-semibold text-brand-700" : "text-slate-500"}>Completed / cancelled</Link>
        </nav>
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="view" value={view} />
          <select name="assignee" defaultValue={assignee ?? ""} className="input w-44" aria-label="Assigned to">
            <option value="">Everyone</option>
            {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
          </select>
          <button className="ops-primary-button">Filter</button>
        </form>
      </section>

      {rows.length === 0 ? (
        <EmptyState title={view === "open" ? "No open tasks" : "No completed tasks"} text="Tasks added to client files or the office appear here." />
      ) : (
        <div className="ops-glass-card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Task</th><th>Client</th><th>Assigned</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((t: Record<string, string> & { overdue?: boolean }) => {
                const overdue = view === "open" && Boolean(t.overdue);
                return (
                  <tr key={t.id}>
                    <td>{t.title}{t.description && <span className="block text-xs text-slate-500">{t.description}</span>}</td>
                    <td>{t.client_id ? <Link href={`/staff/client/${t.client_id}`} className="text-brand-700 hover:underline">{t.full_name}</Link> : <span className="text-slate-400">Office</span>}</td>
                    <td>{t.assigned_to_name ?? "—"}</td>
                    <td className={`whitespace-nowrap ${overdue ? "font-medium text-red-600" : ""}`}>{dateTime(t.due_at)}</td>
                    <td>{t.status.replace("_", " ")}{t.completed_at && <span className="block text-xs text-slate-500">{t.completed_by_name} · {dateTime(t.completed_at)}</span>}</td>
                    <td><TaskRowActions task={t} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pageCount > 1 && (
        <nav aria-label="Task pages" className="flex items-center justify-between gap-3" data-testid="tasks-pager">
          {page > 1 ? <Link href={tasksHref(view, assignee, page - 1)} className="ops-secondary-button">Previous</Link> : <span />}
          <span className="text-sm text-slate-300">Page {page} of {pageCount}</span>
          {page < pageCount ? <Link href={tasksHref(view, assignee, page + 1)} className="ops-primary-button">Next</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
