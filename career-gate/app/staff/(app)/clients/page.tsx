import Link from "next/link";
import { redirect } from "next/navigation";
import { ClientCommandTable } from "@/components/staff/ClientCommandTable";
import { ClientArchiveCards } from "@/components/staff/ClientArchiveCards";
import { ClientLocationShiftCard } from "@/components/staff/ClientLocationShiftCard";
import { ConfirmStartedControl } from "@/components/staff/ConfirmStartedControl";
import { SoftDelete } from "@/components/staff/SoftDelete";
import { StatusBadge } from "@/components/staff/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getStaffSession, withStaff } from "@/lib/auth";
import { STATUS_LABELS, STATUSES } from "@/lib/domain";
import { CLIENT_STAGES, isClientStageFilter } from "@/lib/client-lifecycle-filters";
import { dateOnly, dateTime, formatPhone } from "@/lib/format";
import { operationalClientList, type ClientView } from "@/lib/operational-clients";

const PAGE_SIZE=25;
const VIEWS=new Set<ClientView>(["active","completed","all"]);

export default async function ClientsPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  const management=session.staff.role!=="staff";
  const sp=await searchParams;
  const requested=sp.view as ClientView|undefined;
  const stage=isClientStageFilter(sp.stage)?sp.stage:undefined;
  const view:ClientView=stage?"active":requested&&VIEWS.has(requested)?requested:"active";
  const rawPage=Number(sp.page??"1");
  const requestedPage=Number.isSafeInteger(rawPage) && rawPage>0 ? rawPage : 1;
  const status=(STATUSES as readonly string[]).includes(sp.status??"")?sp.status:undefined;
  const q=sp.q?.slice(0,100)||undefined;
  const attention=sp.attention==="documents"?"documents":undefined;
  const assigned=management&&sp.assigned==="none"?"none":undefined;
  const completedThisMonth=sp.completed_this_month==="1";
  const {rows,total,page}=await operationalClientList(session,view,requestedPage,PAGE_SIZE,{q,status,stage,attention,completedThisMonth,assigned});
  const staffRoster=await withStaff(session,tx=>tx`select id,display_name from staff where active order by display_name`);
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const href=(nextView:ClientView,nextPage=1,retainStage=false)=>`/staff/clients?view=${nextView}&page=${nextPage}${retainStage&&stage?`&stage=${stage}`:""}${q?`&q=${encodeURIComponent(q)}`:""}${status?`&status=${status}`:""}${attention?`&attention=${attention}`:""}${assigned?"&assigned=none":""}${completedThisMonth?"&completed_this_month=1":""}`;

  return <div className="ops-page space-y-4">
    <header className="ops-hero"><div><p className="ops-kicker">CAREER GATE · MASTER REGISTRY</p><h1 className="tracking-tight">Clients <span className="text-amber-300">/ سجل العملاء</span></h1><p>{total} file{total===1?"":"s"} in {view} view · one original client record throughout the lifecycle</p></div>{management&&<div className="flex flex-wrap gap-2"><Link href="/staff/archive" className="archive-link-button">Archive</Link><Link href="/staff/new-client" className="ops-primary-button">+ New Client</Link></div>}</header>

    {view==="active"&&!stage&&<ClientLocationShiftCard clients={rows.map(c=>({id:c.id,full_name:c.full_name,ref:c.ref}))}/>}
    <nav aria-label="Operational client lifecycle stages" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {CLIENT_STAGES.map((station)=><Link key={station.id} href={station.href} aria-current={stage===station.id?"page":undefined}
        className={`cg-stage-tab min-w-0 rounded-xl border px-3 py-3 transition-colors ${stage===station.id?"border-amber-300/60 bg-amber-200/15 text-white":"border-amber-200/15 bg-[#102840] text-slate-200 hover:border-amber-300/35 hover:bg-[#173750]"}`}>
        <span className="block text-xs font-semibold leading-5">{station.label}</span><span lang="ar" dir="rtl" className="mt-1 block text-xs text-amber-100/80">{station.labelAr}</span>
      </Link>)}
    </nav>
    {stage==="account_setup"&&management&&<Link href="/staff/gate-job-account" className="cg-command-button inline-flex w-fit">Open Amazon Account Setup ↗</Link>}
    {stage==="payment_required"&&management&&<Link href="/staff/accounting" className="cg-command-button inline-flex w-fit">Open verified payment ledger ↗</Link>}
    {stage==="paperwork_pending"&&<p role="status" className="text-sm text-emerald-200">Only files with verified paid accounts are shown here. Paperwork remains a separate completion task.</p>}

    {assigned==="none"&&<p role="status" className="text-sm text-amber-200">Unassigned files · all matching active records, across server-side pages.</p>}
    {completedThisMonth&&<p role="status" className="text-sm text-amber-200">Completed this month · showing currently completed client files with recorded completion this calendar month.</p>}
    {attention==="documents"&&<p role="status" className="text-sm text-amber-200">Documents needing action · showing active client files with unresolved latest document reviews.</p>}

    <div className="ops-segmented max-w-full flex-wrap" role="tablist" aria-label="Client lifecycle views"><Link href={href("active")} data-active={view==="active"}>Active Candidates</Link><Link href={href("completed")} data-active={view==="completed"}>Completed & Working (Placements)</Link><Link href={href("all")} data-active={view==="all"}>All Records</Link></div>

    <form className="ops-glass-card flex flex-wrap items-end gap-2" role="search"><input type="hidden" name="view" value={view}/>{stage&&<input type="hidden" name="stage" value={stage}/>}{assigned&&<input type="hidden" name="assigned" value={assigned}/>}{attention&&<input type="hidden" name="attention" value={attention}/>}{completedThisMonth&&<input type="hidden" name="completed_this_month" value="1"/>}<input name="q" defaultValue={q} placeholder="Reference, name, phone or email" className="input w-72" aria-label="Search clients"/><select name="status" defaultValue={status??""} className="input w-56" aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s)=><option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select><button className="ops-primary-button">Apply</button><Link href={stage?`/staff/clients?stage=${stage}`:`/staff/clients?view=${view}`} className="px-3 py-2 text-sm text-slate-300">Clear</Link></form>

    {view==="active"&&rows.length>0&&<ClientCommandTable clients={rows.map(c=>({id:c.id,ref:c.ref,full_name:c.full_name,phone:c.phone,email:c.email,city:c.city,current_status:c.current_status,next_step:c.next_step,amazon_account_ready:c.amazon_account_ready,payment_status:c.payment_status,assigned_staff:c.assigned_staff,assigned_name:c.assigned_name,created_at:c.created_at,updated_at:c.updated_at,site_name:c.site_name,shift_name:c.shift_name}))} staff={staffRoster as unknown as {id:string;display_name:string}[]} management={management}/>}
    {view!=="active"&&(rows.length===0?<EmptyState title={`No ${view} clients`} text="No client records match this lifecycle view."/>:<><div className="2xl:hidden"><ClientArchiveCards clients={rows}/></div><div className="ops-glass-card hidden overflow-x-auto rounded-[18px] border border-amber-200/15 bg-[#0b1c2f] p-0 2xl:block"><table className="table min-w-[1240px]"><thead><tr><th>Reference</th><th>Client</th><th>Status</th>{view==="completed"&&<><th>Start Date</th><th>Working</th><th>Site / Job / Shift</th><th>Payment</th></>}<th>Handled By</th><th>Received On</th><th>Last Updated</th>{false&&<th>Next Action</th>}{false&&management&&<th>Confirm Started</th>}{management&&<th>Archive</th>}</tr></thead><tbody>{rows.map((c)=><tr key={c.id}><td className="whitespace-nowrap font-mono"><Link href={`/staff/client/${c.id}`} className="text-cyan-300 hover:underline">{c.ref}</Link></td><td><Link href={`/staff/client/${c.id}`} className="font-semibold text-slate-100 hover:text-cyan-200">{c.full_name}</Link><span className="mt-1 block text-sm text-slate-500">{formatPhone(c.phone)}{c.city?` · ${c.city}`:""}</span></td><td><StatusBadge status={c.current_status}/></td>{view==="completed"&&<><td className="whitespace-nowrap">{dateOnly(c.start_date)}</td><td>{c.start_date?<span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300">WORKING CONFIRMED</span>:<span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-xs font-semibold text-amber-300">START DATE NOT CONFIRMED</span>}</td><td><strong className="block text-slate-200">{c.site_name??c.site_code??"—"}</strong><span className="text-sm text-slate-500">{c.job_title??c.job_id??"No job"} · {c.shift_name??c.shift_code??"No shift"}</span></td><td><span className="uppercase text-sm text-slate-300">{c.payment_status??"—"}</span>{c.fee_amount!=null&&<span className="ml-2 tabular-nums text-slate-500">${c.fee_amount.toFixed(2)}</span>}</td></>}<td>{c.assigned_name??"Unassigned"}</td><td className="whitespace-nowrap text-slate-300">{dateTime(c.created_at)}</td><td className="whitespace-nowrap text-amber-200/90">{dateTime(c.updated_at)}</td>{false&&<td className="max-w-xs">{c.next_step}</td>}{false&&management&&<td>{c.current_status==="ready_for_first_day"?<ConfirmStartedControl clientId={c.id}/>:<span className="text-sm text-slate-600">—</span>}</td>}{management&&<td><SoftDelete clientId={c.id} compact/></td>}</tr>)}</tbody></table></div></>)}

    <nav className="flex items-center justify-between text-sm text-slate-500" aria-label="Pagination"><span data-testid="client-total">{total} client{total===1?"":"s"} · page {page} of {pages}</span><span className="flex gap-4">{page>1&&<Link href={href(view,page-1,true)} className="text-cyan-300">Previous</Link>}{page<pages&&<Link href={href(view,page+1,true)} className="text-cyan-300">Next</Link>}</span></nav>
  </div>;
}
