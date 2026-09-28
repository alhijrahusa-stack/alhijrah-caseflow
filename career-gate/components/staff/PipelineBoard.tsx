"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { OperationsClient, PipelineStage } from "@/lib/operations";

function shiftPeriod(hours: string | null) {
  if (!hours) return "Unspecified";
  const m = hours.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
  if (!m) return "Unspecified";
  const hour = Number(m[1]);
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

async function operation(body: Record<string, unknown>) {
  const res = await fetch("/api/staff/operations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data;
}

function ClientCard({ client, stages, onMove, busy }: {
  client: OperationsClient;
  stages: PipelineStage[];
  onMove: (client: OperationsClient, stage: string) => void;
  busy: boolean;
}) {
  return (
    <article
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/client-id", client.id);
      }}
      className="ops-client-card"
    >
      <div className="ops-client-head">
        <div className="min-w-0">
          <h3>{client.full_name}</h3>
          <code>{client.ref}</code>
        </div>
        {client.payment_status === "paid" && <span className="ops-paid">Paid ${Number(client.fee_amount ?? 0).toFixed(0)}</span>}
      </div>
      <div className="ops-client-meta">
        <span>{client.site_code ?? "No site"}</span>
        <span>{client.shift_code ?? "No shift"}</span>
        <span>{client.assigned_name ?? "Unassigned"}</span>
      </div>
      <p className="ops-next"><span>Next</span>{client.next_step}</p>
      <div className="ops-client-actions">
        <Link href={`/staff/client/${client.id}`}>Open file</Link>
        <select
          aria-label={`Move ${client.full_name}`}
          value={client.pipeline_stage}
          disabled={busy}
          onChange={(e) => onMove(client, e.target.value)}
          className="ops-select"
        >
          {stages.map((s) => <option key={s.key} value={s.key}>{s.label_en}</option>)}
        </select>
      </div>
    </article>
  );
}

export function PipelineBoard({ stages, clients }: { stages: PipelineStage[]; clients: OperationsClient[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(clients);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"pipeline" | "location">("pipeline");

  useEffect(() => setRows(clients), [clients]);

  async function move(client: OperationsClient, nextStage: string) {
    if (nextStage === client.pipeline_stage) return;
    const previous = client.pipeline_stage;
    setBusyId(client.id);
    setError(null);
    setRows((current) => current.map((x) => x.id === client.id ? { ...x, pipeline_stage: nextStage } : x));
    try {
      await operation({ operation: "move_stage", client_id: client.id, stage: nextStage });
      router.refresh();
    } catch (e) {
      setRows((current) => current.map((x) => x.id === client.id ? { ...x, pipeline_stage: previous } : x));
      setError(e instanceof Error ? e.message : "Unable to move client");
    } finally {
      setBusyId(null);
    }
  }

  const shiftGroups = useMemo(() => {
    const map = new Map<string, OperationsClient[]>();
    for (const client of rows) {
      const period = shiftPeriod(client.shift_hours);
      const key = `${client.site_name ?? client.site_code ?? "No location"} · ${period}`;
      const group = map.get(key) ?? [];
      group.push(client);
      map.set(key, group);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  return (
    <div className="ops-page">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · OPERATIONS</p>
          <h1>Candidate Pipeline</h1>
          <p>ملف واحد لكل عميل · نقل مرحلي بدون إنشاء نسخ مكررة</p>
        </div>
        <div className="ops-segmented" role="tablist">
          <button data-active={view === "pipeline"} onClick={() => setView("pipeline")}>Pipeline</button>
          <button data-active={view === "location"} onClick={() => setView("location")}>Location & Shift</button>
        </div>
      </header>

      {error && <div className="ops-error" role="alert">{error}</div>}

      {view === "pipeline" ? (
        <div className="ops-kanban" data-testid="pipeline-board">
          {stages.map((stage) => {
            const group = rows.filter((c) => c.pipeline_stage === stage.key);
            return (
              <section
                key={stage.key}
                className="ops-column"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/client-id");
                  const client = rows.find((x) => x.id === id);
                  if (client) void move(client, stage.key);
                }}
              >
                <div className="ops-column-head">
                  <span className="ops-stage-dot" style={{ background: stage.color }} />
                  <div><strong>{stage.label_en}</strong><span dir="rtl">{stage.label_ar}</span></div>
                  <b>{group.length}</b>
                </div>
                <div className="ops-column-list">
                  {group.map((client) => <ClientCard key={client.id} client={client} stages={stages} onMove={move} busy={busyId === client.id} />)}
                  {!group.length && <div className="ops-empty">Drop client here</div>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="ops-shift-grid">
          {shiftGroups.map(([name, group]) => (
            <section key={name} className="ops-glass-card">
              <div className="ops-shift-head"><h2>{name}</h2><span>{group.length} clients</span></div>
              <div className="ops-shift-list">
                {group.map((client) => (
                  <Link href={`/staff/client/${client.id}`} key={client.id} className="ops-shift-row">
                    <div><strong>{client.full_name}</strong><code>{client.ref}</code></div>
                    <div><span>{client.shift_days ?? "—"}</span><span>{client.shift_hours ?? "—"}</span></div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
