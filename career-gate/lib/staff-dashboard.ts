import "server-only";
import { catalog, catalogVersion, options } from "@/lib/catalog";
import { withStaff, type StaffSession } from "@/lib/auth";
import { providerStates } from "@/lib/providers/config";
import { TZ, staffDirectory } from "@/lib/queries";

const OPEN_APPOINTMENTS = ["scheduled", "confirmed", "rescheduled"];
const OPEN_TASKS = ["pending", "in_progress"];
const ATTENTION_STATUSES = ["new_intake", "needs_review", "ready_to_apply", "appointment_required"];

export type DashboardClient = {
  id: string;
  ref: string;
  full_name: string;
  current_status: string;
  next_step: string;
  updated_at: string;
  assigned_name: string | null;
  site_code: string | null;
  site_name: string | null;
  shift_code: string | null;
  shift_days: string | null;
  shift_hours: string | null;
  next_appointment: string | null;
  appointment_location: string | null;
  next_task_due: string | null;
  next_followup_due: string | null;
  last_contact_at: string | null;
  document_count: number;
  note_count: number;
  task_count: number;
  contact_count: number;
  has_today_appointment: boolean;
  has_week_appointment: boolean;
  has_today_task: boolean;
  has_week_task: boolean;
  has_today_followup: boolean;
  has_week_followup: boolean;
};

export type DashboardReport = {
  days: number;
  new_clients: number;
  average_processing_days: number | null;
  by_status: { key: string; n: number }[];
  by_staff: { name: string; n: number }[];
  documents: { key: string; n: number }[];
  appointments: { key: string; n: number }[];
};

async function reportForDays(session: StaffSession, days: number): Promise<DashboardReport> {
  return withStaff(session, async (tx) => {
    const interval = `${days} days`;
    const [summary] = await tx`
      with completed as (
        select c.id, c.created_at,
               min(l.created_at) as completed_at
        from clients c
        join activity_log l on l.client_id = c.id
          and l.action in ('status_changed','status_overridden')
          and l.new_value->>'status' = 'completed'
        where c.deleted_at is null
        group by c.id, c.created_at
      )
      select
        (select count(*)::int from clients c where c.deleted_at is null and c.created_at >= now() - ${interval}::interval) as new_clients,
        (select round(avg(extract(epoch from (completed_at - created_at)) / 86400.0)::numeric, 1)
           from completed where completed_at >= now() - ${interval}::interval) as average_processing_days`;

    const [byStatus, byStaff, documents, appointments] = await Promise.all([
      tx`
        select current_status as key, count(*)::int as n
        from clients
        where deleted_at is null and created_at >= now() - ${interval}::interval
        group by current_status order by n desc, current_status`,
      tx`
        select s.display_name as name, count(*)::int as n
        from activity_log l join staff s on s.id = l.staff_id
        where l.created_at >= now() - ${interval}::interval
        group by s.id, s.display_name order by n desc, s.display_name`,
      tx`
        select status as key, count(*)::int as n
        from documents
        where coalesce(reviewed_at, uploaded_at) >= now() - ${interval}::interval
        group by status order by n desc, status`,
      tx`
        select status as key, count(*)::int as n
        from appointments
        where scheduled_at >= now() - ${interval}::interval and scheduled_at < now() + interval '1 day'
        group by status order by n desc, status`,
    ]);

    return {
      days,
      new_clients: Number(summary?.new_clients ?? 0),
      average_processing_days: summary?.average_processing_days == null ? null : Number(summary.average_processing_days),
      by_status: byStatus.map((r) => ({ key: String(r.key), n: Number(r.n) })),
      by_staff: byStaff.map((r) => ({ name: String(r.name), n: Number(r.n) })),
      documents: documents.map((r) => ({ key: String(r.key), n: Number(r.n) })),
      appointments: appointments.map((r) => ({ key: String(r.key), n: Number(r.n) })),
    };
  });
}

