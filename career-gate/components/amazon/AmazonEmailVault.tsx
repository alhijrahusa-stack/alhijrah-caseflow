"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AmazonEmailForm } from "@/components/amazon/AmazonEmailForm";
import { CredentialField } from "@/components/amazon/CredentialField";

type VaultStatus = "AVAILABLE" | "RESERVED" | "USED";
type VaultRow = { id: string; email: string; status: VaultStatus; updated_at: string; reservation_expires_at?: string | null };
type Counts = Record<VaultStatus, number>;
type BulkRow = { email: string; password: string; pin: string };
type BulkResult = { index: number; email: string; status: "VALID" | "DUPLICATE" | "INVALID"; message?: string };

const shell = "rounded-2xl border border-white/[.07] bg-[#0a1020]/75 shadow-[0_22px_70px_rgba(0,0,0,.26)] backdrop-blur-md";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className={`${shell} w-full max-w-xl p-5`}><div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold text-amber-100">{title}</h2><button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400">Close</button></div>{children}</div>
  </div>;
}

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${response.status})`);
  return data;
}

function EditVault({ row, onDone, onClose }: { row: VaultRow; onDone: () => void; onClose: () => void }) {
  const [email, setEmail] = useState(row.email);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (pending) return; setPending(true); setError(null);
    try {
      const body: Record<string, string> = { id: row.id, email };
      if (password) body.password = password; if (pin) body.pin = pin;
      await api("/api/staff/amazon-account/emails", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      onDone();
    } catch (err) { setError(err instanceof Error ? err.message : "Update failed"); }
    finally { setPending(false); }
  }
  return <form className="space-y-3" onSubmit={submit}>
    <label className="block text-xs text-slate-300">Email<input type="email" required className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2" value={email} onChange={(e)=>setEmail(e.target.value)} /></label>
    <label className="block text-xs text-slate-300">New Password<input type="password" minLength={8} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2" value={password} onChange={(e)=>setPassword(e.target.value)} /></label>
    <label className="block text-xs text-slate-300">New PIN<input type="password" inputMode="numeric" pattern="\d{4,12}" className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2" value={pin} onChange={(e)=>setPin(e.target.value.replace(/\D/g,"").slice(0,12))} /></label>
    {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
    <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-3 py-2 text-xs">Cancel</button><button disabled={pending} className="rounded-xl bg-amber-300 px-4 py-2 text-xs font-bold text-black disabled:opacity-50">{pending?"UPDATING…":"UPDATE ✦"}</button></div>
  </form>;
}

function BulkAdd({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [rows, setRows] = useState<BulkRow[]>([{ email: "", password: "", pin: "" }, { email: "", password: "", pin: "" }]);
  const [preview, setPreview] = useState<BulkResult[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (index: number, key: keyof BulkRow, value: string) => { setRows((current)=>current.map((row,i)=>i===index?{...row,[key]:value}:row)); setPreview(null); };
  async function run(mode: "preview" | "commit") {
    setPending(true); setError(null);
    try {
      const data = await api("/api/staff/amazon-account/emails/bulk", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({mode,rows}) });
      setPreview(data.rows);
      if (mode === "commit" && data.inserted === rows.length) onDone();
    } catch (err) { setError(err instanceof Error ? err.message : "Bulk operation failed"); }
    finally { setPending(false); }
  }
  const canCommit = preview?.length === rows.length && preview.every((row)=>row.status==="VALID");
  return <div className="space-y-3">
    <div className="max-h-[55vh] space-y-2 overflow-auto pr-1">{rows.map((row,index)=><div key={index} className="grid gap-2 rounded-xl border border-white/[.06] bg-white/[.02] p-3 md:grid-cols-[1.3fr_1fr_.65fr_auto]">
      <input aria-label={`Email ${index+1}`} type="email" placeholder="Email" className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-xs" value={row.email} onChange={(e)=>update(index,"email",e.target.value)} />
      <input aria-label={`Password ${index+1}`} type="password" placeholder="Password" className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-xs" value={row.password} onChange={(e)=>update(index,"password",e.target.value)} />
      <input aria-label={`PIN ${index+1}`} type="password" inputMode="numeric" placeholder="PIN" className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-xs" value={row.pin} onChange={(e)=>update(index,"pin",e.target.value.replace(/\D/g,"").slice(0,12))} />
      <button type="button" aria-label={`Remove row ${index+1}`} onClick={()=>{setRows((v)=>v.filter((_,i)=>i!==index));setPreview(null);}} disabled={rows.length===1} className="rounded-lg border border-red-400/15 px-2 text-xs text-red-300 disabled:opacity-30">×</button>
      {preview?.[index] && <p className={`md:col-span-4 text-[10px] ${preview[index].status==="VALID"?"text-emerald-300":preview[index].status==="DUPLICATE"?"text-amber-300":"text-red-300"}`}>{preview[index].status}{preview[index].message?` — ${preview[index].message}`:""}</p>}
    </div>)}</div>
    <button type="button" onClick={()=>{setRows((v)=>[...v,{email:"",password:"",pin:""}]);setPreview(null);}} className="rounded-xl border border-white/10 px-3 py-2 text-xs">+ Add row</button>
    {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
    <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-3 py-2 text-xs">Cancel</button><button type="button" disabled={pending} onClick={()=>run("preview")} className="rounded-xl border border-cyan-300/20 px-3 py-2 text-xs text-cyan-200 disabled:opacity-50">{pending?"CHECKING…":"VALIDATE"}</button><button type="button" disabled={pending||!canCommit} onClick={()=>run("commit")} className="rounded-xl bg-amber-300 px-4 py-2 text-xs font-bold text-black disabled:opacity-40">ADD VALIDATED ✦</button></div>
  </div>;
}

export function AmazonEmailVault() {
  const [rows, setRows] = useState<VaultRow[]>([]);
  const [counts, setCounts] = useState<Counts>({ AVAILABLE:0, RESERVED:0, USED:0 });
  const [status, setStatus] = useState<"ALL"|VaultStatus>("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [modal, setModal] = useState<"add"|"bulk"|null>(null);
  const [edit, setEdit] = useState<VaultRow|null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const data=await api(`/api/staff/amazon-account/emails?status=${status}&q=${encodeURIComponent(search)}`); setRows(data.emails); setCounts(data.counts); }
    catch(err){ setError(err instanceof Error?err.message:"Unable to load vault"); }
    finally{ setLoading(false); }
  },[search,status]);
  useEffect(()=>{ const t=setTimeout(()=>void load(),220); return()=>clearTimeout(t); },[load]);

  async function remove(row:VaultRow){ if(!confirm(`Delete ${row.email}?`))return; try{await api("/api/staff/amazon-account/emails",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:row.id})});await load();}catch(err){setError(err instanceof Error?err.message:"Delete failed");}}
  async function release(row:VaultRow){ try{await api("/api/staff/amazon-account/accounts/assign",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"release",email_id:row.id})});await load();}catch(err){setError(err instanceof Error?err.message:"Release failed");}}

  return <section className="space-y-4" data-testid="amazon-email-vault">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-100">AMAZON EMAIL VAULT</h2><p className="mt-1 text-xs text-slate-500">Encrypted Amazon employment credential inventory.</p></div><div className="flex flex-wrap gap-2"><button onClick={()=>setModal("add")} className="rounded-xl border border-amber-200/30 bg-gradient-to-r from-amber-500/90 to-yellow-300/85 px-3 py-2 text-xs font-bold text-[#171006] shadow-[0_0_20px_rgba(251,191,36,.12)]">+ ADD EMAIL ✦</button><button onClick={()=>setModal("bulk")} className="rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-xs">+ ADD MULTIPLE</button><Link href="/staff/amazon-account/quick-add" className="rounded-xl border border-cyan-300/20 bg-cyan-300/[.04] px-3 py-2 text-xs text-cyan-100">QUICK ADD</Link></div></div>
    <div className="grid grid-cols-3 gap-2">{(["AVAILABLE","RESERVED","USED"] as VaultStatus[]).map((key)=><button key={key} type="button" onClick={()=>setStatus(key)} className={`${shell} p-3 text-left transition hover:border-amber-300/20`}><span className="text-[9px] tracking-[.15em] text-slate-500">{key}</span><strong className="mt-1 block font-mono text-xl text-slate-100">{counts[key]}</strong></button>)}</div>
    <div className={`${shell} p-3`}><div className="flex flex-wrap gap-2"><input aria-label="Search Amazon emails" placeholder="Search email" className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-cyan-300/30" value={search} onChange={(e)=>setSearch(e.target.value)} /><div className="flex gap-1" role="group" aria-label="Vault status filter">{(["ALL","AVAILABLE","RESERVED","USED"] as const).map((key)=><button key={key} onClick={()=>setStatus(key)} data-active={status===key} className={`rounded-lg px-2.5 py-2 text-[10px] ${status===key?"bg-amber-300 text-black":"border border-white/10 text-slate-400"}`}>{key}</button>)}</div></div></div>
    {error&&<p className="rounded-xl border border-red-500/20 bg-red-500/[.06] p-3 text-xs text-red-300" role="alert">{error}</p>}
    <div className={`${shell} overflow-hidden`}><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="border-b border-white/[.07] bg-white/[.02] text-[9px] tracking-[.12em] text-slate-500"><tr><th className="p-3">EMAIL</th><th>PASSWORD</th><th>PIN</th><th>STATUS</th><th>UPDATED</th><th className="p-3">ACTIONS</th></tr></thead><tbody>{loading?<tr><td colSpan={6} className="p-6 text-center text-slate-500">Loading vault…</td></tr>:rows.length===0?<tr><td colSpan={6} className="p-6 text-center text-slate-500">No Amazon emails found.</td></tr>:rows.map((row)=><tr key={row.id} className="border-b border-white/[.045] last:border-0"><td className="p-3 font-medium text-slate-200">{row.email}</td><td><CredentialField source="vault" recordId={row.id} field="password" /></td><td><CredentialField source="vault" recordId={row.id} field="pin" /></td><td><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${row.status==="AVAILABLE"?"border-emerald-300/20 bg-emerald-300/[.05] text-emerald-300":row.status==="RESERVED"?"border-cyan-300/20 bg-cyan-300/[.05] text-cyan-300":"border-amber-300/20 bg-amber-300/[.05] text-amber-200"}`}>{row.status}</span></td><td className="text-[10px] text-slate-500">{new Date(row.updated_at).toLocaleString()}</td><td className="p-3"><div className="flex gap-1"><button onClick={()=>setEdit(row)} className="rounded-lg border border-white/10 px-2 py-1 text-[10px]">Edit</button>{row.status==="AVAILABLE"&&<button onClick={()=>remove(row)} className="rounded-lg border border-red-400/15 px-2 py-1 text-[10px] text-red-300">Delete</button>}{row.status==="RESERVED"&&<button onClick={()=>release(row)} className="rounded-lg border border-cyan-300/15 px-2 py-1 text-[10px] text-cyan-200">Release</button>}</div></td></tr>)}</tbody></table></div></div>
    {modal==="add"&&<Modal title="ADD AMAZON ACCOUNT EMAIL" onClose={()=>setModal(null)}><AmazonEmailForm onSuccess={()=>{setModal(null);void load();}} /></Modal>}
    {modal==="bulk"&&<Modal title="ADD MULTIPLE AMAZON EMAILS" onClose={()=>setModal(null)}><BulkAdd onClose={()=>setModal(null)} onDone={()=>{setModal(null);void load();}} /></Modal>}
    {edit&&<Modal title="EDIT AMAZON EMAIL" onClose={()=>setEdit(null)}><EditVault row={edit} onClose={()=>setEdit(null)} onDone={()=>{setEdit(null);void load();}} /></Modal>}
  </section>;
}
