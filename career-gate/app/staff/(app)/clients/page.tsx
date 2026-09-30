import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmStartedControl } from "@/components/staff/ConfirmStartedControl";
import { StatusBadge } from "@/components/staff/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getStaffSession } from "@/lib/auth";
import { dateOnly, dateTime, formatPhone } from "@/lib/format";
import { operationalClientList, type ClientView } from "@/lib/operational-clients";

const PAGE_SIZE=25;
const VIEWS=new Set<ClientView>(["active","completed","all"]);

export default async function ClientsPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  const sp=await searchParams;
  const requested=sp.view as ClientView|undefined;
  const view:ClientView=requested&&VIEWS.has(requested)?requested:"active";
  const page=Math.max(1,Number.parseInt(sp.page??"1",10)||1);
  const {rows,total}=await operationalClientList(session,view,page,PAGE_SIZE);
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const pageHref=(n:number)=>`/staff/clients?view=${view}&page=${n}`;

  return <div className="ops-page space-y-4">
    <header className="ops-hero"><div><p className="ops-kicker">CAREER GATE · MASTER REGISTRY</p><h1>Clients</h1><p>{total} file{total===1?"":"s"} in {view} view · one original client record throughout the lifecycle</p></div>{session.staff.role!=="staff"&&<Link href="/staff/new-client" className="ops-primary-button">+ New Client</Link>}</header>

    <div className="ops-segmented w-fit" role="tablist" aria-label="Client lifecycle views">
      <Link href="/staff/clients?view=active" data-active={view==="active"}>Active</Link>
      <Link href="/staff/clients?view=completed" data-active={view==="completed"}>Completed & Working</Link>
      <Link href="/staff/clients?view=all" data-active={view==="all"}>All</Link>
    </div>

    {rows.length===0?<EmptyState title={`No ${view} clients`} text="No client records match this lifecycle view."/>:<div className="ops-glass-card overflow-x-auto p-0">
      <table className="table min-w-[1180px]">
        <thead><tr><th>Reference</th><th>Client</th><th>Status</th>{view==="completed"&&<><th>Start Date</th><th>Working</th><th>Site / Job / Shift</th><th>Payment</th></>}<th>Handled By</th><th>{view==="active"?"Next Action":"Last Updated"}</th>{view==="active"&&session.staff.role!=="staff"&&<th>Confirm Started</th>}</tr></thead>
        <tbody>{rows.map((c)=><tr key={c.id}>
          <td className="whitespace-nowrap font-mono"><Link href={`/staff/client/${c.id}`} className="text-cyan-300 hover:underline">{c.ref}</Link></td>
          <td><Link href={`/staff/client/${c.id}`} className="font-semibold text-slate-100 hover:text-cyan-200">{c.full_name}</Link><span className="mt-1 block text-sm text-slate-500">{formatPhone(c.phone)}{c.city?` · ${c.city}`:""}</span></td>
          <td><StatusBadge status={c.current_status}/></td>
          {view==="completed"&&<><td className="whitespace-nowrap">{dateOnly(c.start_date)}</td><td>{c.start_date?<span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300">WORKING CONFIRMED</span>:<span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-xs font-semibold text-amber-300">START DATE NOT CONFIRMED</span>}</td><td><strong className="block text-slate-200">{c.site_name??c.site_code??"—"}</strong><span className="text-sm text-slate-500">{c.job_title??c.job_id??"No job"} · {c.shift_name??c.shift_code??"No shift"}</span></td><td><span className="uppercase text-sm text-slate-300">{c.payment_status??"—"}</span>{c.fee_amount!=null&&<span className="ml-2 tabular-nums text-slate-500">${c.fee_amount.toFixed(2)}</span>}</td></>}
          <td>{c.assigned_name??"Unassigned"}</td>
          <td className="max-w-xs">{view==="active"?c.next_step:dateTime(c.updated_at)}</td>
          {view==="active"&&session.staff.role!=="staff"&&<td>{c.current_status==="ready_for_first_day"?<ConfirmStartedControl clientId={c.id}/>:<span className="text-sm text-slate-600">—</span>}</td>}
        </tr>)}</tbody>
      </table>
    </div>}

    <nav className="flex items-center justify-between text-sm text-slate-500" aria-label="Pagination"><span>{total} client{total===1?"":"s"} · page {page} of {pages}</span><span className="flex gap-4">{page>1&&<Link href={pageHref(page-1)} className="text-cyan-300">Previous</Link>}{page<pages&&<Link href={pageHref(page+1)} className="text-cyan-300">Next</Link>}</span></nav>
  </div>;
}
