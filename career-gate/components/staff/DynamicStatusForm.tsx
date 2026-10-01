"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStaff } from "@/components/staff/StaffContext";
import type { Status } from "@/lib/domain";

type Rule={status:Status;label:string;default_next_action:string;sequence:number;terminal:boolean};

export function DynamicStatusForm({clientId,current,nextStep,onDone}:{clientId:string;current:Status;nextStep:string|null;onDone:()=>void}){
  const {isAdmin}=useStaff();
  const router=useRouter();
  const [allowed,setAllowed]=useState<Rule[]>([]);
  const [all,setAll]=useState<Rule[]>([]);
  const [status,setStatus]=useState<Status>(current);
  const [step,setStep]=useState(nextStep??"");
  const [override,setOverride]=useState(false);
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    let live=true;
    setLoading(true);
    fetch(`/api/staff/workflow?from=${encodeURIComponent(current)}`,{cache:"no-store"})
      .then(async res=>{const data=await res.json().catch(()=>null);if(!res.ok||!data?.ok)throw new Error(data?.error?.message??`Workflow load failed (${res.status})`);return data;})
      .then(data=>{if(!live)return;const source=data.data??data;setAllowed(source.allowed??[]);setAll(source.all??[]);})
      .catch(e=>live&&setError(e instanceof Error?e.message:"Unable to load workflow"))
      .finally(()=>live&&setLoading(false));
    return()=>{live=false};
  },[current]);

  const options=useMemo(()=>{
    const base=override&&isAdmin?all:allowed;
    return [{status:current,label:"Keep current status",default_next_action:nextStep??"",sequence:-1,terminal:false} as Rule,...base.filter(r=>r.status!==current)];
  },[allowed,all,current,isAdmin,nextStep,override]);

  function choose(value:Status){
    setStatus(value);
    const rule=options.find(r=>r.status===value);
    if(value!==current&&rule)setStep(rule.default_next_action);
  }

  async function submit(){
    setBusy(true);setError(null);
    try{
      const body=override&&isAdmin&&status!==current
        ?{action:"override_status",client_id:clientId,status,reason:reason.trim(),next_step:step.trim()||null}
        :{action:"update_status",client_id:clientId,status,next_step:step.trim()||null};
      if(override&&isAdmin&&status!==current&&!reason.trim())throw new Error("Override reason is required");
      const res=await fetch("/api/staff/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await res.json().catch(()=>null);
      if(!res.ok||!data?.ok)throw new Error(data?.error?.message??`Status update failed (${res.status})`);
      router.refresh();onDone();
    }catch(e){setError(e instanceof Error?e.message:"Status update failed");}
    finally{setBusy(false);}
  }

  return <section className="staff-glass-strong rounded-2xl p-4" aria-label="Change client status">
    <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.14em] text-slate-500">Canonical Workflow</p><h3 className="mt-1 font-semibold">Change Status</h3></div>{isAdmin&&<label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={override} onChange={e=>setOverride(e.target.checked)}/>Admin override</label>}</div>
    {loading?<p className="mt-4 text-sm text-slate-500">Loading published workflow…</p>:<div className="mt-4 grid gap-3 lg:grid-cols-2"><label className="grid gap-1 text-xs text-slate-500"><span>Status</span><select className="ops-select" value={status} onChange={e=>choose(e.target.value as Status)}>{options.map(r=><option key={r.status} value={r.status}>{r.label}</option>)}</select></label><label className="grid gap-1 text-xs text-slate-500"><span>Next Action</span><input className="ops-input" value={step} onChange={e=>setStep(e.target.value)} maxLength={500}/></label>{override&&isAdmin&&status!==current&&<label className="grid gap-1 text-xs text-slate-500 lg:col-span-2"><span>Override Reason</span><input className="ops-input" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label>}</div>}
    {error&&<p className="mt-3 text-sm text-red-300">{error}</p>}
    <div className="mt-4 flex gap-2"><button className="ops-primary-button" disabled={busy||loading} onClick={()=>void submit()}>{busy?"Saving…":"Save Status"}</button><button className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300" type="button" onClick={onDone}>Cancel</button></div>
  </section>;
}