export async function staffDashboard(session: StaffSession) {
  const [core, team, reports] = await Promise.all([
    withStaff(session, async (tx) => {
      const [attention] = await tx`
        select
          (select count(*)::int from clients c where c.deleted_at is null and c.current_status = 'new_intake') as new_clients,
          (select count(distinct a.client_id)::int
             from appointments a join clients c on c.id = a.client_id
             where c.deleted_at is null and a.status = any(${OPEN_APPOINTMENTS})
               and a.scheduled_at >= now() and a.scheduled_at <= now() + interval '2 hours') as appointments_2h,
          (select count(distinct f.client_id)::int
             from followups f join clients c on c.id = f.client_id
             where c.deleted_at is null and f.status = 'open'
               and f.due_date < (now() at time zone ${TZ})::date) as overdue_followups,
          (select count(distinct d.client_id)::int
             from documents d join clients c on c.id = d.client_id
             where c.deleted_at is null and d.status in ('needs_review','needs_reupload','rejected')) as document_attention`;

      const rows = await tx`
        select c.id, c.ref, c.full_name, c.current_status, c.next_step, c.updated_at,
               s.display_name as assigned_name,
               p.site_code, p.site_name, p.shift_code, p.days as shift_days, p.hours as shift_hours,
               ap.scheduled_at as next_appointment, ap.location as appointment_location,
               ta.due_at as next_task_due, fu.due_date as next_followup_due, co.created_at as last_contact_at,
               coalesce(dc.n, 0)::int as document_count,
               coalesce(nc.n, 0)::int as note_count,
               coalesce(tc.n, 0)::int as task_count,
               coalesce(cc.n, 0)::int as contact_count,
               exists (
                 select 1 from appointments x where x.client_id = c.id and x.status = any(${OPEN_APPOINTMENTS})
                   and (x.scheduled_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date
               ) as has_today_appointment,
               exists (
                 select 1 from appointments x where x.client_id = c.id and x.status = any(${OPEN_APPOINTMENTS})
                   and (x.scheduled_at at time zone ${TZ})::date > (now() at time zone ${TZ})::date
                   and (x.scheduled_at at time zone ${TZ})::date <= (now() at time zone ${TZ})::date + 7
               ) as has_week_appointment,
               exists (
                 select 1 from tasks x where x.client_id = c.id and x.status = any(${OPEN_TASKS}) and x.due_at is not null
                   and (x.due_at at time zone ${TZ})::date <= (now() at time zone ${TZ})::date
               ) as has_today_task,
               exists (
                 select 1 from tasks x where x.client_id = c.id and x.status = any(${OPEN_TASKS}) and x.due_at is not null
                   and (x.due_at at time zone ${TZ})::date > (now() at time zone ${TZ})::date
                   and (x.due_at at time zone ${TZ})::date <= (now() at time zone ${TZ})::date + 7
               ) as has_week_task,
               exists (
                 select 1 from followups x where x.client_id = c.id and x.status = 'open'
                   and x.due_date <= (now() at time zone ${TZ})::date
               ) as has_today_followup,
               exists (
                 select 1 from followups x where x.client_id = c.id and x.status = 'open'
                   and x.due_date > (now() at time zone ${TZ})::date
                   and x.due_date <= (now() at time zone ${TZ})::date + 7
               ) as has_week_followup
        from clients c
        left join staff s on s.id = c.assigned_staff
        left join lateral (
          select site_code, site_name, shift_code, days, hours from client_preferences z
          where z.client_id = c.id order by case z.rank when 'primary' then 0 else 1 end, z.preference_order limit 1
        ) p on true
        left join lateral (
          select scheduled_at, location from appointments z
          where z.client_id = c.id and z.status = any(${OPEN_APPOINTMENTS}) and z.ends_at >= now()
          order by z.scheduled_at limit 1
        ) ap on true
        left join lateral (
          select due_at from tasks z where z.client_id = c.id and z.status = any(${OPEN_TASKS})
          order by z.due_at asc nulls last, z.created_at limit 1
        ) ta on true
        left join lateral (
          select due_date from followups z where z.client_id = c.id and z.status = 'open'
          order by z.due_date, z.created_at limit 1
        ) fu on true
        left join lateral (
          select created_at from contacts z where z.client_id = c.id order by z.created_at desc limit 1
        ) co on true
        left join lateral (select count(*)::int n from documents z where z.client_id = c.id) dc on true
        left join lateral (select count(*)::int n from notes z where z.client_id = c.id) nc on true
        left join lateral (select count(*)::int n from tasks z where z.client_id = c.id and z.status in ('pending','in_progress')) tc on true
        left join lateral (select count(*)::int n from contacts z where z.client_id = c.id) cc on true
        where c.deleted_at is null
        order by c.updated_at desc
        limit 400`;

      return {
        attention: {
          new_clients: Number(attention?.new_clients ?? 0),
          appointments_2h: Number(attention?.appointments_2h ?? 0),
          overdue_followups: Number(attention?.overdue_followups ?? 0),
          document_attention: Number(attention?.document_attention ?? 0),
        },
        clients: rows as unknown as DashboardClient[],
      };
    }),
    staffDirectory(session),
    Promise.all([reportForDays(session, 7), reportForDays(session, 30), reportForDays(session, 90)]),
  ]);

  const today: DashboardClient[] = [];
  const week: DashboardClient[] = [];
  const later: DashboardClient[] = [];
  const completed: DashboardClient[] = [];
  const stopped: DashboardClient[] = [];

  for (const client of core.clients) {
    if (client.current_status === "completed") {
      completed.push(client);
      continue;
    }
    if (client.current_status === "cancelled") {
      stopped.push(client);
      continue;
    }
    if (
      ATTENTION_STATUSES.includes(client.current_status) ||
      client.has_today_appointment || client.has_today_task || client.has_today_followup
    ) {
      today.push(client);
      continue;
    }
    if (client.has_week_appointment || client.has_week_task || client.has_week_followup) {
      week.push(client);
      continue;
    }
    later.push(client);
  }

  const integrations = providerStates();
  return {
    attention: core.attention,
    groups: { today, week, later, completed, stopped },
    reports: Object.fromEntries(reports.map((r) => [String(r.days), r])) as Record<string, DashboardReport>,
    settings: {
      team,
      catalog: {
        schema_version: catalog.schema_version,
        state: catalog.state,
        facilities: catalog.facilities.length,
        openings: catalog.openings.length,
        selectable_options: options.length,
        version: catalogVersion,
      },
      integrations,
    },
  };
}

export type StaffDashboardData = Awaited<ReturnType<typeof staffDashboard>>;
