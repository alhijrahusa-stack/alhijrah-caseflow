import Link from "next/link";
import { redirect } from "next/navigation";
import { ClientCommandTable } from "@/components/staff/ClientCommandTable";
import { ClientArchiveCards } from "@/components/staff/ClientArchiveCards";
import { ClientLocationShiftCard } from "@/components/staff/ClientLocationShiftCard";
import { ConfirmStartedControl } from "@/components/staff/ConfirmStartedControl";
import { SoftDelete } from "@/components/staff/SoftDelete";
import { StatusBadge } from "@/components/staff/StatusBadge";
import { getStaffSession, withStaff } from "@/lib/auth";
import { CLIENT_STAGES } from "@/lib/client-lifecycle-filters";
import { dateOnly, dateTime, formatPhone } from "@/lib/format";
import { operationalClientList, type ClientView } from "@/lib/operational-clients";
import { ClientRegistryToolbar, RegistryEmptyState, RegistryPaginationSummary } from "@/components/staff/ClientRegistryToolbar";
import { StaffText } from "@/components/staff/StaffLanguage";
import { parseRegistryFilters, REGISTRY_PAGE_SIZE, registryPageNumbers } from "@/lib/registry-filters";
import "@/app/staff/client-registry.css";

const PAGE_SIZE=REGISTRY_PAGE_SIZE;

