"use client";

import { ActionButton } from "@/components/ui/ActionButton";

import Link from "next/link";
import { Client360Drawer, preloadClient360 } from "@/components/staff/Client360Drawer";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { dateOnly, dateTime } from "@/lib/format";
import { ReviewStamp } from "@/components/staff/ReviewStamp";
import { ClientWorkflowControl } from "@/components/staff/ClientWorkflowControl";
import { ConfirmStartedControl } from "@/components/staff/ConfirmStartedControl";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { useStaff } from "@/components/staff/StaffContext";
import { SoftDelete } from "@/components/staff/SoftDelete";
import type { OperationalClientRow } from "@/lib/operational-clients";

type SavedConfirmation = {id:string;actual_start_date:string;site_code:string;site_name:string;site_address:string|null;job_title?:string|null;shift_name?:string|null;shift_days?:string|null;shift_hours?:string|null;confirmed_by_name:string;confirmed_at:string};
type Patch = {beforeVersion:string;clientVersion:string;confirmation:SavedConfirmation};

const EmploymentRegistryCard=memo(function EmploymentRegistryCard({record,isManager,onOpen}:{record:OperationalClientRow;isManager:boolean;onOpen:(record:OperationalClientRow)=>void}) {
  const {t}=useStaffLanguage();
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
            <ActionButton type="button" onClick={()=>onOpen(record)} onPointerEnter={preloadClient360} onFocus={preloadClient360} className="cg-command-button">{t("Quick view · Client 360","معاينة سريعة · Client 360")}</ActionButton>
            {!confirmed&&<ConfirmStartedControl clientId={record.id} updatedAt={record.updated_at} siteCode={record.site_code} disabled={!!record.manager_review_id}/> }
            {isManager&&!record.manager_review_id&&<div className="employment-record-delete"><SoftDelete clientId={record.id} compact stayInView actionLabel={t("Move to deleted records","نقل إلى المحذوفات")}/></div>}
          </div>
          {!record.manager_review_id&&<ClientWorkflowControl clientId={record.id} status={record.current_status} compact/>}
        </article>;
});

export function ClientArchiveCards({clients}:{clients:OperationalClientRow[]}) {
  const {isManager}=useStaff();
  const [client,setClient]=useState<OperationalClientRow|null>(null);
  const [patches,setPatches]=useState<Record<string,Patch>>({});
  const close=useCallback(()=>setClient(null),[]);
  const open=useCallback((record:OperationalClientRow)=>setClient(record),[]);
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
  const records=useMemo(()=>clients.map(row=>{
    const patch=patches[row.id];
    if(!patch || (row.updated_at!==patch.beforeVersion && row.updated_at!==patch.clientVersion))return row;
    return {...row,updated_at:patch.clientVersion,employment_confirmation_id:patch.confirmation.id,actual_start_date:patch.confirmation.actual_start_date,
      employment_site_code:patch.confirmation.site_code,employment_site_name:patch.confirmation.site_name,employment_site_address:patch.confirmation.site_address,
      employment_job_title:patch.confirmation.job_title,employment_shift_name:patch.confirmation.shift_name,employment_shift_days:patch.confirmation.shift_days,employment_shift_hours:patch.confirmation.shift_hours,
      employment_confirmed_by_name:patch.confirmation.confirmed_by_name,employment_confirmed_at:patch.confirmation.confirmed_at};
  }),[clients,patches]);
  return <>
    <div className="employment-registry-cards" data-testid="client-master-registry-cards">
      {records.map(record=><EmploymentRegistryCard key={record.id} record={record} isManager={isManager} onOpen={open}/>)}
    </div>
    {client&&<Client360Drawer key={client.id} client={client} onClose={close}/>}
  </>;
}
