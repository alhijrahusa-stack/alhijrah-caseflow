import "server-only";
import { catalog, catalogVersion, options } from "@/lib/catalog";
import { withStaff, type StaffSession } from "@/lib/auth";
import { providerStates } from "@/lib/providers/config";
import { TZ } from "@/lib/queries";

const OPEN_APPOINTMENTS = ["scheduled", "confirmed", "rescheduled"];
const OPEN_TASKS = ["pending", "in_progress"];
const ATTENTION_STATUSES = ["new_intake", "needs_review", "ready_to_apply", "appointment_required"];

export type DashboardTab = "today" | "week" | "reports" | "settings";
export type DashboardPeriod = 7 | 30 | 90;

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

type Attention = {
  new_clients: number;
  appointments_2h: number;
  overdue_followups: number;
  document_attention: number;
};

type DashboardGroups = {
  today: DashboardClient[];
  week: DashboardClient[];
  later: DashboardClient[];
  completed: DashboardClient[];
  stopped: DashboardClient[];
};

type DashboardSettings = {
  catalog: {
    schema_version: string | number;
    state: string;
    facilities: number;
    openings: number;
    selectable_options: number;
    version: string;
  };
  integrations: Record<string, string>;
};

export type StaffDashboardData = {
  attention: Attention;
  groups: DashboardGroups;
  reports: Record<string, DashboardReport>;
  settings: DashboardSettings;
};

function emptyAttention(): Attention {
  return { new_clients: 0, appointments_2h: 0, overdue_followups: 0, document_attention: 0 };
}

function emptyGroups(): DashboardGroups {
  return { today: [], week: [], later: [], completed: [], stopped: [] };
}

function catalogSummary(): DashboardSettings["catalog"] {
  return {
    schema_version: catalog.schema_version,
    state: catalog.state,
    facilities: catalog.facilities.length,
    openings: catalog.openings.length,
    selectable_options: options.length,
    version: catalogVersion,
  };
}

async function reportForDays(session: StaffSession, days: DashboardPeriod): Promise<DashboardReport> {
  return withStaff(session, async (tx) => {
    const interval = `${days} days`;
    const [row] = await tx`
      with completed as (
        select c.id, c.created_at, min(l.created_at) as completed_at
        from clients c
        join activity_log l on l.client_id = c.id
          and l.action in ('status_changed','status_overridden')
          and l.new_value->>'status' = 'completed'
          and l.created_at >= now() - ${interval}::interval
        where c.deleted_at is null
        group by c.id, c.created_at
      ),
      by_status as (
        select current_status as key, count(*)::int as n
        from clients
        where deleted_at is null and created_at >= now() - ${interval}::interval
        group by current_status
      ),
      by_staff as (
        select s.display_name as name, count(*)::int as n
        from activity_log l
        join staff s on s.id = l.staff_id
        where l.created_at >= now() - ${interval}::interval
        group by s.id, s.display_name
      ),
      document_status as (
        select status as key, count(*)::int as n
        from documents
        where coalesce(reviewed_at, uploaded_at) >= now() - ${interval}::interval
        group by status
      ),
      appointment_status as (
        select status as key, count(*)::int as n
        from appointments
        where scheduled_at >= now() - ${interval}::interval
          and scheduled_at < now() + interval '1 day'
        group by status
      )
      select
        (select count(*)::int
           from clients c
           where c.deleted_at is null and c.created_at >= now() - ${interval}::interval) as new_clients,
        (select round(avg(extract(epoch from (completed_at - created_at)) / 86400.0)::numeric, 1)
           from completed) as average_processing_days,
        coalesce((
          select jsonb_agg(jsonb_build_object('key', key, 'n', n) order by n desc, key)
          from by_status
        ), '[]'::jsonb) as by_status,
        coalesce((
          select jsonb_agg(jsonb_build_object('name', name, 'n', n) order by n desc, name)
          from by_staff
        ), '[]'::jsonb) as by_staff,
        coalesce((
          select jsonb_agg(jsonb_build_object('key', key, 'n', n) order by n desc, key)
          from document_status
        ), '[]'::jsonb) as documents,
        coalesce((
          select jsonb_agg(jsonb_build_object('key', key, 'n', n) order by n desc, key)
          from appointment_status
        ), '[]'::jsonb) as appointments`;

    const byStatus = Array.isArray(row?.by_status) ? row.by_status : [];
    const byStaff = Array.isArray(row?.by_staff) ? row.by_staff : [];
    const documents = Array.isArray(row?.documents) ? row.documents : [];
    const appointments = Array.isArray(row?.appointments) ? row.appointments : [];

    return {
      days,
      new_clients: Number(row?.new_clients ?? 0),
      average_processing_days: row?.average_processing_days == null ? null : Number(row.average_processing_days),
      by_status: byStatus.map((r) => ({ key: String(r.key), n: Number(r.n) })),
      by_staff: byStaff.map((r) => ({ name: String(r.name), n: Number(r.n) })),
      documents: documents.map((r) => ({ key: String(r.key), n: Number(r.n) })),
      appointments: appointments.map((r) => ({ key: String(r.key), n: Number(r.n) })),
    };
  });
}

