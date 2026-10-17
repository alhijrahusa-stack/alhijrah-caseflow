"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type CommandClient={
 id:string;ref:string;full_name:string;phone:string;email:string|null;city:string|null;
 current_status:string;next_step:string;assigned_staff:string|null;assigned_name:string|null;
 updated_at:string;site_name:string|null;shift_name:string|null;
};
type Staff={id:string;display_name:string};
export function ClientCommandTable({clients,staff,management}:{clients:CommandClient[];staff:Staff[];management:boolean}){
 const router=useRouter();
 const [query,setQuery]=useState("");
 const [filter,setFilter]=useState("all");
 const [selected,setSelected]=useState<string[]>([]);
 const [drawer,setDrawer]=useState<CommandClient|null>(null);
 const [owner,setOwner]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [view,setView]=useState<"table"|"grid">("table");
 const matching=useMemo(()=>clients.filter(c=>{
  const term=query.toLowerCase().trim();
  if(term && ![c.ref,c.full_name,c.phone,c.email??"",c.assigned_name??""].some(x=>x.toLowerCase().includes(term)))return false;
  return filter==="all" || (filter==="unassigned" && !c.assigned_staff) ||
   (filter==="mine" && c.assigned_staff===owner) || (filter==="review"&&["needs_review","new_intake"].includes(c.current_status));
 }),[clients,query,filter,owner]);
 async function bulkAssign(){
  if(!management || !selected.length)return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/staff/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation:"bulk_assign",client_ids:selected,staff_id:owner||null})});
   const result=await response.json().catch(()=>null);
   if(!response.ok||!result?.ok)throw Error(result?.error?.message??"Assignment failed");
   setSelected([]);router.refresh();
  }catch(e){setError(e instanceof Error?e.message:"Assignment failed")}finally{setBusy(false)}
 }
 const toggle=(id:string)=>setSelected(cur=>cur.includes(id)?cur.filter(x=>x!==id):[...cur,id]);
 const badge=(s:string)=>{const fresh=s==="new_intake",progress=s==="application_in_progress";return <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold capitalize shadow-[inset_0_1px_rgba(255,255,255,.08)] ${fresh?"border-cyan-300/35 bg-cyan-400/10 text-cyan-200":progress?"border-amber-300/35 bg-gradient-to-r from-orange-400/15 to-amber-300/10 text-amber-200":"border-amber-300/20 bg-amber-200/10 text-amber-100"}`}>{fresh&&<span className="cg-status-dot"/>}{s.replaceAll("_"," ")}{progress&&<span className="ml-1 h-0.5 w-6 rounded-full bg-gradient-to-r from-orange-300 to-amber-100/30"/>}</span>};
 return <section className="ops-glass-card space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="ops-kicker">EXECUTIVE OPERATIONS · COMMAND BAR</p><h2 className="text-xl font-bold text-white">Candidate Registry</h2></div><div className="flex gap-2"><button type="button" aria-pressed={view==="table"} onClick={()=>setView("table")} className="rounded-lg border border-white/20 px-3 py-2 text-sm">Table</button><button type="button" aria-pressed={view==="grid"} onClick={()=>setView("grid")} className="rounded-lg border border-white/20 px-3 py-2 text-sm">Grid</button></div></div>
  <div className="flex flex-wrap gap-2"><input aria-label="Instant search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search case ID, name, phone, owner…" className="input min-w-56 flex-1"/>{[["all","All"],["review","Needs review"],["unassigned","Unassigned"],["mine","Selected owner"]].map(([value,label])=><button type="button" key={value} onClick={()=>setFilter(value)} aria-pressed={filter===value} className={`rounded-full border px-3 py-2 text-sm ${filter===value?"border-amber-300 bg-amber-300/15 text-amber-100":"border-white/15 text-slate-300"}`}>{label}</button>)}</div>
  {management&&<div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3"><span className="text-sm text-slate-300">{selected.length} selected</span><select className="input min-w-44" aria-label="Assign selected cases to" value={owner} onChange={e=>setOwner(e.target.value)}><option value="">Unassigned</option>{staff.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select><button className="ops-primary-button" disabled={busy||!selected.length} onClick={bulkAssign}>Assign selected</button></div>}
  {error&&<p role="alert" className="text-red-300">{error}</p>}
  {view==="table"?<div className="overflow-x-auto"><table className="table min-w-[1000px]"><thead><tr>{management&&<th><input type="checkbox" aria-label="Select visible" checked={!!matching.length&&matching.every(x=>selected.includes(x.id))} onChange={e=>setSelected(cur=>e.target.checked?[...new Set([...cur,...matching.map(x=>x.id)])]:cur.filter(x=>!matching.some(y=>y.id===x)))} /></th>}<th>Case ID</th><th>Candidate</th><th>Pipeline Stage</th><th>Assigned To</th><th>Last Activity</th><th>Next Milestone</th><th>Quick View</th></tr></thead><tbody>{matching.map(c=><tr key={c.id} className="cg-registry-row border-b border-white/[.07]">{management&&<td><input type="checkbox" aria-label={`Select ${c.full_name}`} checked={selected.includes(c.id)} onChange={()=>toggle(c.id)}/></td>}<td className="font-mono font-extrabold tracking-wide text-lime-300 drop-shadow-[0_0_8px_rgba(163,230,53,.2)]"><Link href={`/staff/client/${c.id}`} className="hover:underline">{c.ref}</Link></td><td><Link href={`/staff/client/${c.id}`} className="font-semibold text-white hover:text-cyan-200">{c.full_name}</Link><p className="text-xs text-slate-400">{c.phone} · {c.city??"—"}</p></td><td>{badge(c.current_status)}</td><td>{c.assigned_name??"Unassigned"}</td><td className="whitespace-nowrap text-amber-200">{new Date(c.updated_at).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"})}</td><td>{c.next_step}</td><td><button type="button" className="rounded-lg border border-amber-300/30 px-3 py-2 text-sm text-amber-200" onClick={()=>setDrawer(c)}>View</button></td></tr>)}</tbody></table></div>:<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{matching.map(c=><article key={c.id} className="rounded-2xl border border-white/15 bg-gradient-to-br from-white/[.07] to-white/[.025] p-5 shadow-[0_12px_30px_rgba(0,0,0,.16)] transition-all duration-200 hover:-translate-y-1 hover:border-amber-300/35 hover:shadow-[0_18px_38px_rgba(245,158,11,.1)]"><Link href={`/staff/client/${c.id}`} className="font-bold text-white">{c.full_name}</Link><p className="font-mono text-sm font-extrabold text-lime-300">{c.ref}</p><p className="my-3">{badge(c.current_status)}</p><p className="text-sm text-slate-300">{c.site_name??"No location"} · {c.shift_name??"No shift"}</p><button className="mt-3 text-sm text-amber-200" onClick={()=>setDrawer(c)}>Quick View →</button></article>)}</div>}
  {!matching.length&&<p className="p-4 text-center text-slate-400">No matching cases</p>}
  {drawer&&<div className="fixed inset-0 z-[100] flex justify-end bg-black/65" onClick={()=>setDrawer(null)}><aside role="dialog" aria-modal="true" aria-label="Client quick view" onClick={e=>e.stopPropagation()} className="h-full w-full max-w-xl overflow-y-auto border-l border-amber-300/25 bg-[#101827]/95 p-7 shadow-2xl backdrop-blur-2xl"><div className="flex justify-between"><p className="ops-kicker">QUICK VIEW · CASE FILE</p><button onClick={()=>setDrawer(null)} aria-label="Close">✕</button></div><h2 className="mt-4 text-2xl font-bold text-white">{drawer.full_name}</h2><p className="font-mono text-cyan-300">{drawer.ref}</p><div className="mt-6 space-y-3 text-sm"><p>Status: {badge(drawer.current_status)}</p><p>Owner: {drawer.assigned_name??"Unassigned"}</p><p>Phone: {drawer.phone}</p><p>Email: {drawer.email??"—"}</p><p>Location: {drawer.site_name??"Not selected"}</p><p>Shift: {drawer.shift_name??"Not selected"}</p><p>Next Action: {drawer.next_step}</p><p>Last Updated: {new Date(drawer.updated_at).toLocaleString()}</p></div><Link href={`/staff/client/${drawer.id}`} className="ops-primary-button mt-8 inline-block">Open full record, documents & audit trail</Link></aside></div>}
 </section>;
}
