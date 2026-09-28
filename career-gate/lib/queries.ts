import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

// Every staff read runs under RLS as the signed-in staff member.
export const TZ = "America/Detroit";
const OPEN_APPT = ["scheduled", "confirmed", "rescheduled"];

export async function staffDirectory(s: StaffSession) {
  return withStaff(s, async (tx) =>
    (await tx`select id, display_name, email, role, active, auth_user_id is not null as linked,
                     staff_code, commission_type, commission_value, eligible_for_round_robin
              from staff order by active desc, staff_code nulls last, display_name`) as unknown as {
      id: string;
      display_name: string;
      email: string | null;
      role: string;
      active: boolean;
      linked: boolean;
      staff_code: string | null;
      commission_type: "fixed" | "percent";
      commission_value: number;
      eligible_for_round_robin: boolean;
    }[]);
}

export async function dashboardCounts(s: StaffSession) {
  return withStaff(s, async (tx) => {
    const [r] = await tx`
      select
        count(*) filter (where current_status = 'new_intake')::int as new_intake,
        count(*) filter (where current_status = 'needs_review')::int as needs_review,
        count(*) filter (where current_status = 'ready_to_apply')::int as ready_to_apply,
        count(*) filter (where current_status = 'application_in_progress')::int as application_in_progress,
        count(*) filter (where current_status = 'screening_pending')::int as screening_pending,
        count(*) filter (where current_status = 'i9_available')::int as i9_available,
        count(*) filter (where current_status = 'ready_for_first_day')::int as ready_for_first_day,
        (select count(*)::int from appointments a
          where a.status = any(${OPEN_APPT})
            and (a.scheduled_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date) as appointments_today,
        (select count(*)::int from followups f
          where f.status = 'open' and f.due_date <= (now() at time zone ${TZ})::date) as followups_due,
        (select count(*)::int from audit_alerts al where al.status = 'open') as audit_alerts
      from clients where deleted_at is null`;
    return r as Record<string, number>;
  });
}

export type ClientListFilters = {
  q?: string;
  status?: string;
  city?: string;
  assigned?: string;
  appointment_date?: string;
  followup?: "due";
  page: number;
  pageSize: number;
};

export async function clientList(s: StaffSession, f: ClientListFilters) {
  return withStaff(s, async (tx) => {
    const term = f.q?.trim() ?? "";
    const digits = term.replace(/\D/g, "");
    const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const where = tx`
      c.deleted_at is null
      ${term ? tx`and (c.ref ilike ${like} or c.full_name ilike ${like} or c.email ilike ${like}
                   ${digits.length >= 3 ? tx`or c.phone like ${`%${digits}%`}` : tx``})` : tx``}
      ${f.status ? tx`and c.current_status = ${f.status}` : tx``}
      ${f.city ? tx`and c.city ilike ${f.city}` : tx``}
      ${f.assigned === "none" ? tx`and c.assigned_staff is null` : f.assigned ? tx`and c.assigned_staff = ${f.assigned}` : tx``}
      ${f.appointment_date ? tx`and exists (select 1 from appointments z where z.client_id = c.id
            and z.status = any(${OPEN_APPT}) and (z.scheduled_at at time zone ${TZ})::date = ${f.appointment_date}::date)` : tx``}
      ${f.followup === "due" ? tx`and exists (select 1 from followups z where z.client_id = c.id and z.status = 'open'
            and z.due_date <= (now() at time zone ${TZ})::date)` : tx``}`;
    const [{ total }] = await tx`select count(*)::int as total from clients c where ${where}`;
    const rows = await tx`
      select c.id, c.ref, c.full_name, c.phone, c.email, c.city, c.current_status, c.next_step, c.updated_at,
             s.display_name as assigned_name, a.scheduled_at as next_appointment, fu.due_date as next_followup
      from clients c
      left join staff s on s.id = c.assigned_staff
      left join lateral (
        select scheduled_at from appointments x
        where x.client_id = c.id and x.status = any(${OPEN_APPT}) and x.ends_at >= now()
        order by scheduled_at limit 1
      ) a on true
      left join lateral (
        select due_date from followups y where y.client_id = c.id and y.status = 'open' order by due_date limit 1
      ) fu on true
      where ${where}
      order by c.updated_at desc, c.id
      limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}`;
    return { rows, total: total as number };
  });
}

