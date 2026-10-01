import Link from "next/link";
import { RealtimeRefresher } from "@/components/staff/RealtimeRefresher";
import type { DashboardCommandData } from "@/lib/operational-dashboard";

function Kpi({label,value,href,tone="neutral"}:{label:string;value:string|number;href?:string;tone?:"neutral"|"warn"|"danger"|"good"}){
  const cls=tone==="danger"?"text-red-300":tone==="warn"?"text-amber-300":tone==="good"?"text-emerald-300":"text-slate-100";
  const body=<div className="staff-kpi rounded-2xl p-4"><p className="text-sm text-slate-400">{label}</p><p className={`mt-2 text-3xl font-semibold tabular-nums ${cls}`}>{value}</p></div>;
  return href?<Link href={href} className="block transition hover:-translate-y-px">{body}</Link>:body;
}

export function OperationalDashboard({data}:{data:DashboardCommandData}){
  const activeMembers=data.team.members.filter((m)=>m.active);
  return <div className="ops-page space-y-5">
    <header className="ops-hero">
      <div><p className="ops-kicker">CAREER GATE · COMMAND CENTER</p><h1>Operational Dashboard</h1><p>Active work, team load and exceptions that require action now.</p></div>
      <RealtimeRefresher />
    </header>

    <section>
      <div className="mb-3 flex items-center justify-between"><div><h2 className="text-xl font-semibold text-slate-100">Attention</h2><p className="text-sm text-slate-500">Current active workload only.</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="New Clients" value={data.new_clients} href="/staff/clients?status=new_intake"/>
        <Kpi label="Appointments · Next 2 Hours" value={data.appointments_2h} href="/staff/appointments"/>
        <Kpi label="Tasks Due Today" value={data.tasks_due} href="/staff/tasks"/>
        <Kpi label="Overdue Tasks" value={data.overdue_tasks} href="/staff/tasks" tone={data.overdue_tasks?"danger":"neutral"}/>
        <Kpi label="Overdue Follow-Ups" value={data.overdue_followups} href="/staff/follow-ups" tone={data.overdue_followups?"danger":"neutral"}/>
        <Kpi label="Documents Needing Action" value={data.document_attention} tone={data.document_attention?"warn":"neutral"}/>
        <Kpi label="Requirements Needing Action" value={data.requirements_attention} tone={data.requirements_attention?"warn":"neutral"}/>
        <Kpi label="Payments Pending" value={data.payments_pending} href="/staff/accounting" tone={data.payments_pending?"warn":"neutral"}/>
        <Kpi label="Open Audit Alerts" value={data.open_audit_alerts} href="/staff/audit-alerts" tone={data.open_audit_alerts?"danger":"neutral"}/>
        <Kpi label="Unassigned Files" value={data.unassigned_clients} href="/staff/staff?tab=assignments&scope=unassigned" tone={data.unassigned_clients?"warn":"neutral"}/>
        <Kpi label="Completed This Month" value={data.completed_this_month} href="/staff/clients?view=completed" tone="good"/>
      </div>
    </section>

    <section className="grid gap-4 xl:grid-cols-[1.4fr_.6fr]">
      <div className="ops-glass-card">
        <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-slate-100">Team Workload</h2><p className="mt-1 text-sm text-slate-500">Compact active-work summary. Full drill-down lives in Staff.</p></div><Link href="/staff/staff?tab=team" className="ops-primary-button">View Team</Link></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {activeMembers.map((member)=><Link key={member.id} href={`/staff/staff?tab=team&member=${member.id}`} className="staff-glass rounded-2xl p-4 transition hover:-translate-y-px hover:border-amber-300/30">
            <div className="flex items-center justify-between gap-3"><strong className="truncate text-base text-slate-100">{member.display_name}</strong><span className="rounded-full border border-white/10 px-2 py-1 text-xs uppercase text-slate-400">{member.role}</span></div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div><b className="block text-xl tabular-nums text-slate-100">{member.active_clients}</b><span className="text-xs text-slate-500">files</span></div><div><b className="block text-xl tabular-nums text-slate-100">{member.open_tasks}</b><span className="text-xs text-slate-500">tasks</span></div><div><b className={`block text-xl tabular-nums ${member.overdue_tasks?"text-red-300":"text-slate-100"}`}>{member.overdue_tasks}</b><span className="text-xs text-slate-500">overdue</span></div></div>
            <div className="mt-3 space-y-1.5 text-sm text-slate-400">{member.sites.slice(0,3).map((site)=><div key={`${site.site_code}-${site.shift_code}`} className="flex justify-between gap-3"><span className="truncate">{site.site_name} · {site.shift_name}</span><b className="tabular-nums text-slate-200">{site.total}</b></div>)}</div>
          </Link>)}
        </div>
      </div>

      <div className="ops-glass-card">
        <h2 className="text-xl font-semibold text-slate-100">Operational Efficiency</h2>
        <p className="mt-1 text-sm text-slate-500">Assigned, no overdue work, no blocking document and no missing/rejected requirement.</p>
        <div className="mt-6 flex items-end gap-2"><strong className="text-5xl font-semibold tabular-nums text-slate-100">{data.efficiency==null?"N/A":`${data.efficiency}%`}</strong></div>
        {data.efficiency!=null&&<div className="mt-5 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-emerald-400/80" style={{width:`${Math.max(0,Math.min(100,data.efficiency))}%`}}/></div>}
        <dl className="mt-6 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Active Files</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{data.team.active_clients}</dd></div><div><dt className="text-slate-500">Unassigned</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{data.team.unassigned_clients}</dd></div></dl>
      </div>
    </section>
  </div>;
}
