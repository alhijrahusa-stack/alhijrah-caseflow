import "server-only";
import { options } from "@/lib/catalog";
import { withStaff, type StaffSession } from "@/lib/auth";
import { TZ } from "@/lib/queries";

const OPEN_TASKS = ["pending", "in_progress"];
const OPEN_APPOINTMENTS = ["scheduled", "confirmed", "rescheduled"];

export type TeamSiteRow = {
  site_code: string;
  site_name: string;
  shift_code: string;
  shift_name: string;
  job_ready: number;
  waiting_for_job: number;
  total: number;
};

export type TeamMemberWorkload = {
  id: string;
  display_name: string;
  email: string | null;
  role: string;
  active: boolean;
  linked: boolean;
  staff_code: string | null;
  active_clients: number;
  open_tasks: number;
  overdue_tasks: number;
  appointments_today: number;
  followups_due: number;
  job_ready: number;
  waiting_for_job: number;
  sites: TeamSiteRow[];
};

export type TeamWorkloadData = {
  active_staff: number;
  active_clients: number;
  unassigned_clients: number;
  open_tasks: number;
  overdue_tasks: number;
  appointments_today: number;
  followups_due: number;
  members: TeamMemberWorkload[];
  unassigned_sites: TeamSiteRow[];
};

export async function teamWorkload(session: StaffSession): Promise<TeamWorkloadData> {
  const activeCatalogKeys = new Set(options.map((option) => option.key));
  return withStaff(session, async (tx) => {
    const staffRows = await tx`select id,display_name,email,role,active,auth_user_id is not null as linked,staff_code from staff order by active desc,staff_code nulls last,display_name`;
    const clientGroups = await tx`
      with primary_pref as (
        select distinct on (p.client_id) p.client_id,p.site_code,p.site_name,p.job_id,p.shift_code,p.shift_name
        from client_preferences p
        join clients c on c.id=p.client_id
        where c.deleted_at is null and c.current_status not in ('completed','cancelled') and p.rank='primary'
        order by p.client_id,p.preference_order
      )
      select c.assigned_staff as staff_id,p.site_code,p.site_name,p.job_id,p.shift_code,p.shift_name,count(*)::int as n
      from clients c left join primary_pref p on p.client_id=c.id
      where c.deleted_at is null and c.current_status not in ('completed','cancelled')
      group by c.assigned_staff,p.site_code,p.site_name,p.job_id,p.shift_code,p.shift_name`;
    const taskRows = await tx`select assigned_to as staff_id,count(*) filter (where status=any(${OPEN_TASKS}))::int as open_tasks,count(*) filter (where status=any(${OPEN_TASKS}) and due_at is not null and due_at<now())::int as overdue_tasks from tasks where assigned_to is not null group by assigned_to`;
    const appointmentRows = await tx`select c.assigned_staff as staff_id,count(distinct a.id)::int as appointments_today from appointments a join clients c on c.id=a.client_id where c.deleted_at is null and c.current_status not in ('completed','cancelled') and a.status=any(${OPEN_APPOINTMENTS}) and (a.scheduled_at at time zone ${TZ})::date=(now() at time zone ${TZ})::date group by c.assigned_staff`;
    const followupRows = await tx`select c.assigned_staff as staff_id,count(distinct f.id)::int as followups_due from followups f join clients c on c.id=f.client_id where c.deleted_at is null and c.current_status not in ('completed','cancelled') and f.status='open' and f.due_date<=(now() at time zone ${TZ})::date group by c.assigned_staff`;

    const tasks = new Map(taskRows.map((r) => [String(r.staff_id), r]));
    const appointments = new Map(appointmentRows.map((r) => [String(r.staff_id), Number(r.appointments_today)]));
    const followups = new Map(followupRows.map((r) => [String(r.staff_id), Number(r.followups_due)]));
    const perStaff = new Map<string, TeamSiteRow[]>();
    const totals = new Map<string, { total:number; ready:number; waiting:number }>();
    const unassignedSites: TeamSiteRow[] = [];
    let unassignedClients = 0;

    for (const row of clientGroups) {
      const n = Number(row.n ?? 0);
      const key = row.site_code && row.job_id && row.shift_code ? `${row.site_code}|${row.job_id}|${row.shift_code}` : null;
      const ready = key && activeCatalogKeys.has(key) ? n : 0;
      const waiting = n-ready;
      const site: TeamSiteRow = { site_code: String(row.site_code ?? "UNSET"), site_name: String(row.site_name ?? "No site selected"), shift_code: String(row.shift_code ?? "UNSET"), shift_name: String(row.shift_name ?? "No shift selected"), job_ready: ready, waiting_for_job: waiting, total:n };
      if (row.staff_id) {
        const id = String(row.staff_id);
        const list = perStaff.get(id) ?? []; list.push(site); perStaff.set(id,list);
        const t = totals.get(id) ?? { total:0,ready:0,waiting:0 }; t.total+=n; t.ready+=ready; t.waiting+=waiting; totals.set(id,t);
      } else { unassignedClients += n; unassignedSites.push(site); }
    }

    const members: TeamMemberWorkload[] = staffRows.map((member) => {
      const id = String(member.id);
      const t = totals.get(id) ?? { total:0,ready:0,waiting:0 };
      const task = tasks.get(id);
      return {
        id, display_name:String(member.display_name), email:member.email ? String(member.email):null, role:String(member.role), active:Boolean(member.active), linked:Boolean(member.linked), staff_code:member.staff_code ? String(member.staff_code):null,
        active_clients:t.total, open_tasks:Number(task?.open_tasks ?? 0), overdue_tasks:Number(task?.overdue_tasks ?? 0), appointments_today:Number(appointments.get(id) ?? 0), followups_due:Number(followups.get(id) ?? 0), job_ready:t.ready, waiting_for_job:t.waiting,
        sites:(perStaff.get(id) ?? []).sort((a,b)=>b.total-a.total || a.site_code.localeCompare(b.site_code)),
      };
    });

    return {
      active_staff:members.filter((m)=>m.active).length,
      active_clients:members.reduce((s,m)=>s+m.active_clients,0)+unassignedClients,
      unassigned_clients:unassignedClients,
      open_tasks:members.reduce((s,m)=>s+m.open_tasks,0),
      overdue_tasks:members.reduce((s,m)=>s+m.overdue_tasks,0),
      appointments_today:members.reduce((s,m)=>s+m.appointments_today,0),
      followups_due:members.reduce((s,m)=>s+m.followups_due,0),
      members, unassigned_sites:unassignedSites.sort((a,b)=>b.total-a.total || a.site_code.localeCompare(b.site_code)),
    };
  });
}
