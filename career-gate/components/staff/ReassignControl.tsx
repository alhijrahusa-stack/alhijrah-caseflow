"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AssignmentClient } from "@/lib/operational-assignments";

type StaffRow={id:string;display_name:string;active:boolean};

export function ReassignControl({client,staff}:{client:AssignmentClient;staff:StaffRow[]}){
  const router=useRouter();
  const [open,setOpen]=useState(false);
  const [target,setTarget]=useState(client.assigned_staff??"");
  const [tasks,setTasks]=useState<Set<string>>(new Set());
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  async function save(){setBusy(true);setError(null);try{const r=await fetch("/api/staff/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation:"reassign_client",client_id:client.id,staff_id:target||null,task_ids:[...tasks],reason:reason||null})});const j=await r.json().catch(()=>null);if(!r.ok||!j?.ok)throw new Error(j?.error?.message??"Unable to reassign");setOpen(false);router.refresh();}catch(e){setError(e instanceof Error?e.message:"Unable to reassign");}finally{setBusy(false);}}
  if(!open)return <button type="button" className="text-cyan-300" onClick={()=>setOpen(true)}>Reassign</button>;
  return <div className="inline-block min-w-[320px] rounded-xl border border-white/10 bg-slate-950 p-3 align-top"><div className="grid gap-2"><select className="input" value={target} onChange={(e)=>setTarget(e.target.value)}><option value="">Unassigned</option>{staff.filter((s)=>s.active).map((s)=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select><input className="input" value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="Reason (optional)" maxLength={500}/><div className="max-h-36 overflow-auto">{client.open_tasks.map((task)=><label key={task.id} className="flex gap-2 py-1 text-xs text-slate-300"><input type="checkbox" checked={tasks.has(task.id)} onChange={(e)=>{const n=new Set(tasks);if(e.target.checked)n.add(task.id);else n.delete(task.id);setTasks(n);}}/><span>{task.title}</span></label>)}</div>{error&&<span className="text-xs text-red-400">{error}</span>}<div className="flex gap-2"><button type="button" className="ops-primary-button" disabled={busy} onClick={()=>void save()}>{busy?"Saving…":"Confirm"}</button><button type="button" className="px-3 text-xs text-slate-400" onClick={()=>setOpen(false)}>Cancel</button></div></div></div>;
}
