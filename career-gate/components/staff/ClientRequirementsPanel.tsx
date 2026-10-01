import Link from "next/link";
import type { ClientReadiness, ClientRequirement } from "@/lib/requirements";

function statusClass(status:ClientRequirement["status"]){
  if(status==="complete")return "border-emerald-400/25 bg-emerald-400/[.08] text-emerald-300";
  if(status==="pending_review")return "border-amber-400/25 bg-amber-400/[.08] text-amber-300";
  if(status==="not_applicable")return "border-white/10 bg-white/[.03] text-slate-500";
  return "border-red-400/25 bg-red-400/[.08] text-red-300";
}

export function ClientRequirementsPanel({clientId,requirements,readiness}:{clientId:string;requirements:ClientRequirement[];readiness:ClientReadiness}){
  const pct=readiness.readiness_percent;
  return <section className="mx-auto mb-4 max-w-[1600px] staff-glass-strong rounded-2xl p-4" aria-label="Client readiness and requirements">
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-[180px]"><p className="text-[10px] uppercase tracking-[.14em] text-slate-500">Rule-Based Readiness</p><div className="mt-2 flex items-baseline gap-2"><strong className="text-3xl text-slate-100">{pct==null?"—":`${pct}%`}</strong><span className="text-xs text-slate-500">{readiness.complete_count}/{readiness.required_count} complete</span></div>{pct==null&&<p className="mt-2 text-xs text-slate-500">No active requirements are currently defined for this client.</p>}</div>
      <div className="grid min-w-[260px] flex-1 grid-cols-3 gap-2"><Metric label="Missing / Rejected" value={readiness.missing_count}/><Metric label="Pending Review" value={readiness.pending_review_count}/><Metric label="Complete" value={readiness.complete_count}/></div>
    </div>
    {requirements.length>0&&<div className="mt-4 grid gap-2 lg:grid-cols-2">{requirements.map(r=><article key={r.id} className="rounded-xl border border-white/[.06] bg-white/[.02] p-3"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-200">{r.title}</h3><p className="mt-1 text-[11px] text-slate-500">{r.source.replace(/_/g," ")}{r.stage?` · ${r.stage.replace(/_/g," ")}`:""}{r.due_at?` · due ${new Date(r.due_at).toLocaleString()}`:""}</p></div><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold capitalize ${statusClass(r.status)}`}>{r.status.replace(/_/g," ")}</span></div>{r.reason&&<p className="mt-2 text-xs text-slate-400">{r.reason}</p>}<div className="mt-2 flex gap-3 text-xs">{r.related_document_id&&<Link className="text-cyan-300" href={`/staff/client/${clientId}?tab=documents`}>Open document</Link>}{r.related_task_id&&<Link className="text-cyan-300" href={`/staff/client/${clientId}?tab=work`}>Open task</Link>}</div></article>)}</div>}
  </section>;
}
function Metric({label,value}:{label:string;value:number}){return <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3"><span className="text-[10px] uppercase tracking-[.1em] text-slate-600">{label}</span><strong className="mt-1 block text-xl text-slate-200">{value}</strong></div>}
