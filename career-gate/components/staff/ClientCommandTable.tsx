"use client";
import Link from "next/link";
import { RoyalSelect, RoyalOption } from "@/components/forms/RoyalSelect";
import { ClientSearchHighlight } from "@/components/staff/ClientRegistryToolbar";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { normalizeRegistrySearch } from "@/lib/registry-filters";
import { ClientWorkflowControl } from "@/components/staff/ClientWorkflowControl";
import dynamic from "next/dynamic";
import { CLIENT_STAGES, type ClientStageFilter } from "@/lib/client-lifecycle-filters";
import { dateTime } from "@/lib/format";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTargetedMutationBatch } from "@/components/staff/realtime/useTargetedMutation";

const Client360Drawer = dynamic(() => import("@/components/staff/Client360Drawer").then(module => module.Client360Drawer), {
 ssr: false,
 loading: () => <p role="status" className="text-sm text-slate-300">Loading Client 360…</p>,
});

export type CommandClient={
 id:string;ref:string;full_name:string;phone:string;email:string|null;city:string|null;
 current_status:string;next_step:string;amazon_account_ready:boolean;payment_status:string|null;assigned_staff:string|null;assigned_name:string|null;
 created_at:string;updated_at:string;site_name:string|null;shift_name:string|null;
};
type Staff={id:string;display_name:string};
export function ClientCommandTable({clients,staff,management,query=""}:{clients:CommandClient[];staff:Staff[];management:boolean;query?:string}){
 const {t}=useStaffLanguage();
 const onMutated=useTargetedMutationBatch();
 const [assigned,setAssigned]=useState<Record<string,{assigned_staff:string|null;assigned_name:string|null}>>({});
 const [seen,setSeen]=useState(clients);
 if(seen!==clients){setSeen(clients);setAssigned({});}
 const rows=useMemo(()=>clients.map(c=>assigned[c.id]?{...c,...assigned[c.id]}:c),[clients,assigned]);
 const [draftQuery,setDraftQuery]=useState(query);
 const [querySeed,setQuerySeed]=useState(query);
 if(querySeed!==query){setQuerySeed(query);setDraftQuery(query);}
 useEffect(()=>{const change=(event:Event)=>setDraftQuery(String((event as CustomEvent<string>).detail??""));window.addEventListener("career-gate:registry-query",change);return()=>window.removeEventListener("career-gate:registry-query",change);},[]);
 const [selected,setSelected]=useState<string[]>([]);
 const [drawer,setDrawer]=useState<CommandClient|null>(null);
 const [owner,setOwner]=useState("__keep__");
 const [targetStage,setTargetStage]=useState<ClientStageFilter | "">("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [view,setView]=useState<"table"|"grid">("grid");
 const closeDrawer=useCallback(()=>setDrawer(null),[]);
 const typing=draftQuery.trim()!==query.trim();
 // Immediate narrowing while typing; the committed response always contains all server matches,
 // including fuzzy/OCR matches whose text is not necessarily visible on this row.
 const matching=useMemo(()=>typing&&draftQuery.trim()?rows.filter(c=>{
  const term=normalizeRegistrySearch(draftQuery.trim());
  return [c.ref,c.full_name,c.phone,c.email??"",c.assigned_name??""].some(value=>normalizeRegistrySearch(value).includes(term));
 }):rows,[rows,draftQuery,typing]);
 const highlight=(value:string)=><ClientSearchHighlight value={value} query={draftQuery}/>;
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
 const cards=<div className="royal-client-rows grid min-w-0 gap-3" data-testid="client-registry-responsive-cards" aria-busy={typing}>
   {matching.map(c=><article key={c.id} className="cg-registry-card registry-fluid-row">
     <div className="registry-client-identity" dir="ltr">
       {management&&<input type="checkbox" aria-label={`Select ${c.full_name}`} checked={selected.includes(c.id)} onChange={()=>toggle(c.id)} disabled={["completed","cancelled"].includes(c.current_status)} className="registry-row-checkbox"/>}
       <span aria-hidden="true" className="registry-client-avatar">{c.full_name.trim().split(/\s+/).slice(0,2).map(x=>x.charAt(0)).join("").toUpperCase()}</span>
       <div className="registry-client-name"><Link href={`/staff/client/${c.id}`} prefetch={false} className="registry-name-link">{highlight(c.full_name)}</Link><Link href={`/staff/client/${c.id}`} prefetch={false} className="registry-ref-link">{highlight(c.ref)}</Link><p className="registry-client-contact">{highlight(c.phone)}{c.email&&<> · {highlight(c.email)}</>}</p></div>
     </div>
     <div className="registry-client-stage">{badge(c.current_status)}<span>{c.assigned_name??t("Unassigned","غير معيّن")}</span><div>{c.amazon_account_ready&&<small className="text-emerald-300">{t("Amazon ready","حساب Amazon جاهز")}</small>}{!c.amazon_account_ready&&["shift_selected","appointment_required"].includes(c.current_status)&&<small className="text-amber-200">{t("Account needs verification","الحساب يحتاج التحقق")}</small>}{c.payment_status==="paid"&&<small className="text-emerald-300">{t("Paid","مدفوع")}</small>}</div></div>
     <div className="registry-client-details"><span>{t("Received","تاريخ الاستلام")}</span><time dateTime={new Date(c.created_at).toISOString()} dir="ltr">{dateTime(c.created_at)}</time><p dir="ltr">{c.site_name??"—"} · {c.shift_name??"—"}</p></div>
     <div className="registry-client-actions"><Link href={`/staff/client/${c.id}`} prefetch={false} className="cg-command-button registry-open">{t("Open Client ↗","فتح الملف ↗")}</Link><button type="button" className="cg-command-button registry-secondary-action" onClick={()=>setDrawer(c)}>{t("Quick view · Client 360","معاينة سريعة · Client 360")}</button><ClientWorkflowControl clientId={c.id} status={c.current_status} management={management} compact/></div>
     <p className="registry-next-step">{c.next_step}</p>
   </article>)}
 </div>;
 return <section className="ops-glass-card space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="ops-kicker">{t("EXECUTIVE OPERATIONS · COMMAND BAR","العمليات التنفيذية · شريط الأوامر")}</p><h2 className="text-lg font-bold text-white">{t("Candidate Registry","سجل المرشحين")}</h2></div><div className="flex gap-2"><button type="button" aria-pressed={view==="table"} onClick={()=>setView("table")} className="cg-command-button">{t("Table","جدول")}</button><button type="button" aria-pressed={view==="grid"} onClick={()=>setView("grid")} className="cg-command-button">{t("Grid","بطاقات")}</button></div></div>

  {management&&<div className="flex flex-wrap items-end gap-2 border-t border-amber-200/15 pt-3">
    <span className="self-center text-sm font-medium text-amber-100">{selected.length} {t("selected","محدد")}</span>
    <label className="min-w-0 flex-1 text-xs text-slate-300 sm:min-w-44">{t("Assigned Specialist","الموظف المختص")}
      <RoyalSelect className="input mt-1 w-full" aria-label="Assign selected cases to" value={owner} onChange={e=>setOwner(e.target.value)}>
        <RoyalOption value="__keep__">{t("Keep current owner","الإبقاء على الموظف الحالي")}</RoyalOption><RoyalOption value="">{t("Unassigned","غير معيّن")}</RoyalOption>{staff.map(s=><RoyalOption key={s.id} value={s.id}>{s.display_name}</RoyalOption>)}
      </RoyalSelect>
    </label>
    <label className="min-w-0 flex-1 text-xs text-slate-300 sm:min-w-44">{t("Lifecycle Station","مرحلة المسار")}
      <RoyalSelect className="input mt-1 w-full" aria-label="Move selected clients to lifecycle stage" value={targetStage} onChange={e=>setTargetStage(e.target.value as ClientStageFilter|"")}>
        <RoyalOption value="">{t("Keep current stage","الإبقاء على المرحلة الحالية")}</RoyalOption>{CLIENT_STAGES.map(stage=><RoyalOption key={stage.id} value={stage.id}>{t(stage.label,stage.labelAr)}</RoyalOption>)}
      </RoyalSelect>
    </label>
    <button type="button" className="cg-command-button min-h-11 border-amber-200/45" disabled={busy||!selected.length||(owner==="__keep__"&&!targetStage)} onClick={bulkAssign}>{busy?t("Applying…","جارٍ التطبيق…"):t("Assign selected","تعيين المحدد")}</button>
    {targetStage&&<p className="w-full text-xs text-amber-200/90" role="status">{t("Moves require verified prerequisites. Invalid moves are rejected atomically; Pass and payment are never inferred.","يتطلب النقل استيفاء المتطلبات الموثقة. يُرفض النقل غير الصالح بالكامل؛ ولا يُفترض النجاح أو السداد.")}</p>}
   </div>}
  {error&&<p role="alert" className="text-red-300">{error}</p>}
  {view==="table"?<><div className="hidden min-w-0 overflow-x-auto xl:block"><table className="table min-w-[980px]"><thead><tr>{management&&<th><input type="checkbox" aria-label="Select visible" checked={!!eligible.length&&eligible.every(x=>selected.includes(x.id))} onChange={e=>setSelected(cur=>e.target.checked?[...new Set([...cur,...eligible.map(x=>x.id)])]:cur.filter(x=>!eligible.some(y=>y.id===x)))} /></th>}<th>{t("Case ID","رقم الملف")}</th><th>{t("Candidate","المرشح")}</th><th>{t("Pipeline Stage","مرحلة المسار")}</th><th>{t("Assigned To","الموظف المختص")}</th><th>{t("Received","الاستلام")}</th><th>{t("Last Activity","آخر نشاط")}</th><th>{t("Next Milestone","الخطوة التالية")}</th><th>{t("Quick View","معاينة")}</th></tr></thead><tbody>{matching.map(c=><tr key={c.id} className="cg-registry-row border-b border-white/[.07]">{management&&<td><input type="checkbox" aria-label={`Select ${c.full_name}`} checked={selected.includes(c.id)} onChange={()=>toggle(c.id)} disabled={["completed","cancelled"].includes(c.current_status)}/></td>}<td className="font-mono font-extrabold tracking-wide text-lime-300 drop-shadow-[0_0_8px_rgba(163,230,53,.2)]"><Link href={`/staff/client/${c.id}`} prefetch={false} className="hover:underline">{highlight(c.ref)}</Link></td><td><Link href={`/staff/client/${c.id}`} prefetch={false} className="group flex min-w-0 items-center gap-3 text-left" aria-label={`Open client ${c.full_name}`}><span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-amber-200/25 bg-gradient-to-br from-amber-200/20 to-sky-300/10 text-sm font-bold text-amber-100 shadow-[inset_0_1px_rgba(255,255,255,.18)]">{c.full_name.trim().split(/\s+/).slice(0,2).map(x=>x.charAt(0)).join("").toUpperCase()}</span><span className="min-w-0"><strong className="block truncate text-[15px] font-semibold tracking-tight text-slate-100 transition group-hover:text-amber-200">{highlight(c.full_name)}</strong><small className="block truncate text-xs font-normal text-slate-400">{c.phone} · {c.city??"—"}</small></span></Link></td><td>{badge(c.current_status)}</td><td>{c.assigned_name??t("Unassigned","غير معيّن")}</td><td className="whitespace-nowrap text-sm text-slate-300">{dateTime(c.created_at)}</td><td className="whitespace-nowrap text-amber-200">{dateTime(c.updated_at)}</td><td>{c.next_step}</td><td><button type="button" className="rounded-2xl border border-amber-300/30 bg-amber-200/[.06] px-4 py-2 text-sm text-amber-100 shadow-[inset_0_1px_rgba(255,255,255,.14)] transition hover:-translate-y-px hover:border-amber-300/60 hover:bg-amber-200/15" onClick={()=>setDrawer(c)}>{t("Quick view · Client 360","معاينة سريعة · Client 360")}</button></td></tr>)}</tbody></table></div><div className="xl:hidden">{cards}</div></>:cards}
  {!matching.length&&<p role="status" className="p-4 text-center text-slate-400">{typing?t("Searching all permitted files…","جارٍ البحث في جميع الملفات المسموح بها…"):t("No matching cases","لا توجد ملفات مطابقة")}</p>}
  {drawer && <Client360Drawer key={drawer.id} client={drawer} onClose={closeDrawer} />}

 </section>;
}
