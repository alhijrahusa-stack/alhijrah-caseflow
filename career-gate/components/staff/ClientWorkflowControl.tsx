"use client";

import { useRef, useState } from "react";
import { RoyalSelect, RoyalOption } from "@/components/forms/RoyalSelect";
import { CLIENT_STAGES } from "@/lib/client-lifecycle-filters";
import { g3StageForStatus } from "@/lib/g3-stages";
import { useTargetedMutationBatch } from "@/components/staff/realtime/useTargetedMutation";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";

export function ClientWorkflowControl({ clientId, status, compact=false }: { clientId:string; status:string; compact?:boolean }) {
  const { t, dir, language } = useStaffLanguage();
  const [open,setOpen]=useState(!compact);
  const [target,setTarget]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const submitting=useRef(false);
  const [message,setMessage]=useState("");
  const [failed,setFailed]=useState(false);
  const changed=useTargetedMutationBatch();
  async function submit() {
    if (!target || submitting.current) return;
    submitting.current=true;setBusy(true);setMessage("");setFailed(false);
    try {
      const response=await fetch("/api/staff/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation:"bulk_assign",client_ids:[clientId],target_stage:target,reason:reason.trim()}),signal:AbortSignal.timeout(20000)});
      const data=await response.json().catch(()=>null);
      if (!response.ok || !data?.ok) throw new Error(data?.error?.message??t("Workflow update failed", "تعذر تحديث المسار"));
      const stage=CLIENT_STAGES.find(item=>item.id===target);
      setMessage(data.changed?t(`Moved to ${stage?.label}`, `تم النقل إلى ${stage?.labelAr}`):t("Already in the selected stage", "الملف في المرحلة المختارة بالفعل"));
      setReason("");changed("bulk_assign",[clientId]);
    } catch(error) {setFailed(true);setMessage(error instanceof Error?error.message:t("Connection failed", "تعذر الاتصال"));}
    finally {submitting.current=false;setBusy(false);}
  }
  return <div className="cg-workflow-control" dir={dir}>
    <button type="button" className="cg-command-button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>↗ {t("Workflow routing", "توجيه المسار")} <span className="text-xs text-cyan-200" dir="ltr">{g3StageForStatus(status)}</span></button>
    {open&&<div className={compact?"mt-3 grid gap-3":"mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto]"}>
      <label className="text-xs text-slate-300">{t("Destination", "الوجهة")}<RoyalSelect inlineOptions={compact} aria-label={t("Workflow destination", "وجهة المسار")} className="input mt-1 w-full" value={target} disabled={busy} onChange={event=>{setTarget(event.target.value);setMessage("");}}><RoyalOption value="" labelAr="اختر الوجهة">Choose destination</RoyalOption>{CLIENT_STAGES.map(stage=><RoyalOption key={stage.id} value={stage.id}>{language === "ar" ? stage.labelAr : stage.label}</RoyalOption>)}</RoyalSelect></label>
      <label className="text-xs text-slate-300">{t("Note (optional)", "ملاحظة (اختيارية)")}<input aria-label={t("Workflow note (optional)", "ملاحظة النقل (اختيارية)")} className="input mt-1 w-full" value={reason} disabled={busy} onChange={event=>setReason(event.target.value)} maxLength={500} dir="auto"/></label>
      <button type="button" className="ops-primary-button self-end" onClick={submit} disabled={busy||!target}>{busy?t("Moving…", "جارٍ النقل…"):t("Move now ↗", "انقل الآن ↗")}</button>
      <p className={compact?"text-xs text-slate-400":"text-xs text-slate-400 sm:col-span-3"}>{t("Choose any stage and move directly. Your action is recorded automatically.", "اختر أي مرحلة وانقل مباشرة. تُسجَّل العملية تلقائيًا.")}</p>
    </div>}
    {message&&<p role={failed?"alert":"status"} className={`mt-2 text-sm ${failed?"text-rose-300":"text-teal-200"}`}>{message}</p>}
  </div>;
}
