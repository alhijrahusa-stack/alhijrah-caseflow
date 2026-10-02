import Link from "next/link";
import { RealtimeRefresher } from "@/components/staff/RealtimeRefresher";
import { STATUS_LABELS, type Status } from "@/lib/domain";
import type { DashboardCommandData } from "@/lib/operational-dashboard";

function Kpi({label,value,href,tone="neutral",detail}:{label:string;value:string|number;href?:string;tone?:"neutral"|"warn"|"danger"|"good";detail?:string}){
  const cls=tone==="danger"?"text-red-300":tone==="warn"?"text-amber-300":tone==="good"?"text-emerald-300":"text-slate-100";
  const body=<div className="staff-kpi rounded-2xl p-4"><p className="text-sm text-slate-400">{label}</p><p className={`mt-2 text-3xl font-semibold tabular-nums ${cls}`}>{value}</p>{detail&&<p className="mt-1 text-xs text-slate-500">{detail}</p>}</div>;
  return href?<Link href={href} className="block transition hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70">{body}</Link>:body;
}

function Money({value}:{value:number}){
  return <>{new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(value)}</>;
}

function SectionTitle({title,subtitle,href,label}:{title:string;subtitle:string;href?:string;label?:string}){
  return <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-xl font-semibold text-slate-100">{title}</h2><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>{href&&<Link href={href} className="text-sm font-medium text-amber-200 hover:text-amber-100">{label??"Open"}</Link>}</div>;
}

