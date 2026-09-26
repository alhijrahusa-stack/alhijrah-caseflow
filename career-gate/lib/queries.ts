import "server-only";
import { sql } from "@/lib/db";
import { OPEN_APPOINTMENT } from "@/lib/domain";

export const TZ = "America/Detroit";
const openAppt = OPEN_APPOINTMENT as unknown as string[];

export async function staffDirectory() {
  return (await sql()`select id, name from staff_directory where active order by name`) as unknown as { id: string; name: string }[];
}

export async function dashboardCounts() {
  const [r] = await sql()`
    select
      count(*) filter (where current_status = 'new_intake')::int as new_intake,
      count(*) filter (where current_status = 'needs_review')::int as needs_review,
      count(*) filter (where current_status = 'ready_to_apply')::int as ready_to_apply,
      count(*) filter (where current_status = 'application_in_progress')::int as application_in_progress,
      count(*) filter (where current_status = 'screening_pending')::int as screening_pending,
      count(*) filter (where current_status = 'i9_available')::int as i9_available,
      count(*) filter (where current_status = 'ready_for_first_day')::int as ready_for_first_day,
      (select count(*)::int from appointments
        where status = any(${openAppt})
          and (scheduled_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date) as appointments_today,
      (select count(*)::int from followups
        where status = 'open' and due_date <= (now() at time zone ${TZ})::date) as followups_due
    from clients`;
  return r as Record<string, number>;
}

export type ClientListFilters = {
  q?: string;
  status?: string;
  city?: string;
  handled_by?: string;
  appointment_date?: string;
  followup?: string; // "due" | "overdue" | "today"
};

export async function clientList(f: ClientListFilters, limit = 200) {
  const db = sql();
  const term = f.q?.trim() ?? "";
  const digits = term.replace(/\D/g, "");
  const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  return db`
    select c.id, c.ref, c.full_name, c.phone, c.email, c.city, c.current_status, c.next_step, c.updated_at,
           s.name as handled_by_name,
           a.scheduled_at as next_appointment,
           f.due_date as next_followup
    from clients c
    left join staff_directory s on s.id = c.handled_by
    left join lateral (
      select scheduled_at from appointments x
      where x.client_id = c.id and x.status = any(${openAppt}) and x.scheduled_at >= now() - interval '12 hours'
      order by scheduled_at limit 1
    ) a on true
    left join lateral (
      select due_date from followups y where y.client_id = c.id and y.status = 'open' order by due_date limit 1
    ) f on true
    where true
      ${term ? db`and (c.ref ilike ${like} or c.full_name ilike ${like} or c.email ilike ${like}
                   ${digits.length >= 3 ? db`or c.phone like ${`%${digits}%`}` : db``})` : db``}
      ${f.status ? db`and c.current_status = ${f.status}` : db``}
      ${f.city ? db`and c.city ilike ${f.city}` : db``}
      ${f.handled_by ? db`and c.handled_by = ${f.handled_by}` : db``}
      ${f.appointment_date ? db`and exists (select 1 from appointments z where z.client_id = c.id
            and z.status = any(${openAppt}) and (z.scheduled_at at time zone ${TZ})::date = ${f.appointment_date}::date)` : db``}
      ${f.followup === "due" ? db`and exists (select 1 from followups z where z.client_id = c.id and z.status = 'open'
            and z.due_date <= (now() at time zone ${TZ})::date)` : db``}
    order by c.updated_at desc
    limit ${limit}`;
}

export async function clientCities() {
  const rows = await sql()`select distinct city from clients where city is not null and city <> '' order by city`;
  return rows.map((r) => r.city as string);
}

