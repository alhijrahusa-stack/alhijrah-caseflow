import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";
import { teamWorkload, type TeamWorkloadData } from "@/lib/operational-team";
import { TZ } from "@/lib/queries";

const OPEN_TASKS = ["pending", "in_progress"];
const OPEN_APPOINTMENTS = ["scheduled", "confirmed", "rescheduled"];
const BLOCKING_DOCUMENT_STATES = ["needs_review", "needs_reupload", "rejected"];

export type DashboardCommandData = {
  new_clients: number;
  appointments_2h: number;
  tasks_due: number;
  overdue_tasks: number;
  overdue_followups: number;
  document_attention: number;
  unassigned_clients: number;
  completed_this_month: number;
  efficiency: number | null;
  team: TeamWorkloadData;
};

export async function dashboardCommandData(session: StaffSession): Promise<DashboardCommandData> {
  const [team, metrics] = await Promise.all([
    teamWorkload(session),
    withStaff(session, async (tx) => {
      const [row] = await tx`
        with active as (
          select id,assigned_staff from clients
          where deleted_at is null and current_status not in ('completed','cancelled')
        ),
        latest_docs as (
          select distinct on (d.client_id,d.doc_type) d.client_id,d.doc_type,d.status
          from documents d join active a on a.id=d.client_id
          order by d.client_id,d.doc_type,d.uploaded_at desc,d.id desc
        ),
        health as (
          select a.id,
            (a.assigned_staff is not null
             and not exists (select 1 from tasks t where t.client_id=a.id and t.status=any(${OPEN_TASKS}) and t.due_at is not null and t.due_at<now())
             and not exists (select 1 from followups f where f.client_id=a.id and f.status='open' and f.due_date<(now() at time zone ${TZ})::date)
             and not exists (select 1 from latest_docs d where d.client_id=a.id and d.status=any(${BLOCKING_DOCUMENT_STATES}))) as healthy
          from active a
        )
        select
          (select count(*)::int from clients c where c.deleted_at is null and c.current_status='new_intake') as new_clients,
          (select count(distinct a.client_id)::int from appointments a join active c on c.id=a.client_id where a.status=any(${OPEN_APPOINTMENTS}) and a.scheduled_at>=now() and a.scheduled_at<=now()+interval '2 hours') as appointments_2h,
          (select count(*)::int from tasks t join active c on c.id=t.client_id where t.status=any(${OPEN_TASKS}) and t.due_at is not null and (t.due_at at time zone ${TZ})::date=(now() at time zone ${TZ})::date) as tasks_due,
          (select count(*)::int from tasks t join active c on c.id=t.client_id where t.status=any(${OPEN_TASKS}) and t.due_at is not null and t.due_at<now()) as overdue_tasks,
          (select count(*)::int from followups f join active c on c.id=f.client_id where f.status='open' and f.due_date<(now() at time zone ${TZ})::date) as overdue_followups,
          (select count(distinct d.client_id)::int from latest_docs d where d.status=any(${BLOCKING_DOCUMENT_STATES})) as document_attention,
          (select count(*)::int from active where assigned_staff is null) as unassigned_clients,
          (select count(distinct l.client_id)::int from activity_log l where l.action in ('status_changed','status_overridden') and l.new_value->>'status'='completed' and l.created_at>=date_trunc('month',now())) as completed_this_month,
          (select count(*)::int from health) as active_count,
          (select count(*) filter (where healthy)::int from health) as healthy_count`;
      const active = Number(row?.active_count ?? 0);
      const healthy = Number(row?.healthy_count ?? 0);
      return {
        new_clients:Number(row?.new_clients ?? 0), appointments_2h:Number(row?.appointments_2h ?? 0), tasks_due:Number(row?.tasks_due ?? 0), overdue_tasks:Number(row?.overdue_tasks ?? 0), overdue_followups:Number(row?.overdue_followups ?? 0), document_attention:Number(row?.document_attention ?? 0), unassigned_clients:Number(row?.unassigned_clients ?? 0), completed_this_month:Number(row?.completed_this_month ?? 0), efficiency:active===0?null:Math.round((healthy/active)*100),
      };
    }),
  ]);
  return { ...metrics, team };
}
