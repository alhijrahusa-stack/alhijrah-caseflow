import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { catalog, catalogVersion, options } from "@/lib/catalog";
import { providerStates } from "@/lib/providers/config";

export default async function SettingsRoute(){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  if(session.staff.role==="staff")return <p className="ops-error">403 — Management access required.</p>;
  const integrations=providerStates() as Record<string,string>;
  return <div className="ops-page space-y-4">
    <header className="ops-hero"><div><p className="ops-kicker">CAREER GATE · SYSTEM SETTINGS</p><h1>Settings</h1><p>Job catalog, integrations, providers and operational configuration.</p></div></header>
    <section className="ops-glass-card"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold text-slate-100">Job Catalog</h2><code className="text-xs text-slate-500">{catalogVersion}</code></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="State" value={catalog.state}/><Metric label="Schema" value={`v${catalog.schema_version}`}/><Metric label="Facilities" value={catalog.facilities.length}/><Metric label="Selectable Shifts" value={options.length}/></div></section>
    <section className="ops-glass-card"><h2 className="text-xl font-semibold text-slate-100">Integrations & Providers</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(integrations).map(([key,value])=><div key={key} className="rounded-xl border border-white/[.06] bg-white/[.02] p-4"><p className="text-xs uppercase tracking-wide text-slate-500">{key.replace(/_/g," ")}</p><p className={`mt-2 text-sm font-semibold ${value==="CONFIGURED"?"text-emerald-300":"text-slate-400"}`}>{value}</p></div>)}</div></section>
    <section className="ops-glass-card"><h2 className="text-xl font-semibold text-slate-100">Operational Configuration</h2><div className="mt-4 flex flex-wrap gap-3"><Link href="/staff/settings/availability" className="ops-primary-button">Availability & Scheduling</Link><Link href="/staff/staff?tab=team" className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/[.04]">Staff Center</Link></div></section>
  </div>;
}
function Metric({label,value}:{label:string;value:string|number}){return <div className="staff-kpi rounded-2xl p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-slate-100">{value}</p></div>}
