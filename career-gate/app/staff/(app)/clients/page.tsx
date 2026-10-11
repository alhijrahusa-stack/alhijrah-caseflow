import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmStartedControl } from "@/components/staff/ConfirmStartedControl";
import { SoftDelete } from "@/components/staff/SoftDelete";
import { StatusBadge } from "@/components/staff/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getStaffSession } from "@/lib/auth";
import { STATUS_LABELS, STATUSES } from "@/lib/domain";
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
  const view:ClientView=requested&&VIEWS.has(requested)?requested:"active";
  const page=Math.max(1,Number.parseInt(sp.page??"1",10)||1);
  const status=(STATUSES as readonly string[]).includes(sp.status??"")?sp.status:undefined;
  const q=sp.q?.slice(0,100)||undefined;
  const {rows,total}=await operationalClientList(session,view,page,PAGE_SIZE,{q,status});
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const href=(nextView:ClientView,nextPage=1)=>`/staff/clients?view=${nextView}&page=${nextPage}${q?`&q=${encodeURIComponent(q)}`:""}${status?`&status=${status}`:""}`;

  return <div className="ops-page space-y-4">
    <header className="ops-hero"><div><p className="ops-kicker">CAREER GATE · MASTER REGISTRY</p><h1>Clients</h1><p>{total} file{total===1?"":"s"} in {view} view · one original client record throughout the lifecycle</p></div>{management&&<div className="flex flex-wrap gap-2"><Link href="/staff/archive" className="archive-link-button">Archive</Link><Link href="/staff/new-client" className="ops-primary-button">+ New Client</Link></div>}</header>

    <div className="ops-segmented w-fit" role="tablist" aria-label="Client lifecycle views"><Link href={href("active")} data-active={view==="active"}>Active Candidates</Link><Link href={href("completed")} data-active={view==="completed"}>Completed & Working (Placements)</Link><Link href={href("all")} data-active={view==="all"}>All Records</Link></div>

    <form className="ops-glass-card flex flex-wrap items-end gap-2" role="search"><input type="hidden" name="view" value={view}/><input name="q" defaultValue={q} placeholder="Reference, name, phone or email" className="input w-72" aria-label="Search clients"/><select name="status" defaultValue={status??""} className="input w-56" aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s)=><option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select><button className="ops-primary-button">Apply</button><Link href={`/staff/clients?view=${view}`} className="px-3 py-2 text-sm text-slate-500">Clear</Link></form>

    {rows.length===0?<EmptyState title={`No ${view} clients`} text="No client records match this lifecycle view."/>:<div className="ops-glass-card overflow-x-auto p-0"><table className="table min-w-[1240px]"><thead><tr><th>Reference</th><th>Client</th><th>Status</th>{view==="completed"&&<><th>Start Date</th><th>Working</th><th>Site / Job / Shift</th><th>Payment</th></>}<th>Handled By</th><th>{view==="active"?"Next Action":"Last Updated"}</th>{view==="active"&&management&&<th>Confirm Started</th>}{management&&<th>Archive</th>}</tr></thead><tbody>{rows.map((c)=><tr key={c.id}><td className="whitespace-nowrap font-mono"><Link href={`/staff/client/${c.id}`} className="text-cyan-300 hover:underline">{c.ref}</Link></td><td><Link href={`/staff/client/${c.id}`} className="font-semibold text-slate-100 hover:text-cyan-200">{c.full_name}</Link><span className="mt-1 block text-sm text-slate-500">{formatPhone(c.phone)}{c.city?` · ${c.city}`:""}</span></td><td><StatusBadge status={c.current_status}/></td>{view==="completed"&&<><td className="whitespace-nowrap">{dateOnly(c.start_date)}</td><td>{c.start_date?<span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300">WORKING CONFIRMED</span>:<span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-xs font-semibold text-amber-300">START DATE NOT CONFIRMED</span>}</td><td><strong className="block text-slate-200">{c.site_name??c.site_code??"—"}</strong><span className="text-sm text-slate-500">{c.job_title??c.job_id??"No job"} · {c.shift_name??c.shift_code??"No shift"}</span></td><td><span className="uppercase text-sm text-slate-300">{c.payment_status??"—"}</span>{c.fee_amount!=null&&<span className="ml-2 tabular-nums text-slate-500">${c.fee_amount.toFixed(2)}</span>}</td></>}<td>{c.assigned_name??"Unassigned"}</td><td className="max-w-xs">{view==="active"?c.next_step:dateTime(c.updated_at)}</td>{view==="active"&&management&&<td>{c.current_status==="ready_for_first_day"?<ConfirmStartedControl clientId={c.id}/>:<span className="text-sm text-slate-600">—</span>}</td>}{management&&<td><SoftDelete clientId={c.id} compact/></td>}</tr>)}</tbody></table></div>}

    <nav className="flex items-center justify-between text-sm text-slate-500" aria-label="Pagination"><span data-testid="client-total">{total} client{total===1?"":"s"} · page {page} of {pages}</span><span className="flex gap-4">{page>1&&<Link href={href(view,page-1)} className="text-cyan-300">Previous</Link>}{page<pages&&<Link href={href(view,page+1)} className="text-cyan-300">Next</Link>}</span></nav>
  </div>;
}
