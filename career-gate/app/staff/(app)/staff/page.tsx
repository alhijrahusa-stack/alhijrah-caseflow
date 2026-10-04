import Link from "next/link";
import { redirect } from "next/navigation";
import { AssignmentsPanel } from "@/components/staff/AssignmentsPanel";
import { PermissionSettings } from "@/components/staff/PermissionSettings";
import { RealtimeRefresher } from "@/components/staff/RealtimeRefresher";
import { TeamSettings } from "@/components/staff/TeamSettings";
import { getStaffSession } from "@/lib/auth";
import { assignmentData } from "@/lib/operational-assignments";
import { operationalActivity } from "@/lib/operational-activity";
import { teamWorkload } from "@/lib/operational-team";
import { staffPermissionDirectory } from "@/lib/staff-permission-directory";
import { staffDirectory } from "@/lib/queries";

const TABS=new Set(["team","assignments","activity"]);

export default async function StaffPage({searchParams}:{searchParams:Promise<{tab?:string;scope?:string;member?:string}>}){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  const sp=await searchParams;
  const tab=TABS.has(sp.tab??"")?sp.tab!:"team";
  const management=session.staff.role!=="staff";
  if(tab==="assignments"&&!management)return <p className="ops-error">403 — Management access required.</p>;

  const team=tab==="team"?await teamWorkload(session):null;
  const staff=tab==="team"&&session.staff.role==="admin"?await staffDirectory(session):null;
  const permissionStaff=tab==="team"&&management?await staffPermissionDirectory(session):null;
  const assignments=tab==="assignments"?await assignmentData(session):null;
  const activity=tab==="activity"?await operationalActivity(session):null;

  return <div className="ops-page space-y-4">
    <header className="ops-hero"><div><p className="ops-kicker">CAREER GATE · STAFF OPERATIONS</p><h1>Staff</h1><p>One team center for workload, assignments and operational activity.</p></div><RealtimeRefresher/></header>
    <nav className="ops-segmented w-fit" aria-label="Staff sections"><Link href="/staff/staff?tab=team" data-active={tab==="team"}>Team</Link>{management&&<Link href="/staff/staff?tab=assignments" data-active={tab==="assignments"}>Assignments</Link>}<Link href="/staff/staff?tab=activity" data-active={tab==="activity"}>Activity</Link></nav>

    {team&&<div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Active Staff" value={team.active_staff}/><Metric label="Active Clients" value={team.active_clients}/><Metric label="Unassigned Clients" value={team.unassigned_clients}/><Metric label="Open Tasks" value={team.open_tasks}/><Metric label="Overdue Tasks" value={team.overdue_tasks}/><Metric label="Appointments Today" value={team.appointments_today}/><Metric label="Follow-Ups Due" value={team.followups_due}/></div>
      <section className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">{team.members.filter((m)=>m.active).map((m)=><article key={m.id} className="staff-glass rounded-2xl p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-100">{m.display_name}</h2><p className="mt-1 text-sm text-slate-500">{m.staff_code??"—"} · {m.role} · {m.linked?"AUTH LINKED":"NOT LINKED"}</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300">ACTIVE</span></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><Small label="Clients" value={m.active_clients}/><Small label="Tasks" value={m.open_tasks}/><Small label="Overdue" value={m.overdue_tasks}/><Small label="Appointments" value={m.appointments_today}/><Small label="Follow-Ups" value={m.followups_due}/><Small label="Job Ready" value={m.job_ready}/></div><div className="mt-4 space-y-2">{m.sites.map((site)=><div key={`${site.site_code}-${site.shift_code}`} className="rounded-xl border border-white/[.06] bg-white/[.02] p-3"><div className="flex justify-between gap-3"><strong className="text-sm text-slate-200">{site.site_name} · {site.shift_name}</strong><b className="tabular-nums text-slate-100">{site.total}</b></div><div className="mt-1 flex gap-3 text-xs"><span className="text-emerald-300">Job Ready {site.job_ready}</span><span className="text-amber-300">Waiting {site.waiting_for_job}</span></div></div>)}</div></article>)}</section>
      {team.unassigned_clients>0&&<section className="ops-glass-card border border-amber-400/20"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold text-slate-100">Unassigned Files</h2><p className="text-sm text-slate-500">{team.unassigned_clients} active files require an owner.</p></div>{management&&<Link href="/staff/staff?tab=assignments&scope=unassigned" className="ops-primary-button">Assign Files</Link>}</div></section>}
      {permissionStaff&&<section className="ops-glass-card"><h2 className="mb-1 text-lg font-semibold text-slate-100">Access Control</h2><p className="mb-4 text-sm text-slate-500">Role ceiling plus granular Full or Custom access.</p><PermissionSettings staff={permissionStaff} actorRole={session.staff.role as "admin"|"manager"} actorId={session.staff.id}/></section>}
      {staff&&<section className="ops-glass-card"><h2 className="mb-4 text-lg font-semibold text-slate-100">Team Administration</h2><TeamSettings staff={staff} meId={session.staff.id}/></section>}
    </div>}

    {assignments&&<AssignmentsPanel staff={assignments.staff} clients={assignments.clients} roundRobinEnabled={assignments.settings.round_robin_enabled} isAdmin={session.staff.role==="admin"} scope={sp.scope}/>} 

    {activity&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><Metric label="Operational Activity · Last 1 Minute" value={`${activity.last_minute} events`}/><Metric label="Operational Activity · Last 5 Minutes" value={`${activity.last_five_minutes} events`}/></div><section className="ops-glass-card overflow-x-auto p-0"><table className="table"><thead><tr><th>Time</th><th>Staff</th><th>Action</th><th>Client</th></tr></thead><tbody>{activity.recent.map((row)=><tr key={row.id}><td className="whitespace-nowrap text-slate-500">{new Date(row.created_at).toLocaleString("en-US",{timeZone:"America/Detroit"})}</td><td>{row.staff_name??"System"}</td><td>{row.action.replace(/_/g," ")}</td><td>{row.client_id?<Link href={`/staff/client/${row.client_id}`} className="text-cyan-300">{row.client_name??row.client_ref??"Open"}</Link>:"—"}</td></tr>)}</tbody></table></section></div>}
  </div>;
}

function Metric({label,value}:{label:string;value:string|number}){return <div className="staff-kpi rounded-2xl p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums text-slate-100">{value}</p></div>}
function Small({label,value}:{label:string;value:number}){return <div className="rounded-xl bg-white/[.025] p-2"><b className="block text-xl tabular-nums text-slate-100">{value}</b><span className="text-xs text-slate-500">{label}</span></div>}
