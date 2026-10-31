import { StaffLabel } from "@/components/staff/StaffLabel";
import { StaffText } from "@/components/staff/StaffLanguage";
import Link from "next/link";
import { GeminiLiveCheck } from "@/components/staff/GeminiLiveCheck";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { catalog, catalogVersion, options } from "@/lib/catalog";
import { providerStates } from "@/lib/providers/config";

export default async function SettingsRoute(){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  if(session.staff.role==="staff")return <p className="ops-error"><StaffText en="403 — Management access required." ar="403 — يلزم تصريح إداري."/></p>;
  const integrations=providerStates() as Record<string,string>;
  return <div className="ops-page space-y-4">
    <header className="ops-hero"><div><p className="ops-kicker"><StaffText en="CAREER GATE · SYSTEM SETTINGS" ar="CAREER GATE · إعدادات النظام"/></p><h1><StaffText en="Settings" ar="الإعدادات"/></h1><p><StaffText en="Job catalog, integrations, providers and operational configuration." ar="دليل الوظائف والتكاملات والمزوّدون وإعدادات التشغيل."/></p></div></header>
    <section className="ops-glass-card"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold text-slate-100"><StaffText en="Job Catalog" ar="دليل الوظائف"/></h2><code className="text-xs text-slate-500">{catalogVersion}</code></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="State" value={catalog.state}/><Metric label="Schema" value={`v${catalog.schema_version}`}/><Metric label="Facilities" value={catalog.facilities.length}/><Metric label="Selectable Shifts" value={options.length}/></div></section>
    <section className="ops-glass-card"><h2 className="text-xl font-semibold text-slate-100"><StaffText en="Integrations & Providers" ar="التكاملات والمزوّدون"/></h2><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(integrations).map(([key,value])=><div key={key} className="rounded-xl border border-white/[.06] bg-white/[.02] p-4"><p className="text-xs uppercase tracking-wide text-slate-500"><StaffLabel en={key.replace(/_/g," ")}/></p><p className={`mt-2 text-sm font-semibold ${value==="CONFIGURED"?"text-emerald-300":"text-slate-400"}`}><StaffLabel en={value}/></p></div>)}</div></section>
    {session.staff.role==="admin"&&<section className="ops-glass-card"><h2 className="text-xl font-semibold text-slate-100"><StaffText en="Gemini Document Vision · Live Verification" ar="Gemini · التحقق الفعلي من قراءة الوثائق"/></h2><p className="mt-2 text-sm text-slate-400"><StaffText en="CONFIGURED only means environment settings exist. LIVE GENERATION VERIFIED requires a successful real Gemini response." ar="تعني CONFIGURED وجود إعدادات البيئة فقط. وتتطلب LIVE GENERATION VERIFIED استجابة ناجحة فعلية من Gemini."/></p><GeminiLiveCheck/></section>}
    <section className="ops-glass-card"><h2 className="text-xl font-semibold text-slate-100"><StaffText en="Operational Configuration" ar="إعدادات التشغيل"/></h2><div className="mt-4 flex flex-wrap gap-3"><Link href="/staff/settings/availability" className="ops-primary-button"><StaffText en="Availability & Scheduling" ar="التوافر والجدولة"/></Link><Link href="/staff/staff?tab=team" className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/[.04]"><StaffText en="Staff Center" ar="مركز الموظفين"/></Link></div></section>
  </div>;
}
function Metric({label,value}:{label:string;value:string|number}){return <div className="staff-kpi rounded-2xl p-4"><p className="text-sm text-slate-500"><StaffLabel en={label} ar={label === "State" ? "الحالة" : undefined}/></p><p className="mt-2 text-2xl font-semibold text-slate-100">{value}</p></div>}
