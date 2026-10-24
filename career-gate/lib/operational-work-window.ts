import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";
import { TZ } from "@/lib/queries";

export type WorkWindowKind = "today" | "week";
export type WorkWindowItem = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  clientRef: string | null;
  label: string;
  due: string;
  overdue: boolean;
};
export type WorkWindowData = {
  tasks: WorkWindowItem[];
  appointments: WorkWindowItem[];
  followups: WorkWindowItem[];
  totals: { tasks: number; appointments: number; followups: number };
};

const LIMIT = 50;

/** Current Detroit business day or Monday–Sunday business week, including overdue open work. */
export async function operationalWorkWindow(session: StaffSession, kind: WorkWindowKind): Promise<WorkWindowData> {
  return withStaff(session, async (tx) => {
    const today = tx`(now() at time zone ${TZ})::date`;
    const exclusiveEnd = kind === "today"
      ? tx`(${today} + 1)`
      : tx`(date_trunc('week', now() at time zone ${TZ})::date + 7)`;

    // All reads run with the requesting staff member's RLS role and subject.
    const taskRows = await tx`
      select t.id,t.client_id,t.title,t.due_at,c.full_name,c.ref,
             t.due_at < now() as overdue,count(*) over()::int as total
      from tasks t left join clients c on c.id=t.client_id
      where (c.id is null or c.deleted_at is null)
        and t.status in ('pending','in_progress')
        and t.due_at is not null
        and (t.due_at at time zone ${TZ})::date < ${exclusiveEnd}
      order by t.due_at,t.id limit ${LIMIT}`;

    const appointmentRows = await tx`
      select a.id,a.client_id,a.appointment_type,a.scheduled_at,c.full_name,c.ref,
             count(*) over()::int as total
      from appointments a join clients c on c.id=a.client_id
      where c.deleted_at is null
        and a.status in ('scheduled','confirmed','rescheduled')
        and a.scheduled_at >= now()
        and (a.scheduled_at at time zone ${TZ})::date < ${exclusiveEnd}
      order by a.scheduled_at,a.id limit ${LIMIT}`;

    const followupRows = await tx`
      select f.id,f.client_id,f.reason,f.due_date,c.full_name,c.ref,
             f.due_date < ${today} as overdue,count(*) over()::int as total
      from followups f join clients c on c.id=f.client_id
      where c.deleted_at is null and f.status='open' and f.due_date < ${exclusiveEnd}
      order by f.due_date,f.id limit ${LIMIT}`;

    const common = (r: Record<string, unknown>) => ({
      id: String(r.id),
      clientId: r.client_id == null ? null : String(r.client_id),
      clientName: r.full_name == null ? null : String(r.full_name),
      clientRef: r.ref == null ? null : String(r.ref),
    });
    const asInstant = (value: unknown) => new Date(value as Date | string).toISOString();

    return {
      tasks: taskRows.map((r) => ({ ...common(r), label: String(r.title), due: asInstant(r.due_at), overdue: r.overdue === true })),
      appointments: appointmentRows.map((r) => ({ ...common(r), label: String(r.appointment_type), due: asInstant(r.scheduled_at), overdue: false })),
      followups: followupRows.map((r) => ({ ...common(r), label: String(r.reason), due: String(r.due_date), overdue: r.overdue === true })),
      totals: {
        tasks: Number(taskRows[0]?.total ?? 0),
        appointments: Number(appointmentRows[0]?.total ?? 0),
        followups: Number(followupRows[0]?.total ?? 0),
      },
    };
  });
}
