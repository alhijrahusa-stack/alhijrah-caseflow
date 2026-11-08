"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { dateOnly, dateTime } from "@/lib/format";
import { ReviewStamp } from "@/components/staff/ReviewStamp";
import { ClientWorkflowControl } from "@/components/staff/ClientWorkflowControl";
import { ConfirmStartedControl } from "@/components/staff/ConfirmStartedControl";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { useStaff } from "@/components/staff/StaffContext";
import { SoftDelete } from "@/components/staff/SoftDelete";
import type { OperationalClientRow } from "@/lib/operational-clients";

const Client360Drawer=dynamic(()=>import("@/components/staff/Client360Drawer").then(module=>module.Client360Drawer),{
  ssr:false,loading:()=> <p role="status" className="text-sm text-slate-300">Loading Client 360…</p>,
});
type SavedConfirmation = {id:string;actual_start_date:string;site_code:string;site_name:string;site_address:string|null;job_title?:string|null;shift_name?:string|null;shift_days?:string|null;shift_hours?:string|null;confirmed_by_name:string;confirmed_at:string};
type Patch = {beforeVersion:string;clientVersion:string;confirmation:SavedConfirmation};

export function ClientArchiveCards({clients}:{clients:OperationalClientRow[]}) {
  const {t}=useStaffLanguage();
  const {isManager}=useStaff();
  const [client,setClient]=useState<OperationalClientRow|null>(null);
  const [patches,setPatches]=useState<Record<string,Patch>>({});
  const close=useCallback(()=>setClient(null),[]);
  useEffect(()=>{
    const updated=(event:Event)=>{
      const detail=(event as CustomEvent<{clientId?:string;clientVersion?:string;confirmation?:SavedConfirmation}>).detail;
      const row=clients.find(item=>item.id===detail?.clientId);
      if(!row || !detail?.confirmation?.id || !detail.clientVersion)return;
      setPatches(current=>({...current,[row.id]:{beforeVersion:row.updated_at,clientVersion:detail.clientVersion!,confirmation:detail.confirmation!}}));
    };
    window.addEventListener("career-gate:employment-confirmed",updated);
    return()=>window.removeEventListener("career-gate:employment-confirmed",updated);
  },[clients]);
  const records=clients.map(row=>{
    const patch=patches[row.id];
    if(!patch || (row.updated_at!==patch.beforeVersion && row.updated_at!==patch.clientVersion))return row;
    return {...row,updated_at:patch.clientVersion,employment_confirmation_id:patch.confirmation.id,actual_start_date:patch.confirmation.actual_start_date,
      employment_site_code:patch.confirmation.site_code,employment_site_name:patch.confirmation.site_name,employment_site_address:patch.confirmation.site_address,
      employment_job_title:patch.confirmation.job_title,employment_shift_name:patch.confirmation.shift_name,employment_shift_days:patch.confirmation.shift_days,employment_shift_hours:patch.confirmation.shift_hours,
      employment_confirmed_by_name:patch.confirmation.confirmed_by_name,employment_confirmed_at:patch.confirmation.confirmed_at};
  });
  return <>
    <div className="employment-registry-cards" data-testid="client-master-registry-cards">
      {records.map(record=>{
        const confirmed=Boolean(record.employment_confirmation_id && record.actual_start_date);
        return <article className="cg-registry-card employment-registry-card" key={record.id} data-client-id={record.id} data-confirmed={confirmed}>
          <header className="employment-record-identity">
            <span aria-hidden="true" className="registry-client-avatar">{record.full_name.trim().split(/\s+/).slice(0,2).map(part=>part.charAt(0)).join("").toUpperCase()}</span>
            <div><Link href={`/staff/client/${record.id}`} prefetch={false} className="registry-name-link"><bdi>{record.full_name}</bdi></Link><Link href={`/staff/client/${record.id}`} prefetch={false} className="registry-ref-link">{record.ref}</Link><p><bdi dir="ltr">{record.phone}</bdi>{record.city?` · ${record.city}`:""}</p></div>
            <span data-testid="employment-confirmation-status" className={`employment-confirmation-badge ${confirmed?"is-confirmed":"is-unconfirmed"}`}>{confirmed?t("Actual start confirmed","المباشرة الفعلية مؤكدة"):t("Actual start not confirmed","تأكيد المباشرة غير مسجل")}</span>
          </header>
          <ReviewStamp stamp={record.review_stamp} pending={!!record.manager_review_id}/>
          <dl className="employment-record-facts">
            <div><dt>{t("Actual start","المباشرة الفعلية")}</dt><dd data-testid="actual-start-date">{confirmed?dateOnly(record.actual_start_date):t("Not confirmed","غير مؤكدة")}</dd></div>
            <div><dt>{t("Scheduled start","موعد البداية المخطط")}</dt><dd data-testid="completed-start-date">{record.start_date?dateOnly(record.start_date):t("Not recorded","غير مسجل")}</dd></div>
            <div><dt>{t("Worksite","موقع العمل")}</dt><dd>{confirmed?record.employment_site_name:record.site_name??"—"}</dd></div>
            <div><dt>{t("Assigned specialist","الموظف المختص")}</dt><dd><bdi>{record.assigned_name??t("Unassigned","غير معيّن")}</bdi></dd></div>
            {confirmed&&<><div><dt>{t("Confirmed by","أكد المباشرة")}</dt><dd><bdi>{record.employment_confirmed_by_name??"—"}</bdi></dd></div><div><dt>{t("Confirmation recorded","وقت توثيق التأكيد")}</dt><dd>{dateTime(record.employment_confirmed_at)}</dd></div></>}
          </dl>
          {confirmed&&record.employment_site_address&&<p className="employment-record-address">{record.employment_site_address}</p>}
          <details className="employment-record-secondary"><summary>{t("Placement, payment & record details","تفاصيل الوظيفة والدفع والسجل")}</summary><dl className="employment-record-facts">
            <div><dt>{confirmed?t("Confirmed job","الوظيفة الموثقة"):t("Planned job","الوظيفة المخططة")}</dt><dd>{(confirmed?record.employment_job_title:record.job_title)??t("Not recorded","غير مسجل")}</dd></div>
            <div><dt>{confirmed?t("Confirmed shift","الشفت الموثق"):t("Planned shift","الشفت المخطط")}</dt><dd>{(confirmed?record.employment_shift_name:record.shift_name)??t("Not recorded","غير مسجل")}</dd></div>
            {confirmed&&<><div><dt>{t("Confirmed shift days","أيام الشفت الموثقة")}</dt><dd>{record.employment_shift_days??t("Not recorded","غير مسجل")}</dd></div><div><dt>{t("Confirmed shift hours","ساعات الشفت الموثقة")}</dt><dd>{record.employment_shift_hours??t("Not recorded","غير مسجل")}</dd></div></>}
            <div><dt>{t("Payment status","حالة الدفع")}</dt><dd>{record.payment_status?.replaceAll("_"," ")??t("Not recorded","غير مسجل")}</dd></div>
            <div><dt>{t("Net service fee","صافي رسوم الخدمة")}</dt><dd>{record.fee_amount==null?"—":record.fee_amount.toLocaleString("en-US",{style:"currency",currency:"USD"})}</dd></div>
            <div><dt>{t("Received","تاريخ الاستلام")}</dt><dd>{dateTime(record.created_at)}</dd></div><div><dt>{t("Last updated","آخر تحديث")}</dt><dd>{dateTime(record.updated_at)}</dd></div>
          </dl></details>
          <div className="employment-record-actions">
            <Link href={`/staff/client/${record.id}`} prefetch={false} className="cg-command-button">{t("Open Client ↗","فتح الملف ↗")}</Link>
            <button type="button" onClick={()=>setClient(record)} className="cg-command-button">{t("Quick view · Client 360","معاينة سريعة · Client 360")}</button>
            {!confirmed&&<ConfirmStartedControl clientId={record.id} updatedAt={record.updated_at} siteCode={record.site_code} disabled={!!record.manager_review_id}/> }
            {isManager&&!record.manager_review_id&&<div className="employment-record-delete"><SoftDelete clientId={record.id} compact stayInView actionLabel={t("Move to deleted records","نقل إلى المحذوفات")}/></div>}
          </div>
          {!record.manager_review_id&&<ClientWorkflowControl clientId={record.id} status={record.current_status} compact/>}
        </article>;
      })}
    </div>
    {client&&<Client360Drawer key={client.id} client={{id:client.id,ref:client.ref,full_name:client.full_name}} onClose={close}/>}
  </>;
}
