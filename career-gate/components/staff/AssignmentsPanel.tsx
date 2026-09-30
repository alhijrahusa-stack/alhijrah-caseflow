"use client";
import Link from "next/link";
import { useMemo,useState } from "react";
import { useRouter } from "next/navigation";
import type { AssignmentClient } from "@/lib/operational-assignments";
import { ReassignControl } from "@/components/staff/ReassignControl";

type StaffRow={id:string;display_name:string;active:boolean;staff_code:string|null;role:string};

type Props={staff:StaffRow[];clients:AssignmentClient[];roundRobinEnabled:boolean;isAdmin:boolean;scope?:string};

async function post(body:Record<string,unknown>){const r=await fetch("/api/staff/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const j=await r.json().catch(()=>null);if(!r.ok||!j?.ok)throw new Error(j?.error?.message??`Request failed (${r.status})`);return j;}

export function AssignmentsPanel({staff,clients,roundRobinEnabled,isAdmin,scope}:Props){
  const router=useRouter();
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [target,setTarget]=useState("");
  const [query,setQuery]=useState("");
  const [roundRobin,setRoundRobin]=useState(roundRobinEnabled);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const visible=useMemo(()=>{const q=query.trim().toLowerCase();return clients.filter((c)=>(scope!=="unassigned"||!c.assigned_staff)&&(!q||[c.full_name,c.ref,c.phone,c.assigned_name??""].some((v)=>v.toLowerCase().includes(q))));},[clients,query,scope]);
  async function assign(){if(!selected.size)return;setBusy(true);setError(null);try{await post({operation:"bulk_assign",client_ids:[...selected],staff_id:target||null});setSelected(new Set());router.refresh();}catch(e){setError(e instanceof Error?e.message:"Unable to assign");}finally{setBusy(false);}}
  async function toggle(next:boolean){setBusy(true);setError(null);try{await post({operation:"set_round_robin",enabled:next});setRoundRobin(next);router.refresh();}catch(e){setError(e instanceof Error?e.message:"Unable to update");}finally{setBusy(false);}}
  return <div className="space-y-4">
    {error&&<div className="ops-error">{error}</div>}
    <section className="ops-glass-card">
      <div className="ops-toolbar"><input className="ops-input ops-search-input" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search client or file"/><select className="ops-select" value={target} onChange={(e)=>setTarget(e.target.value)}><option value="">Unassigned</option>{staff.filter((s)=>s.active).map((s)=><option key={s.id} value={s.id}>{s.staff_code??"—"} · {s.display_name}</option>)}</select><button className="ops-primary-button" type="button" disabled={busy||selected.size===0} onClick={()=>void assign()}>Assign {selected.size?`(${selected.size})`:"selected"}</button>{isAdmin&&<label className="ml-auto flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={roundRobin} onChange={(e)=>void toggle(e.target.checked)} disabled={busy}/>Round-Robin</label>}</div>
      <div className="ops-distribution-table-wrap"><table className="ops-table"><thead><tr><th></th><th>Client</th><th>File</th><th>Site / Shift</th><th>Owner</th><th>Open Tasks</th><th></th></tr></thead><tbody>{visible.map((c)=><tr key={c.id}><td><input type="checkbox" checked={selected.has(c.id)} onChange={(e)=>{const n=new Set(selected);if(e.target.checked)n.add(c.id);else n.delete(c.id);setSelected(n);}}/></td><td><strong>{c.full_name}</strong><span>{c.phone}</span></td><td><code>{c.ref}</code></td><td><strong>{c.site_name??c.site_code??"—"}</strong><span>{c.shift_name??c.shift_code??"—"}</span></td><td><strong>{c.assigned_name??"Unassigned"}</strong></td><td>{c.open_tasks.length}</td><td className="whitespace-nowrap"><ReassignControl client={c} staff={staff}/><Link className="ml-3" href={`/staff/client/${c.id}`}>Open</Link></td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
