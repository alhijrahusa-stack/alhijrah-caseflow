import Link from "next/link";
import { redirect } from "next/navigation";
import { ClientCommandTable } from "@/components/staff/ClientCommandTable";
import { ClientStageDock } from "@/components/staff/ClientStageDock";
import { ClientArchiveCards } from "@/components/staff/ClientArchiveCards";
import { ClientLocationShiftCard } from "@/components/staff/ClientLocationShiftCard";
import { getStaffSession, withStaff } from "@/lib/auth";
import { WORKFLOW_DESTINATIONS } from "@/lib/workflow-registry";
import { operationalClientList, type ClientView } from "@/lib/operational-clients";
import { CURRENT_EMPLOYMENT_CONFIRMATION_SQL } from "@/lib/employment-registry-read";
import { todayInOffice } from "@/lib/format";
import { staffDirectory } from "@/lib/queries";
import { ClientRegistryToolbar, RegistryEmptyState, RegistryPaginationSummary } from "@/components/staff/ClientRegistryToolbar";
import { StaffText } from "@/components/staff/StaffLanguage";
import { parseRegistryFilters, REGISTRY_PAGE_SIZE, registryFilterValues, registryPageNumbers } from "@/lib/registry-filters";
import "@/app/staff/client-registry.css";

const PAGE_SIZE=REGISTRY_PAGE_SIZE;

