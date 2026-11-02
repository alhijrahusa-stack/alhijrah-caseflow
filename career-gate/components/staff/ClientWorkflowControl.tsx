"use client";

import { RoyalSelect, RoyalOption } from "@/components/forms/RoyalSelect";


import { useState } from "react";
import { CLIENT_STAGES } from "@/lib/client-lifecycle-filters";
import { OVERRIDE_REASON_MIN } from "@/lib/client-lifecycle-routing";
import { g3StageForStatus } from "@/lib/g3-stages";
import { useTargetedMutationBatch } from "@/components/staff/realtime/useTargetedMutation";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";

/**
 * Two modes. "Check & apply" moves the file only when its evidence allows the
 * stage (the canonical path). "Authorized skip" lets a manager move one file to
 * a stage without its prerequisites; the reason and the skipped prerequisites
 * are recorded. Appointments needs a real interview, so a skip there opens the
 * interview booking with the Job Ready override (`onBookInterview`).
 */
export function ClientWorkflowControl({ clientId, status, management, compact=false, onBookInterview }: { clientId:string; status:string; management:boolean; compact?:boolean; onBookInterview?:(reason:string)=>void }) {
  const { t, dir, language } = useStaffLanguage();
  const [open,setOpen]=useState(false);
  const [target,setTarget]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [failed,setFailed]=useState(false);
  const [skip,setSkip]=useState(false);
  const changed=useTargetedMutationBatch();
  if (!management) return null;
  const minReason=skip?OVERRIDE_REASON_MIN:3;
  const skipBlocked=skip&&(target==="completed"||target==="reconcile");
  async function submit() {
    if (!target || reason.trim().length<minReason || busy || skipBlocked) return;
    if (skip && target==="appointments") {
      if (onBookInterview) onBookInterview(reason.trim());
      else {setFailed(true);setMessage(t("Open the client file to book the interview with the override", "افتح ملف العميل لحجز المقابلة مع التجاوز"));}
      return;
    }
    setBusy(true);setMessage("");setFailed(false);
    try {
      const body=target==="completed"||target==="reconcile"
        ? {operation:"reconcile_workflow",client_id:clientId,reason:reason.trim(),complete_only:target==="completed"}
        : {operation:"bulk_assign",client_ids:[clientId],target_stage:target,reason:reason.trim(),...(skip?{override:true}:{})};
      const response=await fetch("/api/staff/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
      const data=await response.json().catch(()=>null);
      if (!response.ok || !data?.ok) throw new Error(data?.error?.message??t("Workflow update failed", "تعذر تحديث المسار"));
      setMessage(data.overridden?t("Moved with an authorized skip; the reason is recorded", "نُقل الملف بتجاوز معتمد وسُجّل السبب"):data.changed?t("Workflow updated and recorded", "تم تحديث المسار وتسجيل العملية"):t("Checked; no further transition is eligible", "تم التحقق؛ لم تستوفِ الحالة انتقالًا إضافيًا"));
      changed("bulk_assign",[clientId]);
    } catch(error) {setFailed(true);setMessage(error instanceof Error?error.message:t("Connection failed", "تعذر الاتصال"));}
    finally {setBusy(false);}
  }
  return <div className="cg-workflow-control" dir={dir}>
    <button type="button" className="cg-command-button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>↗ {compact?t("Workflow routing", "توجيه المسار"):t("Workflow & manual routing", "المسار والنقل اليدوي")} <span className="text-xs text-cyan-200" dir="ltr">{g3StageForStatus(status)}</span></button>
    {open&&<div className={compact?"mt-3 grid gap-3":"mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto]"}>
      <label className="text-xs text-slate-300">{t("Destination", "الوجهة")}<RoyalSelect inlineOptions={compact} aria-label={t("Workflow destination", "وجهة المسار")} className="input mt-1 w-full" value={target} onChange={event=>setTarget(event.target.value)}><RoyalOption value="" labelAr="اختر الوجهة">Choose destination</RoyalOption><RoyalOption value="reconcile" labelAr="إعادة مزامنة المسار">Reconcile workflow</RoyalOption>{CLIENT_STAGES.map(stage=><RoyalOption key={stage.id} value={stage.id}>{language === "ar" ? stage.labelAr : stage.label}</RoyalOption>)}</RoyalSelect></label>
      <label className="text-xs text-slate-300">{t("Routing reason", "سبب النقل")}<input aria-label={t("Workflow move reason", "سبب نقل الملف")} className="input mt-1 w-full" value={reason} onChange={event=>setReason(event.target.value)} maxLength={500} placeholder={t("A clear reason recorded in the file history", "سبب واضح يحفظ في سجل الملف")} dir="auto"/></label>
      <button type="button" className="ops-primary-button self-end" onClick={submit} disabled={busy||!target||reason.trim().length<minReason||skipBlocked}>{busy?t("Checking…", "جارٍ التحقق…"):skip?(target==="appointments"?t("Book interview with override", "احجز المقابلة مع التجاوز"):t("Skip & apply", "تجاوز ونفّذ")):t("Check & apply", "تحقق ونفّذ")}</button>
      <fieldset className={compact?"cg-workflow-mode":"cg-workflow-mode sm:col-span-3"}>
        <legend className="sr-only">{t("Routing mode", "طريقة النقل")}</legend>
        <label><input type="radio" name={`workflow-mode-${clientId}`} checked={!skip} onChange={()=>setSkip(false)}/> {t("Canonical path · checks prerequisites", "المسار الأصلي · يتحقق من المتطلبات")}</label>
        <label><input type="radio" name={`workflow-mode-${clientId}`} checked={skip} onChange={()=>setSkip(true)}/> {t("Authorized skip · manager decision, recorded", "تجاوز معتمد · قرار إداري موثّق")}</label>
      </fieldset>
      <p className={compact?"text-xs text-slate-400":"text-xs text-slate-400 sm:col-span-3"}>{skip
        ? (skipBlocked
          ? t("Closing or reconciling a file cannot be skipped: it depends on a settled ledger and recorded evidence.", "لا يمكن تجاوز إغلاق الملف أو مزامنته: يعتمد على سداد الدفتر والأدلة المسجلة.")
          : t(`Moves this file without its prerequisites. Your name, the reason (at least ${OVERRIDE_REASON_MIN} characters) and the previous and new stage are recorded. Appointments opens the interview booking with the Job Ready override.`, `ينقل الملف دون متطلباته. يُسجَّل اسمك والسبب (${OVERRIDE_REASON_MIN} أحرف على الأقل) والمرحلة السابقة والجديدة. خيار المقابلات يفتح حجز المقابلة مع تجاوز الجاهزية.`))
        : t("The employee and reason are recorded. Closing a file requires a settled ledger and completed post-interview items.", "يُحفظ الموظف والسبب. إغلاق الملف يتطلب سداد الدفتر واكتمال بنود ما بعد المقابلة.")}</p>
    </div>}
    {message&&<p role={failed?"alert":"status"} className={`mt-2 text-sm ${failed?"text-rose-300":"text-teal-200"}`}>{message}</p>}
  </div>;
}
