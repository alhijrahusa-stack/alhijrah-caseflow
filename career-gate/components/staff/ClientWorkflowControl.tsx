"use client";

import { RoyalSelect, RoyalOption } from "@/components/forms/RoyalSelect";


import { useState } from "react";
import { CLIENT_STAGES } from "@/lib/client-lifecycle-filters";
import { g3StageForStatus } from "@/lib/g3-stages";
import { useTargetedMutationBatch } from "@/components/staff/realtime/useTargetedMutation";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";

export function ClientWorkflowControl({ clientId, status, management, compact=false }: { clientId:string; status:string; management:boolean; compact?:boolean }) {
  const { t, dir, language } = useStaffLanguage();
  const [open,setOpen]=useState(false);
  const [target,setTarget]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [failed,setFailed]=useState(false);
  const changed=useTargetedMutationBatch();
  if (!management) return null;
  async function submit() {
    if (!target || reason.trim().length<3 || busy) return;
    setBusy(true);setMessage("");setFailed(false);
    try {
      const body=target==="completed"||target==="reconcile"
        ? {operation:"reconcile_workflow",client_id:clientId,reason:reason.trim(),complete_only:target==="completed"}
        : {operation:"bulk_assign",client_ids:[clientId],target_stage:target,reason:reason.trim()};
      const response=await fetch("/api/staff/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
      const data=await response.json().catch(()=>null);
      if (!response.ok || !data?.ok) throw new Error(data?.error?.message??t("Workflow update failed", "تعذر تحديث المسار"));
      setMessage(data.changed?t("Workflow updated and recorded", "تم تحديث المسار وتسجيل العملية"):t("Checked; no further transition is eligible", "تم التحقق؛ لم تستوفِ الحالة انتقالًا إضافيًا"));
      changed("bulk_assign",[clientId]);
    } catch(error) {setFailed(true);setMessage(error instanceof Error?error.message:t("Connection failed", "تعذر الاتصال"));}
    finally {setBusy(false);}
  }
  return <div className="cg-workflow-control" dir={dir}>
    <button type="button" className="cg-command-button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>↗ {t("Workflow & manual routing", "المسار والنقل اليدوي")} <span className="text-xs text-cyan-200" dir="ltr">{g3StageForStatus(status)}</span></button>
    {open&&<div className={compact?"mt-3 grid gap-3":"mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto]"}>
      <label className="text-xs text-slate-300">{t("Destination", "الوجهة")}<RoyalSelect aria-label={t("Workflow destination", "وجهة المسار")} className="input mt-1 w-full" value={target} onChange={event=>setTarget(event.target.value)}><RoyalOption value="" labelAr="اختر الوجهة">Choose destination</RoyalOption><RoyalOption value="reconcile" labelAr="إعادة مزامنة المسار">Reconcile workflow</RoyalOption>{CLIENT_STAGES.map(stage=><RoyalOption key={stage.id} value={stage.id}>{language === "ar" ? stage.labelAr : stage.label}</RoyalOption>)}</RoyalSelect></label>
      <label className="text-xs text-slate-300">{t("Routing reason", "سبب النقل")}<input aria-label={t("Workflow move reason", "سبب نقل الملف")} className="input mt-1 w-full" value={reason} onChange={event=>setReason(event.target.value)} maxLength={500} placeholder={t("A clear reason recorded in the file history", "سبب واضح يحفظ في سجل الملف")} dir="auto"/></label>
      <button type="button" className="ops-primary-button self-end" onClick={submit} disabled={busy||!target||reason.trim().length<3}>{busy?t("Checking…", "جارٍ التحقق…"):t("Check & apply", "تحقق ونفّذ")}</button>
      <p className={compact?"text-xs text-slate-400":"text-xs text-slate-400 sm:col-span-3"}>{t("The employee and reason are recorded. Closing a file requires a settled ledger and completed post-interview items.", "يُحفظ الموظف والسبب. إغلاق الملف يتطلب سداد الدفتر واكتمال بنود ما بعد المقابلة.")}</p>
    </div>}
    {message&&<p role={failed?"alert":"status"} className={`mt-2 text-sm ${failed?"text-rose-300":"text-teal-200"}`}>{message}</p>}
  </div>;
}
