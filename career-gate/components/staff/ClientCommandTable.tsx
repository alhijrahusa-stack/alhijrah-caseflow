"use client";
import Link from "next/link";
import { Client360Drawer } from "@/components/staff/Client360Drawer";
import { CLIENT_STAGES, type ClientStageFilter } from "@/lib/client-lifecycle-filters";
import { useCallback, useMemo, useState } from "react";
import { useTargetedMutationBatch } from "@/components/staff/realtime/useTargetedMutation";

export type CommandClient={
 id:string;ref:string;full_name:string;phone:string;email:string|null;city:string|null;
 current_status:string;next_step:string;amazon_account_ready:boolean;payment_status:string|null;assigned_staff:string|null;assigned_name:string|null;
 created_at:string;updated_at:string;site_name:string|null;shift_name:string|null;
};
type Staff={id:string;display_name:string};
export function ClientCommandTable({clients,staff,management}:{clients:CommandClient[];staff:Staff[];management:boolean}){
 const onMutated=useTargetedMutationBatch();
 const [assigned,setAssigned]=useState<Record<string,{assigned_staff:string|null;assigned_name:string|null}>>({});
 const [seen,setSeen]=useState(clients);
 if(seen!==clients){setSeen(clients);setAssigned({});}
 const rows=useMemo(()=>clients.map(c=>assigned[c.id]?{...c,...assigned[c.id]}:c),[clients,assigned]);
 const [query,setQuery]=useState("");
 const [filter,setFilter]=useState("all");
 const [selected,setSelected]=useState<string[]>([]);
 const [drawer,setDrawer]=useState<CommandClient|null>(null);
 const [owner,setOwner]=useState("__keep__");
 const [targetStage,setTargetStage]=useState<ClientStageFilter | "">("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [view,setView]=useState<"table"|"grid">("grid");
 const closeDrawer=useCallback(()=>setDrawer(null),[]);
 const matching=useMemo(()=>rows.filter(c=>{
  const term=query.toLowerCase().trim();
  if(term && ![c.ref,c.full_name,c.phone,c.email??"",c.assigned_name??""].some(x=>x.toLowerCase().includes(term)))return false;
  return filter==="all" || (filter==="unassigned" && !c.assigned_staff) ||
   (filter==="mine" && c.assigned_staff===owner) || (filter==="review"&&["needs_review","new_intake"].includes(c.current_status));
 }),[rows,query,filter,owner]);
 async function bulkAssign(){
  if(!management || !selected.length)return;
  setBusy(true);setError("");
  const ids=[...selected];
  const previous=assigned;
  if (owner!=="__keep__") {
    const next={assigned_staff:owner||null,assigned_name:staff.find(s=>s.id===owner)?.display_name??null};
    setAssigned(cur=>({...cur,...Object.fromEntries(ids.map(id=>[id,next]))}));
  }
  try{
   const response=await fetch("/api/staff/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation:"bulk_assign",client_ids:ids,...(owner==="__keep__"?{}:{staff_id:owner||null}),...(targetStage?{target_stage:targetStage}:{})})});
   const result=await response.json().catch(()=>null);
   if(!response.ok||!result?.ok)throw Error(result?.error?.message??"Assignment failed");
   setSelected([]);onMutated("bulk_assign",ids);
  }catch(e){setAssigned(previous);setError(e instanceof Error?e.message:"Assignment failed")}finally{setBusy(false)}
 }
 const eligible=matching.filter(c=>!["completed","cancelled"].includes(c.current_status));
 const toggle=(id:string)=>setSelected(cur=>cur.includes(id)?cur.filter(x=>x!==id):[...cur,id]);
 const badge=(s:string)=>{const fresh=s==="new_intake",progress=s==="application_in_progress";return <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold capitalize shadow-[inset_0_1px_rgba(255,255,255,.08)] ${fresh?"border-cyan-300/35 bg-cyan-400/10 text-cyan-200":progress?"border-amber-300/35 bg-gradient-to-r from-orange-400/15 to-amber-300/10 text-amber-200":"border-amber-300/20 bg-amber-200/10 text-amber-100"}`}>{fresh&&<span className="cg-status-dot"/>}{s.replaceAll("_"," ")}{progress&&<span className="ml-1 h-0.5 w-6 rounded-full bg-gradient-to-r from-orange-300 to-amber-100/30"/>}</span>};
 const cards=<div className="grid min-w-0 gap-2.5 md:grid-cols-2 2xl:grid-cols-3" data-testid="client-registry-responsive-cards">
   {matching.map(c=><article key={c.id} className="cg-registry-card">
     <div className="flex items-start justify-between gap-2">
       <div className="flex min-w-0 items-start gap-3">
         <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-amber-200/30 bg-amber-200/10 text-sm font-bold text-amber-100">{c.full_name.trim().split(/\s+/).slice(0,2).map(x=>x.charAt(0)).join("").toUpperCase()}</span>
         <div className="min-w-0">
           <button type="button" onClick={()=>setDrawer(c)} className="block max-w-full break-words text-left text-base font-semibold leading-6 text-white hover:text-amber-200">{c.full_name}</button>
           <Link href={`/staff/client/${c.id}`} className="mt-0.5 block font-mono text-xs text-cyan-200 hover:underline">{c.ref}</Link>
           <p className="mt-1 truncate text-xs text-slate-400">{c.phone}{c.city?` · ${c.city}`:""}</p>
         </div>
       </div>
       {management&&<input type="checkbox" aria-label={`Select ${c.full_name}`} checked={selected.includes(c.id)} onChange={()=>toggle(c.id)} disabled={["completed","cancelled"].includes(c.current_status)} className="mt-1 h-4 w-4 shrink-0"/>}
     </div>
     <div className="mt-2.5 flex flex-wrap items-center gap-2">{badge(c.current_status)}{c.amazon_account_ready&&<span className="text-xs text-emerald-300">Amazon READY</span>}{c.payment_status==="paid"&&<span className="text-xs text-emerald-300">Paid</span>}<span className="text-xs text-slate-400">{c.assigned_name??"Unassigned"}</span></div>
     <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-white/10 pt-2.5 text-xs">
       <div className="min-w-0"><span className="text-slate-400">Received / الاستلام</span><time dateTime={c.created_at} className="mt-1 block font-medium text-slate-200">{new Date(c.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</time></div>
       <div className="min-w-0"><span className="text-slate-400">Location · Shift</span><p className="mt-1 truncate text-slate-200">{c.site_name??"—"} · {c.shift_name??"—"}</p></div>
     </div>
     <p className="mt-2.5 line-clamp-1 text-xs text-slate-300">{c.next_step}</p>
     <button type="button" className="cg-command-button mt-2.5 w-full" onClick={()=>setDrawer(c)}>Open Client 360 ↗</button>
   </article>)}
 </div>;
 return <section className="ops-glass-card space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="ops-kicker">EXECUTIVE OPERATIONS · COMMAND BAR</p><h2 className="text-lg font-bold text-white">Candidate Registry</h2></div><div className="flex gap-2"><button type="button" aria-pressed={view==="table"} onClick={()=>setView("table")} className="cg-command-button">Table</button><button type="button" aria-pressed={view==="grid"} onClick={()=>setView("grid")} className="cg-command-button">Grid</button></div></div>
  <div className="flex flex-wrap gap-2"><input aria-label="Instant search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search case ID, name, phone, owner…" className="input min-w-0 basis-56 flex-1"/>{[["all","All"],["review","Needs review"],["unassigned","Unassigned"],["mine","Selected owner"]].map(([value,label])=><button type="button" key={value} onClick={()=>setFilter(value)} aria-pressed={filter===value} className={`rounded-full border px-3 py-2 text-sm ${filter===value?"border-amber-300 bg-amber-300/15 text-amber-100":"border-white/15 text-slate-300"}`}>{label}</button>)}</div>
  {management&&<div className="flex flex-wrap items-end gap-2 border-t border-amber-200/15 pt-3">
    <span className="self-center text-sm font-medium text-amber-100">{selected.length} selected</span>
    <label className="min-w-0 flex-1 text-xs text-slate-300 sm:min-w-44">Assigned Specialist
      <select className="input mt-1 w-full" aria-label="Assign selected cases to" value={owner} onChange={e=>setOwner(e.target.value)}>
        <option value="__keep__">Keep current owner</option><option value="">Unassigned</option>{staff.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}
      </select>
    </label>
    <label className="min-w-0 flex-1 text-xs text-slate-300 sm:min-w-44">Lifecycle Station
      <select className="input mt-1 w-full" aria-label="Move selected clients to lifecycle stage" value={targetStage} onChange={e=>setTargetStage(e.target.value as ClientStageFilter|"")}>
        <option value="">Keep current stage</option>{CLIENT_STAGES.map(stage=><option key={stage.id} value={stage.id}>{stage.label}</option>)}
      </select>
    </label>
    <button type="button" className="cg-command-button min-h-11 border-amber-200/45" disabled={busy||!selected.length||(owner==="__keep__"&&!targetStage)} onClick={bulkAssign}>{busy?"Applying…":"Assign selected"}</button>
    {targetStage&&<p className="w-full text-xs text-amber-200/90" role="status">Moves require verified prerequisites. Invalid moves are rejected atomically; Pass and payment are never inferred.</p>}
   </div>}
  {error&&<p role="alert" className="text-red-300">{error}</p>}
  {view==="table"?<><div className="hidden min-w-0 overflow-x-auto xl:block"><table className="table min-w-[980px]"><thead><tr>{management&&<th><input type="checkbox" aria-label="Select visible" checked={!!eligible.length&&eligible.every(x=>selected.includes(x.id))} onChange={e=>setSelected(cur=>e.target.checked?[...new Set([...cur,...eligible.map(x=>x.id)])]:cur.filter(x=>!eligible.some(y=>y.id===x)))} /></th>}<th>Case ID</th><th>Candidate</th><th>Pipeline Stage</th><th>Assigned To</th><th>Received</th><th>Last Activity</th><th>Next Milestone</th><th>Quick View</th></tr></thead><tbody>{matching.map(c=><tr key={c.id} className="cg-registry-row border-b border-white/[.07]">{management&&<td><input type="checkbox" aria-label={`Select ${c.full_name}`} checked={selected.includes(c.id)} onChange={()=>toggle(c.id)} disabled={["completed","cancelled"].includes(c.current_status)}/></td>}<td className="font-mono font-extrabold tracking-wide text-lime-300 drop-shadow-[0_0_8px_rgba(163,230,53,.2)]"><Link href={`/staff/client/${c.id}`} className="hover:underline">{c.ref}</Link></td><td><button type="button" onClick={() => setDrawer(c)} className="group flex min-w-0 items-center gap-3 text-left" aria-label={`Open ${c.full_name} in Client 360`}><span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-amber-200/25 bg-gradient-to-br from-amber-200/20 to-sky-300/10 text-sm font-bold text-amber-100 shadow-[inset_0_1px_rgba(255,255,255,.18)]">{c.full_name.trim().split(/\s+/).slice(0,2).map(x=>x.charAt(0)).join("").toUpperCase()}</span><span className="min-w-0"><strong className="block truncate text-[15px] font-semibold tracking-tight text-slate-100 transition group-hover:text-amber-200">{c.full_name}</strong><small className="block truncate text-xs font-normal text-slate-400">{c.phone} · {c.city??"—"}</small></span></button></td><td>{badge(c.current_status)}</td><td>{c.assigned_name??"Unassigned"}</td><td className="whitespace-nowrap text-sm text-slate-300">{new Date(c.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</td><td className="whitespace-nowrap text-amber-200">{new Date(c.updated_at).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"})}</td><td>{c.next_step}</td><td><button type="button" className="rounded-2xl border border-amber-300/30 bg-amber-200/[.06] px-4 py-2 text-sm text-amber-100 shadow-[inset_0_1px_rgba(255,255,255,.14)] transition hover:-translate-y-px hover:border-amber-300/60 hover:bg-amber-200/15" onClick={()=>setDrawer(c)}>View</button></td></tr>)}</tbody></table></div><div className="xl:hidden">{cards}</div></>:cards}
  {!matching.length&&<p className="p-4 text-center text-slate-400">No matching cases</p>}
  {drawer && <Client360Drawer client={drawer} onClose={closeDrawer} />}

 </section>;
}
