import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { catalog, catalogVersion, options } from "@/lib/catalog";
import { systemHealth } from "@/lib/operational-dashboard";
import { providerStates } from "@/lib/providers/config";

export default async function SettingsRoute(){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  if(session.staff.role==="staff")return <p className="ops-error">403 — Management access required.</p>;
  const health=await systemHealth(session);
  const integrations=providerStates() as Record<string,string>;
  return <div className="ops-page space-y-4">
    <header className="ops-hero"><div><p className="ops-kicker">CAREER GATE · SYSTEM SETTINGS</p><h1>Settings</h1><p>Job catalog, integrations, providers and operational configuration.</p></div></header>
    <section className="ops-glass-card"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold text-slate-100">Job Catalog</h2><code className="text-xs text-slate-500">{catalogVersion}</code></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="State" value={catalog.state}/><Metric label="Schema" value={`v${catalog.schema_version}`}/><Metric label="Facilities" value={catalog.facilities.length}/><Metric label="Selectable Shifts" value={options.length}/></div></section>
    <section className="ops-glass-card"><h2 className="text-xl font-semibold text-slate-100">Integrations & Providers</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(integrations).map(([key,value])=><div key={key} className="rounded-xl border border-white/[.06] bg-white/[.02] p-4"><p className="text-xs uppercase tracking-wide text-slate-500">{key.replace(/_/g," ")}</p><p className={`mt-2 text-sm font-semibold ${value==="CONFIGURED"?"text-emerald-300":"text-slate-400"}`}>{value}</p></div>)}</div></section>
    {health&&<section id="system-health" className="ops-glass-card scroll-mt-24" aria-labelledby="system-health-title">
      <h2 id="system-health-title" className="text-xl font-semibold text-slate-100">Operational System Health</h2>
      <p className="mt-2 text-sm text-slate-400">{health.status} · Database {health.db_ms} ms. Recorded job and delivery states; provider configuration is shown above.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Queued jobs" value={health.queue.queued}/><Metric label="Running jobs" value={health.queue.running}/>
        <Metric label="Retrying jobs" value={health.queue.retrying}/><Metric label="Dead jobs" value={health.queue.dead}/>
        <Metric label="Jobs not configured" value={health.queue.not_configured}/><Metric label="Delivery failures · 24h" value={health.failed_notifications_24h}/>
        <Metric label="Oldest queued job · seconds" value={health.queue.oldest_queued_seconds??"None"}/><Metric label="Open audit alerts" value={health.open_audit_alerts}/>
      </div>
    </section>}
    <section className="ops-glass-card"><h2 className="text-xl font-semibold text-slate-100">Operational Configuration</h2><div className="mt-4 flex flex-wrap gap-3"><Link href="/staff/settings/availability" className="ops-primary-button">Availability & Scheduling</Link><Link href="/staff/staff?tab=team" className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/[.04]">Staff Center</Link></div></section>
  </div>;
}
function Metric({label,value}:{label:string;value:string|number}){return <div className="staff-kpi rounded-2xl p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-slate-100">{value}</p></div>}