export async function staffDashboard(
  session: StaffSession,
  tab: DashboardTab = "today",
  period: DashboardPeriod = 7,
): Promise<StaffDashboardData> {
  if (tab === "reports") {
    const report = await reportForDays(session, period);
    return {
      attention: emptyAttention(),
      groups: emptyGroups(),
      reports: { [String(period)]: report },
      settings: { catalog: catalogSummary(), integrations: {} },
    };
  }

  if (tab === "settings") {
    return {
      attention: emptyAttention(),
      groups: emptyGroups(),
      reports: {},
      settings: {
        catalog: catalogSummary(),
        integrations: providerStates() as Record<string, string>,
      },
    };
  }

  const core = await withStaff(session, async (tx) => {
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
      with base_clients as (
        select id, ref, full_name, current_status, next_step, updated_at, assigned_staff
        from clients
        where deleted_at is null
        order by updated_at desc
        limit 100
      ),
      preference_summary as (
        select distinct on (p.client_id)
          p.client_id, p.site_code, p.site_name, p.shift_code, p.days, p.hours
        from client_preferences p
        join base_clients b on b.id = p.client_id
        order by p.client_id, case p.rank when 'primary' then 0 else 1 end, p.preference_order
      ),
      next_appointment as (
        select distinct on (a.client_id)
          a.client_id, a.scheduled_at, a.location
        from appointments a
        join base_clients b on b.id = a.client_id
        where a.status = any(${OPEN_APPOINTMENTS}) and a.ends_at >= now()
        order by a.client_id, a.scheduled_at
      ),
      appointment_summary as (
        select
          a.client_id,
          bool_or(
            a.status = any(${OPEN_APPOINTMENTS})
            and (a.scheduled_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date
          ) as has_today_appointment,
          bool_or(
            a.status = any(${OPEN_APPOINTMENTS})
            and (a.scheduled_at at time zone ${TZ})::date > (now() at time zone ${TZ})::date
            and (a.scheduled_at at time zone ${TZ})::date <= (now() at time zone ${TZ})::date + 7
          ) as has_week_appointment
        from appointments a
        join base_clients b on b.id = a.client_id
        group by a.client_id
      ),
      task_summary as (
        select
          t.client_id,
          min(t.due_at) filter (where t.status = any(${OPEN_TASKS})) as next_task_due,
          count(*) filter (where t.status = any(${OPEN_TASKS}))::int as task_count,
          bool_or(
            t.status = any(${OPEN_TASKS})
            and t.due_at is not null
            and (t.due_at at time zone ${TZ})::date <= (now() at time zone ${TZ})::date
          ) as has_today_task,
          bool_or(
            t.status = any(${OPEN_TASKS})
            and t.due_at is not null
            and (t.due_at at time zone ${TZ})::date > (now() at time zone ${TZ})::date
            and (t.due_at at time zone ${TZ})::date <= (now() at time zone ${TZ})::date + 7
          ) as has_week_task
        from tasks t
        join base_clients b on b.id = t.client_id
        group by t.client_id
      ),
      followup_summary as (
        select
          f.client_id,
          min(f.due_date) filter (where f.status = 'open') as next_followup_due,
          bool_or(
            f.status = 'open'
            and f.due_date <= (now() at time zone ${TZ})::date
          ) as has_today_followup,
          bool_or(
            f.status = 'open'
            and f.due_date > (now() at time zone ${TZ})::date
            and f.due_date <= (now() at time zone ${TZ})::date + 7
          ) as has_week_followup
        from followups f
        join base_clients b on b.id = f.client_id
        group by f.client_id
      ),
      document_summary as (
        select d.client_id, count(*)::int as document_count
        from documents d
        join base_clients b on b.id = d.client_id
        group by d.client_id
      ),
      note_summary as (
        select n.client_id, count(*)::int as note_count
        from notes n
        join base_clients b on b.id = n.client_id
        group by n.client_id
      ),
      contact_summary as (
        select c.client_id, count(*)::int as contact_count, max(c.created_at) as last_contact_at
        from contacts c
        join base_clients b on b.id = c.client_id
        group by c.client_id
      )
      select
        b.id,
        b.ref,
        b.full_name,
        b.current_status,
        b.next_step,
        b.updated_at,
        s.display_name as assigned_name,
        p.site_code,
        p.site_name,
        p.shift_code,
        p.days as shift_days,
        p.hours as shift_hours,
        na.scheduled_at as next_appointment,
        na.location as appointment_location,
        ts.next_task_due,
        fs.next_followup_due,
        cs.last_contact_at,
        coalesce(ds.document_count, 0)::int as document_count,
        coalesce(ns.note_count, 0)::int as note_count,
        coalesce(ts.task_count, 0)::int as task_count,
        coalesce(cs.contact_count, 0)::int as contact_count,
        coalesce(aps.has_today_appointment, false) as has_today_appointment,
        coalesce(aps.has_week_appointment, false) as has_week_appointment,
        coalesce(ts.has_today_task, false) as has_today_task,
        coalesce(ts.has_week_task, false) as has_week_task,
        coalesce(fs.has_today_followup, false) as has_today_followup,
        coalesce(fs.has_week_followup, false) as has_week_followup
      from base_clients b
      left join staff s on s.id = b.assigned_staff
      left join preference_summary p on p.client_id = b.id
      left join next_appointment na on na.client_id = b.id
      left join appointment_summary aps on aps.client_id = b.id
      left join task_summary ts on ts.client_id = b.id
      left join followup_summary fs on fs.client_id = b.id
      left join document_summary ds on ds.client_id = b.id
      left join note_summary ns on ns.client_id = b.id
      left join contact_summary cs on cs.client_id = b.id
      order by b.updated_at desc`;

    return {
      attention: {
        new_clients: Number(attention?.new_clients ?? 0),
        appointments_2h: Number(attention?.appointments_2h ?? 0),
        overdue_followups: Number(attention?.overdue_followups ?? 0),
        document_attention: Number(attention?.document_attention ?? 0),
      },
      clients: rows as unknown as DashboardClient[],
    };
  });

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
      client.has_today_appointment ||
      client.has_today_task ||
      client.has_today_followup
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

  return {
    attention: core.attention,
    groups: { today, week, later, completed, stopped },
    reports: {},
    settings: { catalog: catalogSummary(), integrations: {} },
  };
}