export default async function ClientsPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  const management=session.staff.role!=="staff";
  const sp=await searchParams;
  const params=new URLSearchParams(Object.entries(sp).filter((entry):entry is [string,string]=>entry[1]!==undefined));
  const parsed=parseRegistryFilters(params,management);
  const {view,page:requestedPage,status,q,stage,attention,assigned,completedThisMonth,urgent,group,year,confirmation,sort}=parsed;
  const [{rows,total,page},staffRows,occupancy,yearRows]=await Promise.all([
    operationalClientList(session,view,requestedPage,PAGE_SIZE,{q,status,stage,attention,completedThisMonth,assigned,urgent,group,year,confirmation,sort}),
    staffDirectory(session),
    withStaff(session,tx=>tx`select operational_location,count(*)::int total,
      count(*) filter(where is_urgent and current_status not in ('completed','cancelled'))::int urgent
      from clients where deleted_at is null group by operational_location`),
    view==="completed" ? withStaff(session,tx=>tx`select distinct extract(year from employment.actual_start_date)::int employment_year
      from clients c left join lateral (${tx.unsafe(CURRENT_EMPLOYMENT_CONFIRMATION_SQL)}) employment on true
      where c.deleted_at is null and c.operational_location='completed' and employment.id is not null order by employment_year desc`) : [],
  ]);
  const staffRoster=staffRows.filter(member=>member.active).sort((a,b)=>a.display_name.localeCompare(b.display_name)).map(member=>({id:member.id,display_name:member.display_name}));
  const stageCounts=Object.fromEntries(WORKFLOW_DESTINATIONS.map(station=>[station.id,Number(occupancy.find(row=>row.operational_location===station.id)?.total??0)]));
  const urgentCounts=Object.fromEntries(WORKFLOW_DESTINATIONS.map(station=>[station.id,Number(occupancy.find(row=>row.operational_location===station.id)?.urgent??0)]));
  const priorityTotal=occupancy.reduce((sum,row)=>sum+Number(row.urgent??0),0);
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const officeYear=Number(todayInOffice().slice(0,4));
  const years=[...new Set([officeYear,...yearRows.map(row=>Number(row.employment_year)),...(year?[year]:[])])].sort((a,b)=>b-a);
  const canonical=registryFilterValues(params,management);
  const href=(nextView:ClientView,nextPage=1,retainStage=false)=>{
    const next=new URLSearchParams(canonical as Record<string,string>);
    next.set("view",nextView);next.set("page",String(nextPage));
    if(!retainStage){next.delete("stage");next.delete("group");next.delete("urgent");if(nextView!=="completed"){next.delete("year");next.delete("confirmation");next.delete("sort");}}
    return `/staff/clients?${next}`;
  };
  const title=view==="completed"?"Confirmed Employment & Records":urgent?"Urgent Priority":"Clients Registry";
  const titleAr=view==="completed"?"سجل المباشرة والملفات":urgent?"ملفات الأولوية":"سجل العملاء";
  const stageName=WORKFLOW_DESTINATIONS.find(destination=>destination.id===stage);
  const yearLink=new URLSearchParams(canonical as Record<string,string>);yearLink.set("view","completed");yearLink.set("year",String(year??officeYear));yearLink.delete("confirmation");yearLink.delete("page");

  return <div className="ops-page registry-page registry-clean-page space-y-4" data-operational-section={urgent?"urgent":stage??group??view}>
    <header className="ops-hero registry-short-header"><div><h1 className="tracking-tight"><StaffText en={title} ar={titleAr}/></h1>
      <div className="registry-title-context"><span className="registry-count-tag"><b>{total.toLocaleString("en-US")}</b> <StaffText en="records" ar="ملفًا"/></span>
        {stageName&&view!=="completed"&&<span className="registry-stage-tag"><StaffText en={stageName.label} ar={stageName.labelAr}/></span>}
        {group==="paperwork"&&<span className="registry-stage-tag"><StaffText en="Payment & Paperwork" ar="الدفع واستكمال الوثائق"/></span>}
        {urgent&&<span className="registry-stage-tag"><StaffText en={`${priorityTotal} urgent across permitted sections`} ar={`${priorityTotal} ملفًا عاجلًا في الأقسام المسموح بها`}/></span>}
        {view==="completed"&&<Link href={`/staff/clients?${yearLink}`} prefetch={false} className="registry-year-badge" data-active={!!year} aria-label={`Show actual starts in ${year??officeYear}`}>{year??officeYear}</Link>}
      </div>
    </div></header>

    {view!=="completed"&&<ClientStageDock stage={stage} group={group} counts={stageCounts} urgentCounts={urgentCounts}/>}
    <ClientRegistryToolbar management={management} staff={staffRoster as unknown as {id:string;display_name:string}[]} employmentYears={years} views={[
      {href:href("active"),en:"Active clients",ar:"العملاء النشطون",active:view==="active"},
      {href:href("completed"),en:"Confirmed Employment & Records",ar:"سجل المباشرة والملفات",active:view==="completed"},
      {href:href("all"),en:"All Records",ar:"جميع السجلات",active:view==="all"},
    ]}/>
    {urgent&&<p className="registry-context-note" role="status"><StaffText en="Priority changes do not move files. Manager-held files remain held until a decision." ar="الأولوية لا تنقل الملفات. الملفات المحجوزة لدى المدير تبقى لديه حتى حسم المراجعة."/></p>}
    {management&&view==="active"&&!urgent&&(!stage||stage==="job_ready")&&!group&&<ClientLocationShiftCard clients={rows.map(c=>({id:c.id,full_name:c.full_name,ref:c.ref}))}/>}
    {stage==="account_setup"&&management&&<Link prefetch={false} href="/staff/gate-job-account" className="cg-command-button inline-flex w-fit"><StaffText en="Open Amazon Account Setup ↗" ar="فتح تجهيز حساب Amazon ↗"/></Link>}
    {stage==="payment_required"&&management&&<Link prefetch={false} href="/staff/accounting" className="cg-command-button inline-flex w-fit"><StaffText en="Open verified payment ledger ↗" ar="فتح سجل المدفوعات الموثق ↗"/></Link>}
    {view==="completed"&&<p className="registry-context-note"><StaffText en="Existing records remain available until reviewed. Scheduled dates do not confirm actual employment." ar="تبقى السجلات الحالية متاحة للمراجعة. موعد البداية المخطط لا يثبت المباشرة الفعلية."/></p>}
    {assigned==="none"&&<p role="status" className="registry-context-note"><StaffText en="Unassigned records · all matching server-side pages." ar="ملفات غير معيّنة · جميع النتائج المطابقة ضمن صفحات النظام."/></p>}
    {completedThisMonth&&<p role="status" className="registry-context-note"><StaffText en="Files with a recorded completion this month; actual employment confirmation remains separate." ar="ملفات سُجّل إكمالها هذا الشهر؛ يبقى تأكيد المباشرة الفعلية مستقلًا."/></p>}
    {attention==="documents"&&<p role="status" className="registry-context-note"><StaffText en="Documents needing action" ar="وثائق تحتاج إجراء"/></p>}

    {view!=="completed"&&rows.length>0&&<ClientCommandTable clients={rows.map(c=>({id:c.id,ref:c.ref,full_name:c.full_name,phone:c.phone,email:c.email,city:c.city,current_status:c.current_status,next_step:c.next_step,amazon_account_ready:c.amazon_account_ready,payment_status:c.payment_status,assigned_staff:c.assigned_staff,assigned_name:c.assigned_name,created_at:c.created_at,updated_at:c.updated_at,site_name:c.site_name,shift_name:c.shift_name,is_urgent:c.is_urgent,manager_review_id:c.manager_review_id,operational_location:c.operational_location,review_stamp:c.review_stamp}))} staff={staffRoster as unknown as {id:string;display_name:string}[]} management={management} query={q??""}/>}
    {rows.length===0&&<RegistryEmptyState completed={view==="completed"}/>}
    {view==="completed"&&rows.length>0&&<ClientArchiveCards clients={rows}/>}

    <nav className="registry-pagination" aria-label="Pagination"><div><RegistryPaginationSummary total={total} page={page} pages={pages}/><small><StaffText en="Showing" ar="عرض"/> {total?((page-1)*PAGE_SIZE)+1:0}–{Math.min(page*PAGE_SIZE,total)} <StaffText en="of" ar="من"/> {total}</small></div><div className="registry-pages">{page>1?<Link prefetch={false} href={href(view,page-1,true)} className="registry-page-prev"><StaffText en="Previous" ar="السابق"/></Link>:<span className="registry-page-disabled"><StaffText en="Previous" ar="السابق"/></span>}{registryPageNumbers(page,pages).map((n,index,numbers)=><span key={n} className="registry-page-number">{index>0&&n>numbers[index-1]+1&&<span className="registry-page-gap">…</span>}<Link prefetch={false} href={href(view,n,true)} aria-label={`Page ${n}`} aria-current={n===page?"page":undefined}>{n}</Link></span>)}{page<pages?<Link prefetch={false} href={href(view,page+1,true)} className="registry-page-next"><StaffText en="Next" ar="التالي"/></Link>:<span className="registry-page-disabled"><StaffText en="Next" ar="التالي"/></span>}</div></nav>
  </div>;
}