export async function clientCities(s: StaffSession) {
  return withStaff(s, async (tx) =>
    (await tx`select distinct city from clients where deleted_at is null and city is not null and city <> '' order by city`).map((r) => r.city as string));
}

export async function clientFile(s: StaffSession, id: string) {
  return withStaff(s, async (tx) => {
    const [client] = await tx`
      select c.*, s.display_name as assigned_name, cb.display_name as created_by_name
      from clients c left join staff s on s.id = c.assigned_staff left join staff cb on cb.id = c.created_by where c.id = ${id}`;
    if (!client) return null;
    const [employment, preferences, documents, extractions, appointments, notes, tasks, contacts, followups, postHire, assessments, activity, authorization, notifications, alerts, agentRun, references] =
      await Promise.all([
        tx`select * from employment_history where client_id = ${id} order by from_date desc nulls last, created_at`,
        tx`select * from client_preferences where client_id = ${id} order by preference_order`,
        tx`select d.id, d.doc_type, d.file_name, d.mime_type, d.size_bytes, d.sha256, d.status, d.quality, d.page_count, d.width, d.height,
                  d.thumbnail_path is not null as has_thumbnail, d.reviewed_at, d.rejection_reason, d.review_note, d.uploaded_at,
                  r.display_name as reviewed_by_name, u.display_name as uploaded_by_name,
                  (select count(*)::int from document_access_log l where l.document_id = d.id and l.access_type <> 'thumbnail') as open_count
           from documents d left join staff r on r.id = d.reviewed_by left join staff u on u.id = d.uploaded_by
           where d.client_id = ${id} order by d.uploaded_at desc`,
        tx`select document_id, provider, model, status, escalated, document_class, fields, reconciliation, error, created_at
           from document_extractions where client_id = ${id} order by created_at desc`,
        tx`select a.*, s.display_name as created_by_name from appointments a left join staff s on s.id = a.created_by_staff
           where a.client_id = ${id} order by a.scheduled_at desc`,
        tx`select n.*, s.display_name as staff_name from notes n join staff s on s.id = n.staff_id where n.client_id = ${id} order by n.created_at desc`,
        tx`select t.*, a.display_name as assigned_to_name, c.display_name as completed_by_name from tasks t
           left join staff a on a.id = t.assigned_to left join staff c on c.id = t.completed_by
           where t.client_id = ${id} order by (t.status in ('completed','cancelled')), t.due_at nulls last, t.created_at desc`,
        tx`select k.*, s.display_name as staff_name from contacts k join staff s on s.id = k.staff_id where k.client_id = ${id} order by k.created_at desc`,
        tx`select f.*, s.display_name as created_by_name, c.display_name as completed_by_name from followups f
           left join staff s on s.id = f.created_by left join staff c on c.id = f.completed_by
           where f.client_id = ${id} order by (f.status <> 'open'), f.due_date`,
        tx`select p.*, s.display_name as staff_name from post_hire_items p left join staff s on s.id = p.staff_id where p.client_id = ${id}`,
        tx`select a.*, s.display_name as updated_by_name from assessments a left join staff s on s.id = a.updated_by
           where a.client_id = ${id} order by a.assessment_type, a.item_key`,
        tx`select l.*, s.display_name as staff_name from activity_log l left join staff s on s.id = l.staff_id
           where l.client_id = ${id} order by l.created_at desc, l.id desc limit 500`,
        tx`select authorization_version, authorization_sha256, printed_name, signature, signed_at, communication_consent
           from client_authorizations where client_id = ${id}`,
        tx`select channel, template, status, provider, error, sent_at, delivered_at, created_at from notifications where client_id = ${id} order by created_at desc`,
        s.staff.role === "staff" ? Promise.resolve([]) : tx`select * from audit_alerts where client_id = ${id} and status = 'open' order by created_at desc`,
        tx`select output, status, model, created_at from agent_runs where client_id = ${id} and agent = 'intake' order by created_at desc limit 1`,
        tx`select key, category, title, body from reference_materials order by category, title`,
      ]);
    return {
      client, employment, preferences, documents, extractions, appointments, notes, tasks, contacts, followups, postHire,
      assessments, activity, authorization: authorization[0] ?? null, notifications, alerts, agentRun: agentRun[0] ?? null, references,
    };
  });
}

