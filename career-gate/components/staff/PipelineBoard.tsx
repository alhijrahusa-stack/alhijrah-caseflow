"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { DispatchPeriod, OperationsClient, PipelineStage } from "@/lib/operations";

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
      data-saving={busy || undefined}
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

type LocationGroup = {
  key: string;
  siteCode: string;
  siteName: string;
  siteAddress: string | null;
  morning: OperationsClient[];
  evening: OperationsClient[];
  night: OperationsClient[];
  needs_manual_review: OperationsClient[];
};

const PERIODS: Array<{ value: DispatchPeriod; label: string }> = [
  { value: "morning", label: "Morning" },
  { value: "evening", label: "Evening" },
  { value: "night", label: "Night" },
  { value: "needs_manual_review", label: "Needs manual review" },
];

function DispatchClient({ client, canManage, busy, onDispatch }: {
  client: OperationsClient;
  canManage: boolean;
  busy: boolean;
  onDispatch: (client: OperationsClient, period: DispatchPeriod, mode: "auto" | "manual") => void;
}) {
  const period = client.shift_period ?? "needs_manual_review";
  return (
    <article className="ops-dispatch-client" data-saving={busy || undefined}>
      <div className="ops-dispatch-client-head">
        <div className="min-w-0">
          <Link href={`/staff/client/${client.id}`} className="ops-dispatch-open">
            <strong>{client.full_name}</strong>
            <code>{client.ref}</code>
          </Link>
        </div>
        {client.dispatch_mode === "manual"
          ? <span className="ops-manual-badge">Manual Override</span>
          : client.auto_dispatched_at && <span className="ops-auto-badge">Auto-Dispatched</span>}
      </div>
      <div className="ops-dispatch-meta">
        <span>{client.shift_code ?? "—"}</span>
        <span dir="auto">{client.shift_days ?? "—"}</span>
        <span>{client.shift_hours ?? "—"}</span>
      </div>
      <div className="ops-dispatch-footer">
        <span>{client.assigned_name ?? "Unassigned"}</span>
        {client.payment_status === "paid" && <b>Paid ${Number(client.fee_amount ?? 0).toFixed(0)}</b>}
      </div>
      {canManage && (
        <div className="ops-dispatch-controls">
          <select
            className="ops-select"
            aria-label={`Dispatch ${client.full_name}`}
            value={period}
            disabled={busy}
            onChange={(e) => onDispatch(client, e.target.value as DispatchPeriod, "manual")}
          >
            {PERIODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          {client.dispatch_mode === "manual" && (
            <button type="button" disabled={busy} onClick={() => onDispatch(client, period, "auto")} className="ops-auto-reset">
              Restore auto
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function DispatchLane({ title, subtitle, clients, tone, canManage, busyId, onDispatch }: {
  title: string;
  subtitle: string;
  clients: OperationsClient[];
  tone: DispatchPeriod;
  canManage: boolean;
  busyId: string | null;
  onDispatch: (client: OperationsClient, period: DispatchPeriod, mode: "auto" | "manual") => void;
}) {
  return (
    <section className="ops-dispatch-lane" data-tone={tone}>
      <header>
        <div><strong>{title}</strong><span>{subtitle}</span></div>
        <b>{clients.length}</b>
      </header>
      <div className="ops-dispatch-list">
        {clients.map((client) => (
          <DispatchClient
            key={client.id}
            client={client}
            canManage={canManage}
            busy={busyId === client.id}
            onDispatch={onDispatch}
          />
        ))}
        {!clients.length && <div className="ops-dispatch-empty">No clients in this lane.</div>}
      </div>
    </section>
  );
}

export function PipelineBoard({ stages, clients, canManage = false }: {
  stages: PipelineStage[];
  clients: OperationsClient[];
  canManage?: boolean;
}) {
  const [rows, setRows] = useState(clients);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"pipeline" | "location">("pipeline");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRows((current) => clients.map((incoming) => {
        if (incoming.id !== busyId) return incoming;
        return current.find((row) => row.id === incoming.id) ?? incoming;
      }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [busyId, clients]);

  async function move(client: OperationsClient, nextStage: string) {
    if (nextStage === client.pipeline_stage || busyId === client.id) return;
    const previous = client.pipeline_stage;
    setBusyId(client.id);
    setError(null);
    setRows((current) => current.map((x) => x.id === client.id ? { ...x, pipeline_stage: nextStage } : x));
    try {
      await operation({ operation: "move_stage", client_id: client.id, stage: nextStage, expected_stage: previous });
    } catch (e) {
      setRows((current) => current.map((x) => x.id === client.id ? { ...x, pipeline_stage: previous } : x));
      setError(e instanceof Error ? e.message : "Unable to move client");
    } finally {
      setBusyId(null);
    }
  }

  async function setDispatch(client: OperationsClient, period: DispatchPeriod, mode: "auto" | "manual") {
    if (busyId === client.id) return;
    const previous = client;
    setBusyId(client.id);
    setError(null);
    if (mode === "manual") {
      setRows((current) => current.map((row) => row.id === client.id ? {
        ...row,
        shift_period: period,
        dispatch_mode: "manual",
        auto_dispatched_at: null,
        manual_dispatch_at: new Date().toISOString(),
      } : row));
    }
    try {
      const data = await operation({ operation: "set_dispatch", client_id: client.id, mode, shift_period: mode === "manual" ? period : null });
      const dispatch = data?.dispatch;
      if (dispatch) {
        setRows((current) => current.map((row) => row.id === client.id ? {
          ...row,
          shift_period: dispatch.shift_period,
          dispatch_mode: dispatch.dispatch_mode,
          auto_dispatched_at: dispatch.auto_dispatched_at,
          manual_dispatch_at: dispatch.manual_dispatch_at,
          manual_dispatch_by: dispatch.manual_dispatch_by,
        } : row));
      }
    } catch (e) {
      setRows((current) => current.map((row) => row.id === client.id ? previous : row));
      setError(e instanceof Error ? e.message : "Unable to update dispatch");
    } finally {
      setBusyId(null);
    }
  }

  const locations = useMemo<LocationGroup[]>(() => {
    const map = new Map<string, LocationGroup>();
    for (const client of rows) {
      const key = client.site_code ?? "no-location";
      const current = map.get(key) ?? {
        key,
        siteCode: client.site_code ?? "NO SITE",
        siteName: client.site_name ?? "Location not selected",
        siteAddress: client.site_address,
        morning: [],
        evening: [],
        night: [],
        needs_manual_review: [],
      };
      const period: DispatchPeriod = client.shift_period ?? "needs_manual_review";
      current[period].push(client);
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => `${a.siteName} ${a.siteCode}`.localeCompare(`${b.siteName} ${b.siteCode}`));
  }, [rows]);

  return (
    <div className="ops-page">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · OPERATIONS</p>
          <h1>Candidate Pipeline</h1>
          <p>ملف واحد لكل عميل · نقل مرحلي بدون إنشاء نسخ مكررة</p>
        </div>
        <div className="ops-segmented" role="tablist" aria-label="Pipeline view">
          <button type="button" role="tab" aria-selected={view === "pipeline"} data-active={view === "pipeline"} onClick={() => setView("pipeline")}>Pipeline</button>
          <button type="button" role="tab" aria-selected={view === "location"} data-active={view === "location"} onClick={() => setView("location")}>Location &amp; Shift</button>
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
        <div className="ops-location-stack" data-testid="location-dispatcher">
          {locations.map((location) => (
            <article key={location.key} className="ops-location-board">
              <header className="ops-location-head">
                <div>
                  <p className="ops-kicker">AMAZON LOCATION</p>
                  <h2>{location.siteName}</h2>
                  <span>{location.siteCode}{location.siteAddress ? ` · ${location.siteAddress}` : ""}</span>
                </div>
                <div className="ops-location-total">
                  <strong>{location.morning.length + location.evening.length + location.night.length + location.needs_manual_review.length}</strong>
                  <span>clients</span>
                </div>
              </header>
              <div className="ops-location-lanes ops-location-lanes-four">
                <DispatchLane title="Morning" subtitle="القائمة الصباحية" clients={location.morning} tone="morning" canManage={canManage} busyId={busyId} onDispatch={setDispatch} />
                <DispatchLane title="Evening" subtitle="القائمة المسائية" clients={location.evening} tone="evening" canManage={canManage} busyId={busyId} onDispatch={setDispatch} />
                <DispatchLane title="Night" subtitle="القائمة الليلية" clients={location.night} tone="night" canManage={canManage} busyId={busyId} onDispatch={setDispatch} />
                <DispatchLane title="Needs Manual Review" subtitle="مراجعة التصنيف" clients={location.needs_manual_review} tone="needs_manual_review" canManage={canManage} busyId={busyId} onDispatch={setDispatch} />
              </div>
            </article>
          ))}
          {!locations.length && <div className="ops-glass-card ops-empty-large">No clients are available for location dispatch.</div>}
        </div>
      )}
    </div>
  );
}