export function OperationalDashboard({data}:{data:DashboardCommandData}){
  const activeMembers=data.team.members.filter((m)=>m.active);
  const configuredProviders=data.system?Object.values(data.system.providers).filter((s)=>s==="CONFIGURED").length:0;
  const totalProviders=data.system?Object.keys(data.system.providers).length:0;
  return <div className="ops-page space-y-6">
    <header className="ops-hero">
      <div><p className="ops-kicker">CAREER GATE · EXECUTIVE COMMAND CENTER</p><h1>Operations Command Center</h1><p>Exceptions first. Workload, readiness, finance and system health from canonical operational data.</p></div>
      <div className="flex items-center gap-3"><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${data.exceptions>0?"border-amber-300/30 bg-amber-300/10 text-amber-200":"border-emerald-300/30 bg-emerald-300/10 text-emerald-200"}`}>{data.exceptions} exceptions</span><RealtimeRefresher /></div>
    </header>

    <section aria-labelledby="now-heading">
      <SectionTitle title="Now" subtitle="Items requiring operational attention."/>
      <h2 id="now-heading" className="sr-only">Current exceptions</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Overdue Tasks" value={data.overdue_tasks} href="/staff/tasks" tone={data.overdue_tasks?"danger":"good"}/>
        <Kpi label="Overdue Follow-Ups" value={data.overdue_followups} href="/staff/follow-ups" tone={data.overdue_followups?"danger":"good"}/>
        <Kpi label="Documents Needing Action" value={data.document_attention} href="/staff/clients" tone={data.document_attention?"warn":"good"}/>
        <Kpi label="Unassigned Files" value={data.unassigned_clients} href="/staff/staff?tab=assignments&scope=unassigned" tone={data.unassigned_clients?"warn":"good"}/>
        {data.system&&<><Kpi label="Dead Jobs" value={data.system.queue.dead} tone={data.system.queue.dead?"danger":"good"}/><Kpi label="Delivery Failures · 24h" value={data.system.failed_notifications_24h} tone={data.system.failed_notifications_24h?"danger":"good"}/><Kpi label="Open Audit Alerts" value={data.system.open_audit_alerts} href="/staff/audit-alerts" tone={data.system.open_audit_alerts?"warn":"good"}/><Kpi label="System" value={data.system.status} tone={data.system.status==="HEALTHY"?"good":data.system.status==="DEGRADED"?"warn":"danger"} detail={`DB ${data.system.db_ms} ms`}/></>}
      </div>
    </section>

    <section aria-labelledby="today-heading">
      <SectionTitle title="Today" subtitle="Immediate production workload." href="/staff/today" label="Open Today"/>
      <h2 id="today-heading" className="sr-only">Today's workload</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="New Clients" value={data.new_clients} href="/staff/clients"/>
        <Kpi label="Appointments · Next 2 Hours" value={data.appointments_2h} href="/staff/appointments" tone={data.appointments_2h?"warn":"neutral"}/>
        <Kpi label="Tasks Due Today" value={data.tasks_due} href="/staff/tasks"/>
        <Kpi label="Completed This Month" value={data.completed_this_month} href="/staff/clients?view=completed" tone="good"/>
      </div>
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <div className="ops-glass-card">
        <SectionTitle title="Readiness" subtitle="Derived from canonical requirements."/>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Ready" value={data.readiness.ready} tone="good"/>
          <Kpi label="Nearly Ready" value={data.readiness.nearly_ready}/>
          <Kpi label="Blocked" value={data.readiness.blocked} tone={data.readiness.blocked?"warn":"good"}/>
          <Kpi label="Missing Requirements" value={data.readiness.missing_requirements} tone={data.readiness.missing_requirements?"warn":"good"}/>
        </div>
      </div>

      <div className="ops-glass-card">
        <SectionTitle title="Finance" subtitle="Ledger-backed operational projection." href="/staff/accounting" label="Open Accounting"/>
        <div className="grid grid-cols-2 gap-3">
          <Kpi label="Receivables" value={<Money value={data.finance.receivables}/> as never} tone={data.finance.receivables>0?"warn":"good"}/>
          <Kpi label="Collected · Month" value={<Money value={data.finance.collected_this_month}/> as never} tone="good"/>
          <Kpi label="Refunds · Month" value={<Money value={data.finance.refunds_this_month}/> as never}/>
          <Kpi label="Commissions Attention" value={data.finance.commissions_attention} tone={data.finance.commissions_attention?"warn":"neutral"}/>
        </div>
      </div>
    </section>

    <section className="ops-glass-card">
      <SectionTitle title="Pipeline" subtitle="Active workload by authoritative workflow status." href="/staff/pipeline" label="Open Pipeline"/>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {data.pipeline.map((p)=><Link key={p.status} href={`/staff/clients?status=${encodeURIComponent(p.status)}`} className="staff-glass flex items-center justify-between rounded-xl px-4 py-3 transition hover:border-amber-300/30"><span className="truncate text-sm text-slate-300">{STATUS_LABELS[p.status as Status]??p.status.replace(/_/g," ")}</span><strong className="ml-3 tabular-nums text-slate-100">{p.total}</strong></Link>)}
      </div>
    </section>

    <section className="grid gap-4 xl:grid-cols-[1.4fr_.6fr]">
      <div className="ops-glass-card">
        <SectionTitle title="Team Workload" subtitle="Active files and due-work pressure." href="/staff/staff?tab=team" label="View Team"/>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {activeMembers.map((member)=><Link key={member.id} href={`/staff/staff?tab=team&member=${member.id}`} className="staff-glass rounded-2xl p-4 transition hover:-translate-y-px hover:border-amber-300/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70">
            <div className="flex items-center justify-between gap-3"><strong className="truncate text-base text-slate-100">{member.display_name}</strong><span className="rounded-full border border-white/10 px-2 py-1 text-xs uppercase text-slate-400">{member.role}</span></div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div><b className="block text-xl tabular-nums text-slate-100">{member.active_clients}</b><span className="text-xs text-slate-500">files</span></div><div><b className="block text-xl tabular-nums text-slate-100">{member.open_tasks}</b><span className="text-xs text-slate-500">tasks</span></div><div><b className={`block text-xl tabular-nums ${member.overdue_tasks?"text-red-300":"text-slate-100"}`}>{member.overdue_tasks}</b><span className="text-xs text-slate-500">overdue</span></div></div>
            <div className="mt-3 space-y-1.5 text-sm text-slate-400">{member.sites.slice(0,3).map((site)=><div key={`${site.site_code}-${site.shift_code}`} className="flex justify-between gap-3"><span className="truncate">{site.site_name} · {site.shift_name}</span><b className="tabular-nums text-slate-200">{site.total}</b></div>)}</div>
          </Link>)}
        </div>
      </div>

      <div className="ops-glass-card">
        <h2 className="text-xl font-semibold text-slate-100">Operational Health</h2>
        <p className="mt-1 text-sm text-slate-500">Assigned, no overdue work and no current blocking document.</p>
        <div className="mt-6 flex items-end gap-2"><strong className="text-5xl font-semibold tabular-nums text-slate-100">{data.efficiency==null?"N/A":`${data.efficiency}%`}</strong></div>
        {data.efficiency!=null&&<div className="mt-5 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-emerald-400/80" style={{width:`${Math.max(0,Math.min(100,data.efficiency))}%`}}/></div>}
        <dl className="mt-6 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Active Files</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{data.team.active_clients}</dd></div><div><dt className="text-slate-500">Unassigned</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{data.team.unassigned_clients}</dd></div>{data.system&&<><div><dt className="text-slate-500">Queue</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{data.system.queue.queued}</dd></div><div><dt className="text-slate-500">Providers</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{configuredProviders}/{totalProviders}</dd></div></>}</dl>
      </div>
    </section>
  </div>;
}
