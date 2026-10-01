"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminHealth, AdminStaffRow, AssetRow, PermissionRuleRow, WorkflowEntryRow, WorkflowRuleRow, WorkflowTransitionRow, WorkflowVersionRow } from "@/lib/admin-control";

type Props={
  role:"admin"|"manager"|"staff";
  permissions:PermissionRuleRow[];
  workflow:{versions:WorkflowVersionRow[];rules:WorkflowRuleRow[];transitions:WorkflowTransitionRow[];entries:WorkflowEntryRow[]};
  staff:AdminStaffRow[];
  assets:AssetRow[];
  health:AdminHealth;
};
type Tab="health"|"permissions"|"workflow"|"staff"|"assets";

async function mutate(body:Record<string,unknown>){
  const res=await fetch("/api/staff/admin-control",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await res.json().catch(()=>null);
  if(!res.ok||!data?.ok)throw new Error(data?.error?.message??`Operation failed (${res.status})`);
  return data;
}

function Metric({label,value}:{label:string;value:string|number}){return <div className="staff-kpi rounded-2xl p-4"><p className="text-xs uppercase tracking-[.12em] text-slate-500">{label}</p><strong className="mt-2 block text-2xl text-slate-100">{value}</strong></div>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="grid gap-1 text-xs text-slate-500"><span>{label}</span>{children}</label>}

export function AdminControl({role,permissions,workflow,staff,assets,health}:Props){
  const router=useRouter();
  const tabs:Tab[]=role==="admin"?["health","permissions","workflow","staff","assets"]:["assets"];
  const [tab,setTab]=useState<Tab>(tabs[0]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const run=async(body:Record<string,unknown>,ok="Saved")=>{
    setBusy(true);setMessage(null);setError(null);
    try{await mutate(body);setMessage(ok);router.refresh();}
    catch(e){setError(e instanceof Error?e.message:"Operation failed");}
    finally{setBusy(false);}
  };

  return <div className="ops-page space-y-4">
    <header className="ops-hero"><div><p className="ops-kicker">CAREER GATE · ADMIN CONTROL</p><h1>Admin Control</h1><p>Permissions, workflow, staff, assets and system health from one control plane.</p></div></header>
    <nav className="ops-segmented w-fit" aria-label="Admin sections">{tabs.map(t=><button key={t} type="button" data-active={tab===t} onClick={()=>setTab(t)} className="capitalize">{t}</button>)}</nav>
    {(message||error)&&<div className={`rounded-xl border p-3 text-sm ${error?"border-red-400/20 bg-red-400/[.06] text-red-300":"border-emerald-400/20 bg-emerald-400/[.06] text-emerald-300"}`}>{error??message}</div>}
    {tab==="health"&&role==="admin"&&<Health health={health}/>} 
    {tab==="permissions"&&role==="admin"&&<Permissions rows={permissions} busy={busy} onSave={(id,scope)=>run({operation:"update_permission",rule_id:id,scope})}/>} 
    {tab==="workflow"&&role==="admin"&&<Workflow data={workflow} busy={busy} onRun={run}/>} 
    {tab==="staff"&&role==="admin"&&<StaffProfiles rows={staff} busy={busy} onRun={run}/>} 
    {tab==="assets"&&<Assets rows={assets} staff={staff.filter(s=>s.active)} busy={busy} onRun={run}/>} 
  </div>;
}

function Health({health}:{health:AdminHealth}){
  const failures=health.jobs.filter(j=>["failed","dead"].includes(j.status)).reduce((n,j)=>n+j.n,0);
  const notificationFailures=health.notifications.filter(n=>n.status==="failed").reduce((a,n)=>a+n.n,0);
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Failed / Dead Jobs" value={failures}/><Metric label="Failed Notifications" value={notificationFailures}/><Metric label="Open Audit Alerts" value={health.open_audit_alerts}/><Metric label="Unassigned Active" value={health.unassigned_active_clients}/><Metric label="Overdue Tasks" value={health.overdue_tasks}/></div>
    <div className="grid gap-4 lg:grid-cols-2"><section className="ops-glass-card"><h2 className="text-lg font-semibold">Background Jobs</h2><div className="mt-3 grid gap-2">{health.jobs.map(j=><div key={j.status} className="flex justify-between rounded-xl border border-white/[.06] p-3"><span className="capitalize text-slate-400">{j.status.replace(/_/g," ")}</span><b>{j.n}</b></div>)}</div></section><section className="ops-glass-card"><h2 className="text-lg font-semibold">Notifications</h2><div className="mt-3 grid gap-2">{health.notifications.map(n=><div key={n.status} className="flex justify-between rounded-xl border border-white/[.06] p-3"><span className="capitalize text-slate-400">{n.status.replace(/_/g," ")}</span><b>{n.n}</b></div>)}</div></section></div>
  </div>;
}

function Permissions({rows,busy,onSave}:{rows:PermissionRuleRow[];busy:boolean;onSave:(id:string,scope:PermissionRuleRow["scope"])=>void}){
  const grouped=useMemo(()=>Object.entries(rows.reduce<Record<string,PermissionRuleRow[]>>((a,r)=>{(a[r.resource]??=[]).push(r);return a;},{})),[rows]);
  return <div className="space-y-4">{grouped.map(([resource,items])=><section key={resource} className="ops-glass-card overflow-x-auto"><h2 className="mb-3 text-lg font-semibold capitalize">{resource.replace(/_/g," ")}</h2><table className="table"><thead><tr><th>Action</th><th>Admin</th><th>Manager</th><th>Staff</th></tr></thead><tbody>{Array.from(new Set(items.map(i=>i.action))).map(action=><tr key={action}><td className="font-medium">{action.replace(/_/g," ")}</td>{(["admin","manager","staff"] as const).map(role=>{const r=items.find(i=>i.action===action&&i.role===role);return <td key={role}>{r?<select disabled={busy} className="ops-select" value={r.scope} onChange={e=>onSave(r.id,e.target.value as PermissionRuleRow["scope"])}><option value="ALL">ALL</option><option value="ASSIGNED">ASSIGNED</option><option value="NONE">NONE</option></select>:"—"}</td>})}</tr>)}</tbody></table></section>)}</div>;
}

function Workflow({data,busy,onRun}:{data:Props["workflow"];busy:boolean;onRun:(b:Record<string,unknown>,m?:string)=>Promise<void>}){
  const published=data.versions.find(v=>v.status==="published")??null;
  const draft=data.versions.find(v=>v.status==="draft")??null;
  const [label,setLabel]=useState("Next workflow revision");
  const active=draft??published;
  const rules=active?data.rules.filter(r=>r.version_id===active.id):[];
  const entries=active?new Set(data.entries.filter(e=>e.version_id===active.id).map(e=>e.status)):new Set<string>();
  const transitions=active?data.transitions.filter(t=>t.version_id===active.id):[];
  return <div className="space-y-4">
    <section className="ops-glass-card"><div className="flex flex-wrap items-center gap-3"><div><h2 className="text-lg font-semibold">Workflow Versions</h2><p className="text-sm text-slate-500">Published #{published?.version_no??"—"}{draft?` · Draft #${draft.version_no}`:""}</p></div>{!draft&&<><input className="ops-input ml-auto max-w-sm" value={label} onChange={e=>setLabel(e.target.value)}/><button disabled={busy} className="ops-primary-button" onClick={()=>void onRun({operation:"clone_workflow",label},"Draft created")}>Create Draft</button></>}{draft&&<button disabled={busy} className="ops-primary-button ml-auto" onClick={()=>void onRun({operation:"publish_workflow",version_id:draft.id},"Workflow published")}>Validate & Publish</button>}</div></section>
    {active&&<section className="ops-glass-card overflow-x-auto"><h2 className="mb-3 text-lg font-semibold">Status Rules · {active.status}</h2><table className="table"><thead><tr><th>Status</th><th>Label</th><th>Default Next Action</th><th>Entry</th><th>Terminal</th><th/></tr></thead><tbody>{rules.map(r=><WorkflowRule key={r.status} row={r} entry={entries.has(r.status)} editable={active.status==="draft"} busy={busy} onRun={onRun}/>)}</tbody></table></section>}
    {active&&<section className="ops-glass-card"><h2 className="text-lg font-semibold">Transitions</h2><p className="mt-1 text-sm text-slate-500">{transitions.length} transitions in this version. Edit status rules and publish atomically; runtime tables remain the active projection.</p><div className="mt-3 flex flex-wrap gap-2">{transitions.map(t=><span key={`${t.from_status}-${t.to_status}`} className="rounded-full border border-white/[.08] px-2.5 py-1 text-xs text-slate-400">{t.from_status.replace(/_/g," ")} → {t.to_status.replace(/_/g," ")}</span>)}</div></section>}
  </div>;
}

function WorkflowRule({row,entry,editable,busy,onRun}:{row:WorkflowRuleRow;entry:boolean;editable:boolean;busy:boolean;onRun:(b:Record<string,unknown>,m?:string)=>Promise<void>}){
  const [label,setLabel]=useState(row.label_en);const [next,setNext]=useState(row.default_next_action);
  return <tr><td>{row.status.replace(/_/g," ")}</td><td><input className="ops-input min-w-44" disabled={!editable||busy} value={label} onChange={e=>setLabel(e.target.value)}/></td><td><input className="ops-input min-w-72" disabled={!editable||busy} value={next} onChange={e=>setNext(e.target.value)}/></td><td>{entry?"Yes":"No"}</td><td>{row.terminal?"Yes":"No"}</td><td>{editable&&<button className="ops-primary-button" disabled={busy} onClick={()=>void onRun({operation:"update_workflow_rule",version_id:row.version_id,status:row.status,label_en:label,default_next_action:next,sequence:row.sequence,terminal:row.terminal,active:row.active},"Rule saved")}>Save</button>}</td></tr>;
}

function StaffProfiles({rows,busy,onRun}:{rows:AdminStaffRow[];busy:boolean;onRun:(b:Record<string,unknown>,m?:string)=>Promise<void>}){
  return <div className="grid gap-4 xl:grid-cols-2">{rows.map(s=><StaffCard key={s.id} row={s} busy={busy} onRun={onRun}/>)}</div>;
}
function StaffCard({row,busy,onRun}:{row:AdminStaffRow;busy:boolean;onRun:(b:Record<string,unknown>,m?:string)=>Promise<void>}){
  const [v,setV]=useState({phone:row.phone??"",date_of_birth:row.date_of_birth??"",address_line1:row.address_line1??"",city:row.city??"",state:row.state??"",postal_code:row.postal_code??"",qualification:row.qualification??"",job_title:row.job_title??"",join_date:row.join_date??"",employment_type:row.employment_type??"",department:row.department??""});
  const f=(k:keyof typeof v)=>(e:React.ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>setV(x=>({...x,[k]:e.target.value}));
  return <article className="ops-glass-card"><div className="mb-4"><h2 className="text-lg font-semibold">{row.display_name}</h2><p className="text-xs text-slate-500">{row.staff_code??"—"} · {row.role} · {row.active?"ACTIVE":"INACTIVE"}</p></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Phone"><input className="ops-input" value={v.phone} onChange={f("phone")}/></Field><Field label="Job Title"><input className="ops-input" value={v.job_title} onChange={f("job_title")}/></Field><Field label="Qualification"><input className="ops-input" value={v.qualification} onChange={f("qualification")}/></Field><Field label="Join Date"><input type="date" className="ops-input" value={v.join_date} onChange={f("join_date")}/></Field><Field label="Employment Type"><select className="ops-select" value={v.employment_type} onChange={f("employment_type")}><option value="">—</option><option value="full_time">Full Time</option><option value="part_time">Part Time</option><option value="contractor">Contractor</option><option value="temporary">Temporary</option><option value="other">Other</option></select></Field><Field label="Department"><input className="ops-input" value={v.department} onChange={f("department")}/></Field><Field label="Address"><input className="ops-input" value={v.address_line1} onChange={f("address_line1")}/></Field><Field label="City"><input className="ops-input" value={v.city} onChange={f("city")}/></Field><Field label="State"><input className="ops-input" value={v.state} onChange={f("state")}/></Field><Field label="ZIP"><input className="ops-input" value={v.postal_code} onChange={f("postal_code")}/></Field></div><button disabled={busy} className="ops-primary-button mt-4" onClick={()=>void onRun({operation:"update_staff_profile",staff_id:row.id,...Object.fromEntries(Object.entries(v).map(([k,x])=>[k,x||null]))},"Staff profile saved")}>Save Profile</button></article>;
}

function Assets({rows,staff,busy,onRun}:{rows:AssetRow[];staff:AdminStaffRow[];busy:boolean;onRun:(b:Record<string,unknown>,m?:string)=>Promise<void>}){
  const [v,setV]=useState({asset_code:"",asset_type:"phone",ownership:"office",brand:"",model:"",serial_number:"",condition:"good",note:""});
  return <div className="space-y-4"><section className="ops-glass-card"><h2 className="text-lg font-semibold">Register Asset</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Asset Number"><input className="ops-input" value={v.asset_code} onChange={e=>setV({...v,asset_code:e.target.value})}/></Field><Field label="Type"><select className="ops-select" value={v.asset_type} onChange={e=>setV({...v,asset_type:e.target.value})}><option value="phone">Phone</option><option value="laptop">Laptop</option><option value="tablet">Tablet</option><option value="other">Other</option></select></Field><Field label="Ownership"><select className="ops-select" value={v.ownership} onChange={e=>setV({...v,ownership:e.target.value})}><option value="office">Office</option><option value="personal">Personal</option></select></Field><Field label="Condition"><select className="ops-select" value={v.condition} onChange={e=>setV({...v,condition:e.target.value})}><option value="new">New</option><option value="good">Good</option><option value="fair">Fair</option><option value="damaged">Damaged</option><option value="repair">Repair</option></select></Field><Field label="Brand"><input className="ops-input" value={v.brand} onChange={e=>setV({...v,brand:e.target.value})}/></Field><Field label="Model"><input className="ops-input" value={v.model} onChange={e=>setV({...v,model:e.target.value})}/></Field><Field label="Serial"><input className="ops-input" value={v.serial_number} onChange={e=>setV({...v,serial_number:e.target.value})}/></Field></div><button disabled={busy||!v.asset_code.trim()} className="ops-primary-button mt-4" onClick={()=>void onRun({operation:"create_asset",...v,brand:v.brand||null,model:v.model||null,serial_number:v.serial_number||null,note:v.note||null},"Asset registered")}>Register Asset</button></section><div className="grid gap-4 xl:grid-cols-2">{rows.map(a=><AssetCard key={a.id} asset={a} staff={staff} busy={busy} onRun={onRun}/>)}</div></div>;
}
function AssetCard({asset,staff,busy,onRun}:{asset:AssetRow;staff:AdminStaffRow[];busy:boolean;onRun:(b:Record<string,unknown>,m?:string)=>Promise<void>}){
  const [staffId,setStaffId]=useState("");
  return <article className="ops-glass-card"><div className="flex items-start justify-between"><div><h3 className="font-semibold">{asset.asset_code} · {asset.brand??""} {asset.model??""}</h3><p className="text-xs text-slate-500">{asset.asset_type} · {asset.ownership} · {asset.condition}</p></div><span className="rounded-full border border-white/10 px-2 py-1 text-xs capitalize">{asset.status.replace(/_/g," ")}</span></div>{asset.assignment_id?<div className="mt-4"><p className="text-sm text-slate-400">Assigned to <strong className="text-slate-200">{asset.assigned_name}</strong></p><button disabled={busy} className="mt-3 rounded-xl border border-white/10 px-3 py-2 text-xs" onClick={()=>void onRun({operation:"return_asset",assignment_id:asset.assignment_id,return_condition:asset.condition,note:null},"Asset returned")}>Return Asset</button></div>:<div className="mt-4 flex gap-2"><select className="ops-select flex-1" value={staffId} onChange={e=>setStaffId(e.target.value)}><option value="">Assign to staff</option>{staff.map(s=><option key={s.id} value={s.id}>{s.staff_code??"—"} · {s.display_name}</option>)}</select><button disabled={busy||!staffId} className="ops-primary-button" onClick={()=>void onRun({operation:"assign_asset",asset_id:asset.id,staff_id:staffId,issue_condition:asset.condition,return_due_at:null,note:null},"Asset assigned")}>Assign</button></div>}</article>;
}
