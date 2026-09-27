import Link from "next/link";
import { redirect } from "next/navigation";
import { NewTaskButton } from "@/components/staff/NewTaskButton";
import { TaskRowActions } from "@/components/staff/sections/Work";
import { EmptyState } from "@/components/ui/EmptyState";
import { getStaffSession } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { staffDirectory, taskList } from "@/lib/queries";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; assignee?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const sp = await searchParams;
  const view = sp.view === "closed" ? "closed" : "open";
  const staff = await staffDirectory(session);
  const assignee = staff.some((s) => s.id === sp.assignee) ? sp.assignee : undefined;
  const rows = JSON.parse(JSON.stringify(await taskList(session, view, assignee)));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <nav className="flex gap-3 text-sm" aria-label="Views">
          <Link href="/staff/tasks" className={view === "open" ? "font-semibold text-brand-700" : "text-slate-500"}>Open</Link>
          <Link href="/staff/tasks?view=closed" className={view === "closed" ? "font-semibold text-brand-700" : "text-slate-500"}>Completed / cancelled</Link>
        </nav>
        <form className="flex gap-2">
          <input type="hidden" name="view" value={view} />
          <select name="assignee" defaultValue={assignee ?? ""} className="input w-40" aria-label="Assigned to">
            <option value="">Everyone</option>
            {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
          </select>
          <button className="rounded-md bg-slate-800 px-3 text-sm text-white">Filter</button>
        </form>
        <div className="ml-auto"><NewTaskButton /></div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={view === "open" ? "No open tasks" : "No completed tasks"} text="Tasks added to client files or the office appear here." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
    </div>
  );
}