export default async function ClientsPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  const management=session.staff.role!=="staff";
  const sp=await searchParams;
  const params = new URLSearchParams(Object.entries(sp).filter((entry):entry is [string,string]=>entry[1]!==undefined));
  const { view,page:requestedPage,status,q,stage,attention,assigned,completedThisMonth } = parseRegistryFilters(params,management);
  const [{rows,total,page,start,end,previous_cursor,next_cursor},staffRoster]=await Promise.all([
    operationalClientList(session,view,requestedPage,PAGE_SIZE,{q,status,stage,attention,completedThisMonth,assigned},sp.cursor),
    withStaff(session,tx=>tx`select id,display_name from staff where active order by display_name`),
  ]);
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const href=(nextView:ClientView,nextPage=1,retainStage=false,cursor?:string)=>`/staff/clients?view=${nextView}&page=${nextPage}${retainStage&&stage?`&stage=${stage}`:""}${q?`&q=${encodeURIComponent(q)}`:""}${status?`&status=${status}`:""}${attention?`&attention=${attention}`:""}${assigned?`&assigned=${assigned}`:""}${completedThisMonth?"&completed_this_month=1":""}${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`;

  return <div className="ops-page space-y-4">
    <header className="ops-hero"><div><p className="ops-kicker">CAREER GATE · MASTER REGISTRY</p><h1 className="tracking-tight"><StaffText en="Clients" ar="سجل العملاء"/></h1><p><StaffText en={`${total} file${total===1?"":"s"} in ${view} view · one original client record throughout the lifecycle`} ar={`${total} ملف في العرض الحالي · سجل عميل واحد طوال مسار العمل`}/></p></div>{management&&<div className="flex flex-wrap gap-2"><Link prefetch={false} href="/staff/archive" className="archive-link-button"><StaffText en="Archive" ar="الأرشيف"/></Link><Link prefetch={false} href="/staff/new-client" className="ops-primary-button"><StaffText en="+ New Client" ar="+ إضافة عميل"/></Link></div>}</header>

    {view==="active"&&(!stage||stage==="job_ready")&&<ClientLocationShiftCard clients={rows.map(c=>({id:c.id,full_name:c.full_name,ref:c.ref}))}/>}
    <nav aria-label="Operational client lifecycle stages" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {CLIENT_STAGES.map((station)=><Link prefetch={false} key={station.id} href={station.href} aria-current={stage===station.id?"page":undefined}
        className="cg-stage-tab registry-stage-tab">
        <span className="block text-sm font-semibold leading-5"><StaffText en={station.label} ar={station.labelAr}/></span>
      </Link>)}
    </nav>
    {stage==="account_setup"&&management&&<Link prefetch={false} href="/staff/gate-job-account" className="cg-command-button inline-flex w-fit"><StaffText en="Open Amazon Account Setup ↗" ar="فتح تجهيز حساب Amazon ↗"/></Link>}
    {stage==="payment_required"&&management&&<Link prefetch={false} href="/staff/accounting" className="cg-command-button inline-flex w-fit"><StaffText en="Open verified payment ledger ↗" ar="فتح سجل المدفوعات الموثق ↗"/></Link>}
    {stage==="paperwork_pending"&&<p role="status" className="text-sm text-emerald-200"><StaffText en="Post-interview preparation continues alongside payment. Fully paid, completed files move to Completed Files automatically." ar="تستمر إجراءات ما بعد المقابلة بالتوازي مع السداد. تُنقل الملفات المستوفية والمدفوعة إلى الملفات المكتملة تلقائياً."/></p>}

    {assigned==="none"&&<p role="status" className="text-sm text-amber-200"><StaffText en="Unassigned files · all matching active records, across server-side pages." ar="ملفات غير معيّنة · جميع السجلات النشطة المطابقة ضمن صفحات النظام."/></p>}
    {completedThisMonth&&<p role="status" className="text-sm text-amber-200"><StaffText en="Completed this month · showing currently completed client files with recorded completion this calendar month." ar="المكتمل هذا الشهر · ملفات العملاء المكتملة والمسجل إكمالها خلال الشهر الحالي."/></p>}
    {attention==="documents"&&<p role="status" className="text-sm text-amber-200"><StaffText en="Documents needing action · showing active client files with unresolved latest document reviews." ar="وثائق تحتاج إجراء · ملفات نشطة ما زالت أحدث مراجعات وثائقها غير محسومة."/></p>}

    <div className="ops-segmented max-w-full flex-wrap" role="tablist" aria-label="Client lifecycle views"><Link prefetch={false} href={href("active")} data-active={view==="active"}><StaffText en="Active Candidates" ar="العملاء النشطون"/></Link><Link prefetch={false} href={href("completed")} data-active={view==="completed"}><StaffText en="Completed Files" ar="الملفات المكتملة"/></Link><Link prefetch={false} href={href("all")} data-active={view==="all"}><StaffText en="All Records" ar="جميع السجلات"/></Link></div>

    <ClientRegistryToolbar management={management} staff={staffRoster as unknown as {id:string;display_name:string}[]}/>

    {view!=="completed"&&rows.length>0&&<ClientCommandTable clients={rows.map(c=>({id:c.id,ref:c.ref,full_name:c.full_name,phone:c.phone,email:c.email,city:c.city,current_status:c.current_status,next_step:c.next_step,amazon_account_ready:c.amazon_account_ready,payment_status:c.payment_status,assigned_staff:c.assigned_staff,assigned_name:c.assigned_name,created_at:c.created_at,updated_at:c.updated_at,site_name:c.site_name,shift_name:c.shift_name}))} staff={staffRoster as unknown as {id:string;display_name:string}[]} management={management} query={q??""}/>}
    {view!=="completed"&&rows.length===0&&<RegistryEmptyState completed={false}/>}
    {view==="completed"&&(rows.length===0?<RegistryEmptyState completed/>:<><div className="2xl:hidden"><ClientArchiveCards clients={rows}/></div><div className="ops-glass-card hidden overflow-x-auto rounded-[18px] border border-amber-200/15 bg-[#0b1c2f] p-0 2xl:block"><table className="table min-w-[1240px]"><thead><tr><th><StaffText en="Reference" ar="رقم الملف"/></th><th><StaffText en="Client" ar="العميل"/></th><th><StaffText en="Status" ar="الحالة"/></th>{view==="completed"&&<><th><StaffText en="Start Date" ar="تاريخ المباشرة"/></th><th><StaffText en="Start date record" ar="سجل تاريخ المباشرة"/></th><th><StaffText en="Site / Job / Shift" ar="الموقع / الوظيفة / الوردية"/></th><th><StaffText en="Payment" ar="السداد"/></th></>}<th><StaffText en="Handled By" ar="الموظف المختص"/></th><th><StaffText en="Received On" ar="تاريخ الاستلام"/></th><th><StaffText en="Last Updated" ar="آخر تحديث"/></th>{false&&<th>Next Action</th>}{false&&management&&<th>Confirm Started</th>}{management&&<th><StaffText en="Archive" ar="الأرشيف"/></th>}</tr></thead><tbody>{rows.map((c)=><tr key={c.id}><td className="whitespace-nowrap font-mono"><Link prefetch={false} href={`/staff/client/${c.id}`} className="text-cyan-300 hover:underline">{c.ref}</Link></td><td><Link prefetch={false} href={`/staff/client/${c.id}`} className="font-semibold text-slate-100 hover:text-cyan-200">{c.full_name}</Link><span className="mt-1 block text-sm text-slate-500">{formatPhone(c.phone)}{c.city?` · ${c.city}`:""}</span></td><td><StatusBadge status={c.current_status}/></td>{view==="completed"&&<><td className="whitespace-nowrap">{dateOnly(c.start_date)}</td><td>{c.start_date?<span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300"><StaffText en="START DATE RECORDED" ar="تاريخ المباشرة مسجّل"/></span>:<span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-xs font-semibold text-amber-300"><StaffText en="START DATE NOT RECORDED" ar="تاريخ المباشرة غير مسجّل"/></span>}</td><td><strong className="block text-slate-200">{c.site_name??c.site_code??"—"}</strong><span className="text-sm text-slate-500">{c.job_title??c.job_id??"No job"} · {c.shift_name??c.shift_code??"No shift"}</span></td><td><span className="uppercase text-sm text-slate-300">{c.payment_status??"—"}</span>{c.fee_amount!=null&&<span className="ml-2 tabular-nums text-slate-500">${c.fee_amount.toFixed(2)}</span>}</td></>}<td>{c.assigned_name??"Unassigned"}</td><td className="whitespace-nowrap text-slate-300">{dateTime(c.created_at)}</td><td className="whitespace-nowrap text-amber-200/90">{dateTime(c.updated_at)}</td>{false&&<td className="max-w-xs">{c.next_step}</td>}{false&&management&&<td>{c.current_status==="ready_for_first_day"?<ConfirmStartedControl clientId={c.id}/>:<span className="text-sm text-slate-600">—</span>}</td>}{management&&<td><SoftDelete clientId={c.id} compact/></td>}</tr>)}</tbody></table></div></>)}

    <nav className="registry-pagination" aria-label="Pagination"><div><RegistryPaginationSummary total={total} page={page} pages={pages}/><small><StaffText en="Showing" ar="عرض"/> {start}–{end} <StaffText en="of" ar="من"/> {total}</small></div><div className="registry-pages">{previous_cursor?<Link prefetch={false} href={href(view,Math.max(1,page-1),true,previous_cursor)} className="registry-page-prev"><StaffText en="Previous" ar="السابق"/></Link>:<span className="registry-page-disabled"><StaffText en="Previous" ar="السابق"/></span>}{registryPageNumbers(page,pages).map((n,index,numbers)=><span key={n} className="registry-page-number">{index>0&&n>numbers[index-1]+1&&<span className="registry-page-gap">…</span>}<Link prefetch={false} href={href(view,n,true)} aria-label={`Page ${n}`} aria-current={n===page?"page":undefined}>{n}</Link></span>)}{next_cursor?<Link prefetch={false} href={href(view,page+1,true,next_cursor)} className="registry-page-next"><StaffText en="Next" ar="التالي"/></Link>:<span className="registry-page-disabled"><StaffText en="Next" ar="التالي"/></span>}</div></nav>
  </div>;
}
