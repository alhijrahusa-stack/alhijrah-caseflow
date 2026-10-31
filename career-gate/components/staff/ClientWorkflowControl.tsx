"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CLIENT_STAGES } from "@/lib/client-lifecycle-filters";
import { g3StageForStatus } from "@/lib/g3-stages";
import { useTargetedMutationBatch } from "@/components/staff/realtime/useTargetedMutation";

export function ClientWorkflowControl({ clientId, status, management, compact=false }: { clientId:string; status:string; management:boolean; compact?:boolean }) {
  const [open,setOpen]=useState(false);
  const [target,setTarget]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [failed,setFailed]=useState(false);
  const router=useRouter();
  const changed=useTargetedMutationBatch();
  if (!management) return null;
  async function submit() {
    if (!target || reason.trim().length<3 || busy) return;
    setBusy(true);setMessage("");setFailed(false);
    try {
      const body=target==="completed"||target==="reconcile"
        ? {operation:"reconcile_workflow",client_id:clientId,reason:reason.trim()}
        : {operation:"bulk_assign",client_ids:[clientId],target_stage:target,reason:reason.trim()};
      const response=await fetch("/api/staff/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
      const data=await response.json().catch(()=>null);
      if (!response.ok || !data?.ok) throw new Error(data?.error?.message??"تعذر تحديث المسار");
      setMessage(data.changed?"تم تحديث المسار وتسجيل العملية":"تم التحقق؛ لم تستوفِ الحالة انتقالًا إضافيًا");
      changed("bulk_assign",[clientId]);router.refresh();
    } catch(error) {setFailed(true);setMessage(error instanceof Error?error.message:"تعذر الاتصال");}
    finally {setBusy(false);}
  }
  return <div className="cg-workflow-control" dir="rtl">
    <button type="button" className="cg-command-button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>↗ المسار والنقل اليدوي <span className="text-xs text-cyan-200">{g3StageForStatus(status)}</span></button>
    {open&&<div className={compact?"mt-3 grid gap-3":"mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto]"}>
      <label className="text-xs text-slate-300">الوجهة<select aria-label="Workflow destination" className="input mt-1 w-full" value={target} onChange={event=>setTarget(event.target.value)}><option value="">اختر الوجهة</option><option value="reconcile">إعادة مزامنة المسار</option>{CLIENT_STAGES.map(stage=><option key={stage.id} value={stage.id}>{stage.labelAr}</option>)}</select></label>
      <label className="text-xs text-slate-300">سبب النقل<input aria-label="Workflow move reason" className="input mt-1 w-full" value={reason} onChange={event=>setReason(event.target.value)} maxLength={500} placeholder="سبب واضح يحفظ في سجل الملف"/></label>
      <button type="button" className="ops-primary-button self-end" onClick={submit} disabled={busy||!target||reason.trim().length<3}>{busy?"جارٍ التحقق…":"تحقق ونفّذ"}</button>
      <p className={compact?"text-xs text-slate-400":"text-xs text-slate-400 sm:col-span-3"}>يُحفظ الموظف والسبب. إغلاق الملف يتطلب سداد الدفتر واكتمال بنود ما بعد المقابلة.</p>
    </div>}
    {message&&<p role={failed?"alert":"status"} className={`mt-2 text-sm ${failed?"text-rose-300":"text-teal-200"}`}>{message}</p>}
  </div>;
}
