"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { OperationsStaff } from "@/lib/operations";

type DistributionClient = {
  id: string;
  ref: string;
  full_name: string;
  phone: string;
  email: string | null;
  pipeline_stage: string;
  assigned_staff: string | null;
  assigned_name: string | null;
  staff_code: string | null;
  updated_at: string;
};

type Settings = { round_robin_enabled: boolean; cursor: number; updated_at: string };

async function mutate(body: Record<string, unknown>) {
  const res = await fetch("/api/staff/operations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data;
}

export function DistributionPanel({
  staff,
  clients,
  settings,
  isAdmin,
}: {
  staff: OperationsStaff[];
  clients: DistributionClient[];
  settings: Settings;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [q, setQ] = useState("");
  const [roundRobin, setRoundRobin] = useState(settings.round_robin_enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((client) => [client.full_name, client.ref, client.phone, client.email ?? "", client.assigned_name ?? "", client.staff_code ?? ""]
      .some((v) => v.toLowerCase().includes(term)));
  }, [clients, q]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const client of clients) map.set(client.assigned_staff ?? "unassigned", (map.get(client.assigned_staff ?? "unassigned") ?? 0) + 1);
    return map;
  }, [clients]);

  async function assign() {
    if (!selected.size) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await mutate({ operation: "bulk_assign", client_ids: [...selected], staff_id: target || null });
      setSelected(new Set());
      setNotice("Assignment updated");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to assign clients");
    } finally {
      setBusy(false);
    }
  }

  async function toggleRoundRobin(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await mutate({ operation: "set_round_robin", enabled: next });
      setRoundRobin(next);
      setNotice(next ? "Round-robin enabled" : "Round-robin disabled");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update round-robin");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ops-page">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · DISTRIBUTION</p>
          <h1>Staff & Task Distribution</h1>
          <p>إسناد يدوي جماعي مع خيار توزيع تلقائي بالتناوب للعملاء الجدد</p>
        </div>
        {isAdmin && (
          <label className="ops-switch-card">
            <div><strong>Round-Robin</strong><span>New portal clients</span></div>
            <input type="checkbox" checked={roundRobin} disabled={busy} onChange={(e) => void toggleRoundRobin(e.target.checked)} />
            <i />
          </label>
        )}
      </header>

      {error && <div className="ops-error" role="alert">{error}</div>}
      {notice && <div className="ops-notice" role="status">{notice}</div>}

      <div className="ops-staff-grid">
        <div className="ops-metric"><span>Unassigned</span><strong>{counts.get("unassigned") ?? 0}</strong></div>
        {staff.filter((s) => s.active).map((member) => (
          <div className="ops-staff-card" key={member.id}>
            <div><code>{member.staff_code ?? "—"}</code><strong>{member.display_name}</strong></div>
            <span>{counts.get(member.id) ?? 0} clients</span>
            <small>{member.role} · {member.eligible_for_round_robin ? "Round-robin" : "Manual only"}</small>
          </div>
        ))}
      </div>

      <section className="ops-glass-card">
        <div className="ops-toolbar">
          <input className="ops-input ops-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client, phone, email or file" />
          <select className="ops-select" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Unassigned</option>
            {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.staff_code ?? "—"} · {s.display_name}</option>)}
          </select>
          <button type="button" className="ops-primary-button" disabled={busy || selected.size === 0} onClick={() => void assign()}>
            Assign {selected.size ? `(${selected.size})` : "selected"}
          </button>
        </div>

        <div className="ops-distribution-table-wrap">
          <table className="ops-table">
            <thead>
              <tr><th><input type="checkbox" aria-label="Select visible clients" checked={filtered.length > 0 && filtered.every((c) => selected.has(c.id))} onChange={(e) => {
                const next = new Set(selected);
                for (const client of filtered) e.target.checked ? next.add(client.id) : next.delete(client.id);
                setSelected(next);
              }} /></th><th>Client</th><th>File</th><th>Stage</th><th>Current owner</th><th /></tr>
            </thead>
            <tbody>
              {filtered.map((client) => (
                <tr key={client.id}>
                  <td><input type="checkbox" aria-label={`Select ${client.full_name}`} checked={selected.has(client.id)} onChange={(e) => {
                    const next = new Set(selected);
                    e.target.checked ? next.add(client.id) : next.delete(client.id);
                    setSelected(next);
                  }} /></td>
                  <td><strong>{client.full_name}</strong><span>{client.phone}</span></td>
                  <td><code>{client.ref}</code></td>
                  <td><span>{client.pipeline_stage.replace(/_/g, " ")}</span></td>
                  <td><strong>{client.assigned_name ?? "Unassigned"}</strong><span>{client.staff_code ?? "—"}</span></td>
                  <td><Link href={`/staff/client/${client.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <div className="ops-empty-large">No clients match this search.</div>}
        </div>
      </section>
    </div>
  );
}
