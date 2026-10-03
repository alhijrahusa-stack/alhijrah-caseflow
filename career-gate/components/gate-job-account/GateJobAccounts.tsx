"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GateJobAccountEditor } from "@/components/gate-job-account/GateJobAccountEditor";

type AccountStatus = "PENDING" | "READY" | "DISABLED";
type AccountRow = { id: string; assigned_to_client_id: string; source_email_id: string; email_snapshot: string; status: AccountStatus; assigned_at: string; ready_at: string | null; updated_at: string; removed_at: string | null; client_name: string; client_ref: string };
type EmailOption = { id: string; email: string; status: string };
type ClientOption = { id: string; ref: string; full_name: string; current_status: string };
const shell = "rounded-2xl border border-white/[.07] bg-[#0a1020]/75 shadow-[0_22px_70px_rgba(0,0,0,.26)] backdrop-blur-md";

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${response.status})`);
  return data;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-label={title}><div className={`${shell} w-full max-w-2xl p-5`}><div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold text-amber-100">{title}</h2><button onClick={onClose} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400">Close</button></div>{children}</div></div>;
}

function AssignDialog({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [emailOptions, setEmailOptions] = useState<EmailOption[]>([]);
  const [emailId, setEmailId] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selected, setSelected] = useState<ClientOption | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reserved, setReserved] = useState(false);

  useEffect(() => {
    void api("/api/staff/gate-job-account/emails?status=AVAILABLE")
      .then((data) => setEmailOptions(data.emails))
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load emails"));
  }, []);

  useEffect(() => {
    if (clientSearch.trim().length < 2) return;
    const timer = setTimeout(() => {
      void api(`/api/staff/search?q=${encodeURIComponent(clientSearch)}`)
        .then((data) => setClients(data.results))
        .catch((err) => setError(err instanceof Error ? err.message : "Client search failed"));
    }, 220);
    return () => clearTimeout(timer);
  }, [clientSearch]);

  async function confirm() {
    if (!emailId || !selected || pending) return;
    setPending(true);
    setError(null);
    try {
      await api("/api/staff/gate-job-account/accounts/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "reserve", email_id: emailId, client_id: selected.id }),
      });
      setReserved(true);
      await api("/api/staff/gate-job-account/accounts/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "confirm", email_id: emailId, client_id: selected.id }),
      });
      setReserved(false);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setPending(false);
    }
  }

  async function cancel() {
    if (reserved && emailId) {
      try {
        await api("/api/staff/gate-job-account/accounts/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "release", email_id: emailId }),
        });
      } catch {
        // Reservation expiry is server-authoritative; closing remains safe.
      }
    }
    onClose();
  }

  return <div className="space-y-4">
    <label className="block text-xs text-slate-300">GATE JOB EMAIL
      <select aria-label="Gate Job email" className="mt-1 w-full rounded-xl border border-white/10 bg-[#090f1b] px-3 py-2 text-sm" value={emailId} onChange={(event) => { setEmailId(event.target.value); setReserved(false); }}>
        <option value="">Select AVAILABLE email</option>
        {emailOptions.map((option) => <option key={option.id} value={option.id}>{option.email}</option>)}
      </select>
    </label>
    <div>
      <label className="block text-xs text-slate-300">ASSIGNED TO
        <input aria-label="Assigned To" placeholder="Search client name / ref / email" className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm" value={clientSearch} onChange={(event) => {
          const value = event.target.value;
          setClientSearch(value);
          setSelected(null);
          if (value.trim().length < 2) setClients([]);
        }} />
      </label>
      {clients.length > 0 && <div className="mt-2 max-h-44 overflow-auto rounded-xl border border-white/[.07] bg-black/20 p-1">{clients.map((client) => <button key={client.id} type="button" onClick={() => { setSelected(client); setClientSearch(client.full_name); setClients([]); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-white/[.04]"><span>{client.full_name}</span><span className="font-mono text-slate-500">{client.ref}</span></button>)}</div>}
    </div>
    {selected && <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.04] p-3"><p className="text-[9px] tracking-[.13em] text-cyan-300">SELECTED CLIENT</p><strong className="mt-1 block text-sm">{selected.full_name}</strong><span className="font-mono text-xs text-slate-500">{selected.id}</span></div>}
    {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
    <div className="flex justify-end gap-2"><button onClick={() => void cancel()} disabled={pending} className="rounded-xl border border-white/10 px-3 py-2 text-xs">CANCEL</button><button onClick={() => void confirm()} disabled={pending || !emailId || !selected} className="rounded-xl border border-amber-200/30 bg-gradient-to-r from-amber-500/90 to-yellow-300/85 px-4 py-2 text-xs font-bold text-[#171006] disabled:opacity-40">{pending ? "ASSIGNING…" : "CONFIRM ASSIGNMENT ✦"}</button></div>
  </div>;
}

export function GateJobAccounts() {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [status, setStatus] = useState<"ALL" | AccountStatus>("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assign, setAssign] = useState(false);
  const [edit, setEdit] = useState<AccountRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api(`/api/staff/gate-job-account/accounts?status=${status}&q=${encodeURIComponent(search)}`);
      setRows(data.accounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Gate Job accounts");
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 220);
    return () => clearTimeout(timer);
  }, [load]);

  async function ready(row: AccountRow) {
    try {
      await api("/api/staff/gate-job-account/accounts/ready", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: row.id }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to mark ready");
    }
  }

  async function remove(row: AccountRow) {
    if (!confirm(`Disable Gate Job account ${row.email_snapshot} for ${row.client_name}?`)) return;
    try {
      await api("/api/staff/gate-job-account/accounts/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: row.id }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove account");
    }
  }

  return <section className="space-y-4" data-testid="gate-job-accounts">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">GATE JOB ACCOUNTS</h2><p className="mt-1 text-xs text-slate-500">Exact client assignment and Gate Job account lifecycle control.</p></div><button onClick={() => setAssign(true)} className="rounded-xl border border-amber-200/30 bg-gradient-to-r from-amber-500/90 to-yellow-300/85 px-4 py-2 text-xs font-bold text-[#171006] shadow-[0_0_20px_rgba(251,191,36,.12)]">CREATE / ASSIGN ACCOUNT ✦</button></div>
    <div className={`${shell} p-3`}><div className="flex flex-wrap gap-2"><input aria-label="Search Gate Job accounts" placeholder="Search Client / Gate Job Email" className="min-w-[240px] flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="flex gap-1">{(["ALL", "PENDING", "READY", "DISABLED"] as const).map((key) => <button key={key} onClick={() => setStatus(key)} className={`rounded-lg px-2.5 py-2 text-[10px] ${status === key ? "bg-amber-300 text-black" : "border border-white/10 text-slate-400"}`}>{key}</button>)}</div></div></div>
    {error && <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/[.06] p-3 text-xs text-red-300">{error}</p>}
    <div className={`${shell} overflow-hidden`}><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="border-b border-white/[.07] bg-white/[.02] text-[9px] tracking-[.12em] text-slate-500"><tr><th className="p-3">CLIENT</th><th>GATE JOB EMAIL</th><th>STATUS</th><th>ASSIGNED DATE</th><th>READY DATE</th><th className="p-3">ACTIONS</th></tr></thead><tbody>{loading ? <tr><td colSpan={6} className="p-6 text-center text-slate-500">Loading accounts…</td></tr> : rows.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-slate-500">No Gate Job accounts found.</td></tr> : rows.map((row) => <tr key={row.id} className="border-b border-white/[.045] last:border-0"><td className="p-3"><strong className="block text-slate-200">{row.client_name}</strong><span className="font-mono text-[10px] text-slate-500">{row.client_ref}</span></td><td>{row.email_snapshot}</td><td><span className={`rounded-full border px-2 py-1 text-[9px] ${row.status === "READY" ? "border-emerald-300/20 text-emerald-300" : row.status === "PENDING" ? "border-amber-300/20 text-amber-200" : "border-slate-400/20 text-slate-400"}`}>{row.status}</span></td><td className="text-[10px] text-slate-500">{new Date(row.assigned_at).toLocaleString()}</td><td className="text-[10px] text-slate-500">{row.ready_at ? new Date(row.ready_at).toLocaleString() : "—"}</td><td className="p-3"><div className="flex flex-wrap gap-1"><Link href={`/staff/client/${row.assigned_to_client_id}`} className="rounded-lg border border-cyan-300/15 px-2 py-1 text-[10px] text-cyan-200">Open Client</Link>{row.status !== "DISABLED" && <button onClick={() => setEdit(row)} className="rounded-lg border border-white/10 px-2 py-1 text-[10px]">Edit</button>}{row.status === "PENDING" && <button onClick={() => void ready(row)} className="rounded-lg border border-emerald-300/15 px-2 py-1 text-[10px] text-emerald-300">Mark Ready</button>}{row.status !== "DISABLED" && <button onClick={() => void remove(row)} className="rounded-lg border border-red-400/15 px-2 py-1 text-[10px] text-red-300">Remove</button>}</div></td></tr>)}</tbody></table></div></div>
    {assign && <Modal title="ASSIGN GATE JOB ACCOUNT" onClose={() => setAssign(false)}><AssignDialog onClose={() => setAssign(false)} onDone={() => { setAssign(false); void load(); }} /></Modal>}
    {edit && <Modal title="EDIT GATE JOB ACCOUNT" onClose={() => setEdit(null)}><GateJobAccountEditor account={edit} onCancel={() => setEdit(null)} onDone={() => { setEdit(null); void load(); }} /></Modal>}
  </section>;
}
