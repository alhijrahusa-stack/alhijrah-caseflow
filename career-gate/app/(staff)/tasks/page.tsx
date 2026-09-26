import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { dateTime } from "@/lib/format";
import { getStaff } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tasks" };

type Row = {
  id: string;
  title: string;
  due_at: string | null;
  client_id: string | null;
  clients: { ref: string; first_name: string; last_name: string } | null;
};

async function completeTask(form: FormData) {
  "use server";
  const staff = await getStaff();
  if (!staff) return;
  const id = String(form.get("id"));
  const { data: task } = await staff.supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open")
    .select("client_id, title")
    .maybeSingle();
  if (task?.client_id) {
    await staff.supabase.from("activity").insert({
      client_id: task.client_id, actor: staff.user.id, type: "task_completed",
      summary: `Task completed: ${task.title}`,
    });
  }
  revalidatePath("/tasks");
}

async function createTask(form: FormData) {
  "use server";
  const staff = await getStaff();
  if (!staff) return;
  const title = String(form.get("title") ?? "").trim().slice(0, 200);
  const due = String(form.get("due_at") ?? "");
  if (!title) return;
  await staff.supabase.from("tasks").insert({
    title,
    due_at: due ? new Date(due).toISOString() : null,
    created_by: staff.user.id,
    assigned_to: staff.user.id,
  });
  revalidatePath("/tasks");
}

export default async function TasksPage() {
  const staff = await getStaff();
  if (!staff) return null;
  const { data, error } = await staff.supabase
    .from("tasks")
    .select("id, title, due_at, client_id, clients(ref, first_name, last_name)")
    .eq("status", "open")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(300)
    .returns<Row[]>();
  const now = Date.now();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Open tasks</h1>

      <Card title="New task">
        <form action={createTask} className="flex flex-wrap gap-2">
          <input name="title" className="input max-w-md" placeholder="What needs doing?" required />
          <input name="due_at" type="datetime-local" className="input max-w-[14rem]" />
          <button className="rounded-md bg-brand-600 px-4 py-2 text-sm text-white">Add</button>
        </form>
      </Card>

      <Card>
        {error ? (
          <p className="text-sm text-red-600">{error.message}</p>
        ) : data?.length ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {data.map((t) => {
              const overdue = t.due_at && new Date(t.due_at).getTime() < now;
              return (
                <li key={t.id} className="flex items-center justify-between gap-4 py-2">
                  <div>
                    <p className="font-medium">{t.title}</p>
                    <p className="text-slate-500">
                      {t.clients && (
                        <Link href={`/clients/${t.client_id}`} className="text-brand-700 hover:underline">
                          {t.clients.first_name} {t.clients.last_name}
                        </Link>
                      )}
                      {t.clients && " · "}
                      <span className={overdue ? "font-medium text-red-600" : ""}>
                        {t.due_at ? `Due ${dateTime(t.due_at)}` : "No due date"}
                      </span>
                    </p>
                  </div>
                  <form action={completeTask}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">Done</button>
                  </form>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No open tasks.</p>
        )}
      </Card>
    </div>
  );
}
