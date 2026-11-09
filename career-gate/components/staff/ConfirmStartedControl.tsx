"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RoyalOption, RoyalSelect } from "@/components/forms/RoyalSelect";
import { GlassReviewDialog } from "@/components/staff/smart/GlassReviewDialog";
import { useStaff } from "@/components/staff/StaffContext";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { useTargetedMutation } from "@/components/staff/realtime/useTargetedMutation";
import { useToast } from "@/components/ui/Toast";
import { todayInOffice } from "@/lib/format";
import { WORKSITE_OPTIONS } from "@/lib/worksite-options";
import "./employment-confirmation.css";

type Intent = { signature: string; operationId: string };
type Draft = { date: string; site: string; intent: Intent | null };

/** Scheduled dates are deliberately not pre-filled as proof of actual work. */
export function ConfirmStartedControl({ clientId, updatedAt, siteCode, disabled=false }: {
  clientId: string; updatedAt?: string; siteCode?: string | null; disabled?: boolean;
}) {
  const { me } = useStaff();
  const { t } = useStaffLanguage();
  const toast = useToast();
  const router = useRouter();
  const onMutated = useTargetedMutation();
  const [open,setOpen] = useState(false);
  const [date,setDate] = useState("");
  const [site,setSite] = useState(siteCode ?? "");
  const [attested,setAttested] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const submitting = useRef(false);
  const intent = useRef<Intent | null>(null);
  const key = `career-gate:employment-draft:${me.id}:${clientId}`;
  const store = (next: Draft) => { try { sessionStorage.setItem(key,JSON.stringify(next)); } catch { /* Draft remains editable in memory. */ } };
  function show() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as Draft | null;
      if (saved && typeof saved.date === "string" && typeof saved.site === "string") {
        setDate(saved.date);setSite(saved.site);
        intent.current = saved.intent && typeof saved.intent.signature === "string" && typeof saved.intent.operationId === "string" ? saved.intent : null;
      }
    } catch { /* Ignore malformed local drafts. */ }
    setAttested(false);setError("");setOpen(true);
  }
  async function run() {
    if (!updatedAt || !date || !site || !attested || submitting.current) return;
    if (date > todayInOffice()) { setError(t("Actual start cannot be in the future.","لا يمكن أن تكون المباشرة الفعلية بتاريخ مستقبلي."));return; }
    const command = { client_id:clientId, actual_start_date:date, site_code:site, expected_updated_at:updatedAt, confirmation:true };
    const signature = JSON.stringify(command);
    const operationId = intent.current?.signature === signature ? intent.current.operationId : crypto.randomUUID();
    intent.current = {signature,operationId};store({date,site,intent:intent.current});
    submitting.current=true;setBusy(true);setError("");
    try {
      const response = await fetch("/api/staff/employment-confirmations", { method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...command,operation_id:operationId}), signal:AbortSignal.timeout(25000) });
      const result = await response.json().catch(()=>null);
      if (!response.ok || !result?.ok) {
        if (response.status >= 400 && response.status < 500 && ![408,429].includes(response.status)) { intent.current=null;store({date,site,intent:null}); }
        throw new Error(result?.error?.message ?? t("The confirmation could not be saved.","تعذر حفظ تأكيد المباشرة."));
      }
      try { sessionStorage.removeItem(key); } catch { /* Saved server confirmation is authoritative. */ }
      intent.current=null;setOpen(false);setAttested(false);
      window.dispatchEvent(new CustomEvent("career-gate:employment-confirmed", {detail:{clientId,confirmation:result.confirmation,clientVersion:result.client_version}}));
      onMutated("confirm_started",clientId);
      toast("success",t("Actual start confirmed and the original file saved to the registry.","تم تأكيد المباشرة وحفظ الملف الأصلي في السجل النهائي."));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Connection interrupted. Retry to verify the same operation.","انقطع الاتصال. أعد المحاولة للتحقق من العملية نفسها.")); }
    finally { submitting.current=false;setBusy(false); }
  }
  return <>
    <button type="button" className="cg-command-button employment-confirm-button" disabled={disabled || !updatedAt} onClick={show}>{t("Confirm actual start","تأكيد المباشرة الفعلية")}</button>
    {open && <GlassReviewDialog title={t("Confirm actual start","تأكيد المباشرة الفعلية")} closeLabel={t("Close actual start confirmation","إغلاق تأكيد المباشرة")} onClose={()=>{if(!submitting.current)setOpen(false);}}>
      <form className="employment-confirmation-form" data-testid="employment-confirmation-form" onSubmit={event=>{event.preventDefault();void run();}}>
        <p>{t("Record work that actually began. Scheduled start dates remain separate.","سجّل المباشرة التي حدثت فعليًا. يبقى موعد البداية المخطط منفصلًا عنها.")}</p>
        <label>{t("Actual start date","تاريخ المباشرة الفعلية")}<input aria-label={t("Actual start date","تاريخ المباشرة الفعلية")} className="input" type="date" required max={todayInOffice()} value={date} disabled={busy} onChange={event=>{setDate(event.target.value);store({date:event.target.value,site,intent:intent.current});}}/></label>
        <label>{t("Confirmed worksite","موقع العمل المؤكد")}<RoyalSelect aria-label={t("Confirmed worksite","موقع العمل المؤكد")} value={site} disabled={busy} onChange={event=>{setSite(event.target.value);store({date,site:event.target.value,intent:intent.current});}} className="input">
          <RoyalOption value="">{t("Choose the actual worksite","اختر موقع المباشرة الفعلي")}</RoyalOption>
          {WORKSITE_OPTIONS.map(option=><RoyalOption key={option.code} value={option.code}>{option.name} · {option.code}</RoyalOption>)}
        </RoyalSelect></label>
        <label className="employment-attestation"><input type="checkbox" required checked={attested} disabled={busy} onChange={event=>setAttested(event.target.checked)}/><span>{t("I confirm the client actually started work","أؤكد أن العميل باشر العمل فعليًا")}</span></label>
        {error && <div className="registry-error" role="alert"><p>{error}</p><button type="button" className="cg-command-button" disabled={busy} onClick={()=>router.refresh()}>{t("Refresh record","تحديث الملف")}</button></div>}
        <button type="submit" className="ops-primary-button" disabled={busy || !attested || !date || !site}>{busy ? t("Saving…","جارٍ الحفظ…") : t("Confirm actual start & save record","تأكيد المباشرة وحفظ السجل النهائي")}</button>
      </form>
    </GlassReviewDialog>}
  </>;
}
