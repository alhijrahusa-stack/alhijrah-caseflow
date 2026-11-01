import { StaffLabel } from "@/components/staff/StaffLabel";
import { StaffText } from "@/components/staff/StaffLanguage";
import Link from "next/link";
import { StaffNav } from "@/components/staff/StaffPageLabels";
import { redirect } from "next/navigation";
import { AssignmentsPanel } from "@/components/staff/AssignmentsPanel";
import { RealtimeRefresher } from "@/components/staff/RealtimeRefresher";
import { TeamSettings } from "@/components/staff/TeamSettings";
import { getStaffSession } from "@/lib/auth";
import { STAFF_ELIGIBLE_PERMISSIONS } from "@/lib/authz";
import { assignmentData } from "@/lib/operational-assignments";
import { operationalActivity } from "@/lib/operational-activity";
import { teamWorkload } from "@/lib/operational-team";
import { permissionStaffDirectory } from "@/lib/staff-permissions";

const TABS=new Set(["team","assignments","activity"]);

export default async function StaffPage({searchParams}:{searchParams:Promise<{tab?:string;scope?:string;member?:string}>}){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  const sp=await searchParams;
  const tab=TABS.has(sp.tab??"")?sp.tab!:"team";
  const management=session.staff.role!=="staff";
  if(tab==="assignments"&&!management)return <p className="ops-error"><StaffText en="403 — Management access required." ar="403 — يلزم تصريح إداري."/></p>;

  const team=tab==="team"?await teamWorkload(session):null;
  const staff=tab==="team"&&management?await permissionStaffDirectory(session):null;
  const selectedMember=tab==="team"&&sp.member&&team?.members.some((m)=>m.active&&m.id===sp.member)?sp.member:null;
  const assignments=tab==="assignments"?await assignmentData(session):null;
  const activity=tab==="activity"?await operationalActivity(session):null;

  return <div className="ops-page space-y-4">
    <header className="ops-hero"><div><p className="ops-kicker"><StaffText en="CAREER GATE · STAFF OPERATIONS" ar="CAREER GATE · عمليات الفريق"/></p><h1><StaffText en="Staff" ar="الموظفون"/></h1><p><StaffText en="One team center for workload, assignments and operational activity." ar="مركز موحّد لحمل الفريق وتوزيع الملفات والنشاط التشغيلي."/></p></div><RealtimeRefresher/></header>
    <StaffNav className="ops-segmented w-fit" aria-label="Staff sections" ariaLabelAr="أقسام الموظفين"><Link href="/staff/staff?tab=team" data-active={tab==="team"}><StaffText en="Team" ar="الفريق"/></Link>{management&&<Link href="/staff/staff?tab=assignments" data-active={tab==="assignments"}><StaffText en="Assignments" ar="توزيع الملفات"/></Link>}<Link href="/staff/staff?tab=activity" data-active={tab==="activity"}><StaffText en="Activity" ar="النشاط"/></Link></StaffNav>

    {team&&<div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Active Staff" value={team.active_staff}/><Metric label="Active Clients" value={team.active_clients}/><Metric label="Unassigned Clients" value={team.unassigned_clients}/><Metric label="Open Tasks" value={team.open_tasks}/><Metric label="Overdue Tasks" value={team.overdue_tasks}/><Metric label="Appointments Today" value={team.appointments_today}/><Metric label="Follow-Ups Due" value={team.followups_due}/></div>
      {selectedMember&&<div role="status" className="flex items-center justify-between gap-3 text-sm text-amber-200"><span><StaffText en="Team member workload ·" ar="حمل الموظف ·"/> {team.members.find((m)=>m.id===selectedMember)?.display_name}</span><Link href="/staff/staff?tab=team" className="underline underline-offset-4"><StaffText en="Show all team members" ar="عرض جميع الموظفين"/></Link></div>}
      <section className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3" data-testid="team-member-grid">{team.members.filter((m)=>m.active&&(!selectedMember||m.id===selectedMember)).map((m)=><article key={m.id} className="staff-glass rounded-2xl p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-100">{m.display_name}</h2><p className="mt-1 text-sm text-slate-500">{m.staff_code??"—"} · {m.role} · <StaffText en={m.linked?"AUTH LINKED":"NOT LINKED"} ar={m.linked?"حساب الدخول مرتبط":"حساب الدخول غير مرتبط"}/></p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300"><StaffText en="ACTIVE" ar="نشط"/></span></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><Small label="Clients" value={m.active_clients}/><Small label="Tasks" value={m.open_tasks}/><Small label="Overdue" value={m.overdue_tasks}/><Small label="Appointments" value={m.appointments_today}/><Small label="Follow-Ups" value={m.followups_due}/><Small label="Job Ready" value={m.job_ready}/></div><div className="mt-4 space-y-2">{m.sites.map((site)=><div key={`${site.site_code}-${site.shift_code}`} className="rounded-xl border border-white/[.06] bg-white/[.02] p-3"><div className="flex justify-between gap-3"><strong className="text-sm text-slate-200">{site.site_name} · {site.shift_name}</strong><b className="tabular-nums text-slate-100">{site.total}</b></div><div className="mt-1 flex gap-3 text-xs"><span className="text-emerald-300"><StaffText en="Job Ready" ar="جاهز للوظيفة"/> {site.job_ready}</span><span className="text-amber-300"><StaffText en="Waiting" ar="قيد الانتظار"/> {site.waiting_for_job}</span></div></div>)}</div></article>)}</section>
      {team.unassigned_clients>0&&<section className="ops-glass-card border border-amber-400/20"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold text-slate-100"><StaffText en="Unassigned Files" ar="الملفات غير المسندة"/></h2><p className="text-sm text-slate-500">{team.unassigned_clients} <StaffText en="active files require an owner." ar="ملفات نشطة تحتاج موظفاً مسؤولاً."/></p></div>{management&&<Link href="/staff/staff?tab=assignments&scope=unassigned" className="ops-primary-button"><StaffText en="Assign Files" ar="إسناد الملفات"/></Link>}</div></section>}
      {staff&&<section className="ops-glass-card"><h2 className="mb-4 text-lg font-semibold text-slate-100"><StaffText en="Team Administration" ar="إدارة الفريق"/></h2><TeamSettings staff={staff} meId={session.staff.id} canManageRoles={session.staff.role==="admin"} staffEligiblePermissions={[...STAFF_ELIGIBLE_PERMISSIONS]}/></section>}
    </div>}

    {assignments&&<AssignmentsPanel staff={assignments.staff} clients={assignments.clients} roundRobinEnabled={assignments.settings.round_robin_enabled} isAdmin={session.staff.role==="admin"} scope={sp.scope}/>} 

    {activity&&<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><Metric label="Operational Activity · Last 1 Minute" value={<StaffText en={`${activity.last_minute} events`} ar={`${activity.last_minute} حدث`}/>}/><Metric label="Operational Activity · Last 5 Minutes" value={<StaffText en={`${activity.last_five_minutes} events`} ar={`${activity.last_five_minutes} حدث`}/>}/></div><section className="ops-glass-card overflow-x-auto p-0"><table className="table"><thead><tr><th><StaffText en="Time" ar="الوقت"/></th><th><StaffText en="Staff" ar="الموظفون"/></th><th><StaffText en="Action" ar="الإجراء"/></th><th><StaffText en="Client" ar="العميل"/></th></tr></thead><tbody>{activity.recent.map((row)=><tr key={row.id}><td className="whitespace-nowrap text-slate-500">{new Date(row.created_at).toLocaleString("en-US",{timeZone:"America/Detroit"})}</td><td>{row.staff_name??"System"}</td><td>{row.action.replace(/_/g," ")}</td><td>{row.client_id?<Link href={`/staff/client/${row.client_id}`} className="text-cyan-300">{row.client_name??row.client_ref??"Open"}</Link>:"—"}</td></tr>)}</tbody></table></section></div>}
  </div>;
}

function Metric({label,value}:{label:string;value:React.ReactNode}){return <div className="staff-kpi rounded-2xl p-4"><p className="text-sm text-slate-500"><StaffLabel en={label}/></p><p className="mt-2 text-3xl font-semibold tabular-nums text-slate-100">{value}</p></div>}
function Small({label,value}:{label:string;value:number}){return <div className="rounded-xl bg-white/[.025] p-2"><b className="block text-xl tabular-nums text-slate-100">{value}</b><span className="text-xs text-slate-500"><StaffLabel en={label}/></span></div>}