export async function appointmentList(s: StaffSession, view: string) {
  return withStaff(s, (tx) => tx`
    select a.*, c.full_name, c.ref, s.display_name as created_by_name
    from appointments a join clients c on c.id = a.client_id left join staff s on s.id = a.created_by_staff
    where c.deleted_at is null and ${
      view === "today"
        ? tx`(a.scheduled_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date`
        : view === "past"
          ? tx`a.scheduled_at < now()`
          : view === "all"
            ? tx`true`
            : tx`a.ends_at >= now() and a.status = any(${OPEN_APPT})`
    }
    order by a.scheduled_at ${view === "past" ? tx`desc` : tx`asc`}
    limit 300`);
}

export async function taskList(s: StaffSession, view: string, assignee?: string) {
  return withStaff(s, (tx) => tx`
    select t.*, (t.due_at < now()) as overdue, c.full_name, c.ref, a.display_name as assigned_to_name, d.display_name as completed_by_name
    from tasks t left join clients c on c.id = t.client_id
    left join staff a on a.id = t.assigned_to left join staff d on d.id = t.completed_by
    where (c.id is null or c.deleted_at is null)
      and ${view === "closed" ? tx`t.status in ('completed','cancelled')` : tx`t.status in ('pending','in_progress')`}
      ${assignee ? tx`and t.assigned_to = ${assignee}` : tx``}
    order by ${view === "closed" ? tx`t.updated_at desc` : tx`t.due_at asc nulls last, t.created_at`}
    limit 300`);
}

export async function followupList(s: StaffSession, view: string) {
  return withStaff(s, (tx) => {
    const today = tx`(now() at time zone ${TZ})::date`;
    return tx`
      select f.*, c.full_name, c.ref, c.phone, s.display_name as created_by_name, d.display_name as completed_by_name
      from followups f join clients c on c.id = f.client_id
      left join staff s on s.id = f.created_by left join staff d on d.id = f.completed_by
      where c.deleted_at is null and ${
        view === "completed"
          ? tx`f.status = 'completed'`
          : view === "upcoming"
            ? tx`f.status = 'open' and f.due_date > ${today}`
            : view === "overdue"
              ? tx`f.status = 'open' and f.due_date < ${today}`
              : tx`f.status = 'open' and f.due_date = ${today}`
      }
      order by ${view === "completed" ? tx`f.completed_at desc` : tx`f.due_date asc`}
      limit 300`;
  });
}

export async function auditAlerts(s: StaffSession, status: string) {
  return withStaff(s, (tx) => tx`
    select a.*, c.ref, c.full_name, r.display_name as resolved_by_name
    from audit_alerts a join clients c on c.id = a.client_id left join staff r on r.id = a.resolved_by
    where a.status = ${status}
    order by case a.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, a.created_at desc
    limit 300`);
}

export async function availability(s: StaffSession) {
  return withStaff(s, async (tx) => ({
    windows: await tx`select * from office_availability order by resource_key, weekday,start_time`,
    blocked: await tx`select b.*, s.display_name as created_by_name from blocked_periods b left join staff s on s.id = b.created_by
                      where b.ends_at >= now() order by b.starts_at`,
  }));
}

export async function reports(s: StaffSession) {
  return withStaff(s, async (tx) => ({
    byStatus: await tx`select current_status, count(*)::int as n from clients where deleted_at is null group by 1 order by 2 desc`,
    bySource: await tx`select source, count(*)::int as n from clients where deleted_at is null group by 1`,
    byStaff: await tx`
      select coalesce(st.display_name, 'Unassigned') as name, count(*)::int as n,
             count(*) filter (where c.current_status in ('completed', 'ready_for_first_day'))::int as ready_or_done
      from clients c left join staff st on st.id = c.assigned_staff where c.deleted_at is null group by 1 order by 2 desc`,
    bySite: await tx`
      select p.site_name, count(distinct p.client_id)::int as n from client_preferences p join clients c on c.id = p.client_id
      where c.deleted_at is null and p.rank = 'primary' group by 1 order by 2 desc`,
    last30: await tx`select count(*)::int as n from clients where deleted_at is null and created_at >= now() - interval '30 days'`,
    docs: await tx`select status, count(*)::int as n from documents d join clients c on c.id = d.client_id where c.deleted_at is null group by 1`,
    alerts: await tx`select severity, count(*)::int as n from audit_alerts where status = 'open' group by 1`,
  }));
}
