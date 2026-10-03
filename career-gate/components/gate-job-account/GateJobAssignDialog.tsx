"use client";

import { useEffect, useState } from "react";

type EmailOption = { id: string; email: string; status: string };
type ClientOption = { id: string; ref: string; full_name: string; current_status: string };

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${response.status})`);
  return data;
}

export function GateJobAssignDialog({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
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
    if (selected || clientSearch.trim().length < 2) return;
    const timer = setTimeout(() => {
      void api(`/api/staff/search?q=${encodeURIComponent(clientSearch)}`)
        .then((data) => setClients(data.results))
        .catch((err) => setError(err instanceof Error ? err.message : "Client search failed"));
    }, 220);
    return () => clearTimeout(timer);
  }, [clientSearch, selected]);

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
        // Reservation expiry is authoritative; closing the dialog remains safe.
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
        <input aria-label="Assigned To" placeholder="Search exact client name / ref / email" className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm" value={clientSearch} onChange={(event) => {
          const value = event.target.value;
          setClientSearch(value);
          setSelected(null);
          if (value.trim().length < 2) setClients([]);
        }} />
      </label>
      {clients.length > 0 && <div className="mt-2 max-h-44 overflow-auto rounded-xl border border-white/[.07] bg-black/20 p-1">{clients.map((client) => <button key={client.id} type="button" onClick={() => { setSelected(client); setClientSearch(`${client.full_name} · ${client.ref}`); setClients([]); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-white/[.04]"><span>{client.full_name}</span><span className="font-mono text-slate-500">{client.ref}</span></button>)}</div>}
    </div>
    {selected && <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.04] p-3"><p className="text-[9px] tracking-[.13em] text-cyan-300">EXACT CLIENT SELECTED</p><strong className="mt-1 block text-sm">{selected.full_name}</strong><span className="font-mono text-xs text-slate-500">{selected.ref} · {selected.id}</span></div>}
    {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
    <div className="flex justify-end gap-2"><button onClick={() => void cancel()} disabled={pending} className="rounded-xl border border-white/10 px-3 py-2 text-xs">CANCEL</button><button onClick={() => void confirm()} disabled={pending || !emailId || !selected} className="rounded-xl border border-amber-200/30 bg-gradient-to-r from-amber-500/90 to-yellow-300/85 px-4 py-2 text-xs font-bold text-[#171006] disabled:opacity-40">{pending ? "ASSIGNING…" : "CONFIRM ASSIGNMENT ✦"}</button></div>
  </div>;
}