export async function clientFile(id: string) {
  const db = sql();
  const [client] = await db`
    select c.*, s.name as handled_by_name from clients c left join staff_directory s on s.id = c.handled_by where c.id = ${id}`;
  if (!client) return null;
  const [employment, preferences, documents, appointments, notes, tasks, contacts, followups, postHire, activity, authorization] =
    await Promise.all([
      db`select * from employment_history where client_id = ${id} order by from_date desc nulls last, created_at`,
      db`select * from client_preferences where client_id = ${id} order by preference_order`,
      db`select d.*, r.name as reviewed_by_name, u.name as uploaded_by_name,
                (select count(*)::int from document_access_log l where l.document_id = d.id) as open_count
         from documents d left join staff_directory r on r.id = d.reviewed_by left join staff_directory u on u.id = d.uploaded_by
         where d.client_id = ${id} order by d.uploaded_at desc`,
      db`select a.*, s.name as handled_by_name from appointments a left join staff_directory s on s.id = a.handled_by
         where a.client_id = ${id} order by a.scheduled_at desc`,
      db`select n.*, s.name as handled_by_name from notes n join staff_directory s on s.id = n.handled_by
         where n.client_id = ${id} order by n.created_at desc`,
      db`select t.*, a.name as assigned_to_name, c.name as completed_by_name from tasks t
         left join staff_directory a on a.id = t.assigned_to left join staff_directory c on c.id = t.completed_by
         where t.client_id = ${id} order by (t.status in ('completed','cancelled')), t.due_at nulls last, t.created_at desc`,
      db`select k.*, s.name as handled_by_name from contacts k join staff_directory s on s.id = k.handled_by
         where k.client_id = ${id} order by k.created_at desc`,
      db`select f.*, s.name as handled_by_name, c.name as completed_by_name from followups f
         left join staff_directory s on s.id = f.handled_by left join staff_directory c on c.id = f.completed_by
         where f.client_id = ${id} order by (f.status <> 'open'), f.due_date`,
      db`select p.*, s.name as handled_by_name from post_hire_items p left join staff_directory s on s.id = p.handled_by
         where p.client_id = ${id}`,
      db`select l.*, s.name as handled_by_name from activity_log l left join staff_directory s on s.id = l.handled_by
         where l.client_id = ${id} order by l.created_at desc, l.id desc limit 500`,
      db`select authorization_version, printed_name, signature, signed_at, communication_consent
         from client_authorizations where client_id = ${id}`,
    ]);
  return { client, employment, preferences, documents, appointments, notes, tasks, contacts, followups, postHire, activity, authorization: authorization[0] ?? null };
}

export async function appointmentList(view: string) {
  const db = sql();
  return db`
    select a.*, c.full_name, c.ref, s.name as handled_by_name
    from appointments a join clients c on c.id = a.client_id left join staff_directory s on s.id = a.handled_by
    where ${
      view === "today"
        ? db`(a.scheduled_at at time zone ${TZ})::date = (now() at time zone ${TZ})::date`
        : view === "past"
          ? db`a.scheduled_at < now()`
          : view === "all"
            ? db`true`
            : db`a.scheduled_at >= now() - interval '12 hours' and a.status = any(${openAppt})`
    }
    order by a.scheduled_at ${view === "past" ? db`desc` : db`asc`}
    limit 300`;
}

export async function taskList(view: string, assignee?: string) {
  const db = sql();
  return db`
    select t.*, c.full_name, c.ref, a.name as assigned_to_name, d.name as completed_by_name
    from tasks t left join clients c on c.id = t.client_id
    left join staff_directory a on a.id = t.assigned_to left join staff_directory d on d.id = t.completed_by
    where ${view === "closed" ? db`t.status in ('completed','cancelled')` : db`t.status in ('pending','in_progress')`}
      ${assignee ? db`and t.assigned_to = ${assignee}` : db``}
    order by ${view === "closed" ? db`t.updated_at desc` : db`t.due_at asc nulls last, t.created_at`}
    limit 300`;
}

export async function followupList(view: string) {
  const db = sql();
  const today = db`(now() at time zone ${TZ})::date`;
  return db`
    select f.*, c.full_name, c.ref, c.phone, s.name as handled_by_name, d.name as completed_by_name
    from followups f join clients c on c.id = f.client_id
    left join staff_directory s on s.id = f.handled_by left join staff_directory d on d.id = f.completed_by
    where ${
      view === "completed"
        ? db`f.status = 'completed'`
        : view === "upcoming"
          ? db`f.status = 'open' and f.due_date > ${today}`
          : view === "overdue"
            ? db`f.status = 'open' and f.due_date < ${today}`
            : db`f.status = 'open' and f.due_date = ${today}`
    }
    order by ${view === "completed" ? db`f.completed_at desc` : db`f.due_date asc`}
    limit 300`;
}
