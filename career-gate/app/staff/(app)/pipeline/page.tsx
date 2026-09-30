import Link from "next/link";
import { redirect } from "next/navigation";
import { PipelineBoard } from "@/components/staff/PipelineBoard";
import { getStaffSession } from "@/lib/auth";
import { activePipelineData } from "@/lib/operational-pipeline";

export const dynamic = "force-dynamic";

export default async function PipelinePage(){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  const data=await activePipelineData(session);
  return <div className="space-y-4">
    {data.exceptions.length>0&&<section className="ops-glass-card border border-amber-400/20">
      <div className="flex items-center justify-between gap-3"><div><p className="ops-kicker text-amber-300">PIPELINE EXCEPTIONS</p><h2 className="text-xl font-semibold text-slate-100">Terminal stage · active lifecycle</h2><p className="mt-1 text-sm text-slate-500">These files remain visible until their lifecycle is explicitly resolved.</p></div><strong className="text-2xl tabular-nums text-amber-300">{data.exceptions.length}</strong></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{data.exceptions.map((client)=><Link key={client.id} href={`/staff/client/${client.id}`} className="rounded-xl border border-white/10 bg-white/[.02] p-3 hover:border-amber-300/30"><strong className="block text-slate-100">{client.full_name}</strong><code className="text-xs text-slate-500">{client.ref}</code><span className="mt-2 block text-sm text-amber-300">{client.pipeline_stage.replace(/_/g," ")}</span></Link>)}</div>
    </section>}
    <PipelineBoard stages={data.stages} clients={data.clients}/>
  </div>;
}
