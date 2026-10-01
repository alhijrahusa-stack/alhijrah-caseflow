import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { unifiedSearch } from "@/lib/unified-search";

export const dynamic="force-dynamic";

export default async function SearchPage({searchParams}:{searchParams:Promise<{q?:string}>}){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  const {q=""}=await searchParams;
  const query=q.trim().slice(0,200);
  const results=query.length>=2?await unifiedSearch(session,query):[];
  return <div className="ops-page space-y-4">
    <header className="ops-hero"><div><p className="ops-kicker">CAREER GATE · SEARCH</p><h1>Unified Search</h1><p>Clients, documents, tasks, appointments, payments and employees within your authorized scope.</p></div></header>
    <form className="ops-glass-card flex gap-2" action="/staff/search"><input autoFocus name="q" defaultValue={query} className="ops-input flex-1" placeholder="Name, file number, phone, email, document, task, payment reference…" minLength={2} maxLength={200}/><button className="ops-primary-button" type="submit">Search</button></form>
    {query.length>0&&query.length<2&&<p className="text-sm text-amber-300">Enter at least two characters.</p>}
    <section className="ops-glass-card"><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Results</h2>{query.length>=2&&<span className="text-xs text-slate-500">{results.length} result{results.length===1?"":"s"}</span>}</div><div className="grid gap-2">{results.map(r=><Link key={`${r.kind}:${r.id}`} href={r.href} className="flex items-center gap-3 rounded-xl border border-white/[.06] p-3 transition hover:bg-white/[.025]"><span className="w-24 shrink-0 rounded-full border border-white/10 px-2 py-1 text-center text-[10px] uppercase text-slate-500">{r.kind}</span><div className="min-w-0 flex-1"><strong className="block truncate text-sm text-slate-200">{r.primary}</strong><span className="block truncate text-xs text-slate-500">{r.secondary}</span></div>{r.meta&&<span className="text-xs capitalize text-slate-400">{r.meta.replace(/_/g," ")}</span>}</Link>)}{query.length>=2&&!results.length&&<p className="p-4 text-sm text-slate-500">No authorized results matched this search.</p>}{query.length<2&&<p className="p-4 text-sm text-slate-500">Search starts after two characters.</p>}</div></section>
  </div>;
}
