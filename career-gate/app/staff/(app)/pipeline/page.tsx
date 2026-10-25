import Link from "next/link";
import { redirect } from "next/navigation";
import { PipelineBoard } from "@/components/staff/PipelineBoard";
import { getStaffSession, withStaff } from "@/lib/auth";
import { STATUS_LABELS, type Status } from "@/lib/domain";
import { activePipelineData } from "@/lib/operational-pipeline";

export const dynamic = "force-dynamic";

export default async function PipelinePage(){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  const [data,staff]=await Promise.all([
    activePipelineData(session),
    withStaff(session,tx=>tx`select id,display_name from staff where active order by display_name`),
  ]);
  const canAssign=session.staff.role!=="staff";
  const exceptions=data.exceptions;
  return <div className="space-y-4">
    {exceptions.total>0&&<section className="ops-glass-card border border-amber-400/20" data-testid="pipeline-exceptions">
      <div className="flex items-center justify-between gap-3"><div><p className="ops-kicker text-amber-300">PIPELINE ATTENTION</p><h2 className="pipeline-exception-title">Files requiring review</h2><p className="pipeline-exception-copy mt-1 text-sm">These active files remain visible here until their current stage is resolved.</p></div><strong className="text-2xl tabular-nums text-amber-300">{exceptions.total}</strong></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{exceptions.cards.map((client)=><Link key={client.id} href={`/staff/client/${client.id}`} className="rounded-xl border border-white/10 bg-white/[.02] p-3 hover:border-amber-300/30"><strong className="block text-slate-100">{client.full_name}</strong><span className="text-xs text-slate-500">{client.ref}</span><span className="pipeline-stage-label mt-2 block text-sm text-amber-300">{STATUS_LABELS[client.current_status as Status] ?? "Review required"}</span></Link>)}</div>
      {exceptions.total>exceptions.cards.length&&<p className="mt-3 text-sm text-slate-400">Showing {exceptions.cards.length} of {exceptions.total}. <Link href="/staff/clients" className="text-amber-300 hover:underline">Open the client registry</Link> to work the rest.</p>}
    </section>}
    <PipelineBoard data={data} staff={staff as unknown as {id:string;display_name:string}[]} canAssign={canAssign}/>
  </div>;
}
