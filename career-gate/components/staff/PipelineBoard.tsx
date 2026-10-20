"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { LocationShiftTelemetry } from "@/components/staff/LocationShiftTelemetry";
import { useTargetedMutation } from "@/components/staff/realtime/useTargetedMutation";
import type { PipelineStage } from "@/lib/operations";
import type { LocationLanes, PipelineBoardData, PipelineCard, PipelineColumn } from "@/lib/operational-pipeline";
import type { DispatchPeriod } from "@/lib/pipeline-period";

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

async function readSlice<T>(query: string): Promise<T> {
  const res = await fetch(`/api/staff/pipeline?${query}`, { headers: { accept: "application/json" } });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data as T;
}

/** Appends a fetched batch, dropping cards already shown (a concurrent change can shift offsets). */
function appendBatch(column: PipelineColumn, batch: PipelineColumn): PipelineColumn {
  const seen = new Set(column.cards.map((c) => c.id));
  return { cards: [...column.cards, ...batch.cards.filter((c) => !seen.has(c.id))], total: batch.cards.length ? batch.total : column.total };
}

function ShowMore({ column, loading, onMore, testId }: { column: PipelineColumn; loading: boolean; onMore: () => void; testId: string }) {
  const hidden = column.total - column.cards.length;
  if (hidden <= 0) return null;
  return (
    <button type="button" onClick={onMore} disabled={loading} data-testid={testId} aria-busy={loading}
      className="w-full rounded-xl border border-amber-300/30 bg-amber-300/[.06] px-3 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-300/10 disabled:opacity-60">
      {loading ? "Loading…" : `Show more · ${hidden} hidden`}
    </button>
  );
}

function ClientCard({ client, stages, onMove, busy }: {
  client: PipelineCard;
  stages: PipelineStage[];
  onMove: (client: PipelineCard, stage: string) => void;
  busy: boolean;
}) {
  return (
    <article
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/client-id", client.id);
        e.dataTransfer.setData("text/from-stage", client.pipeline_stage);
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

type StaffOption = { id: string; display_name: string };

function DispatchClient({ client, staff, canAssign, onAssign, busy, pulsing }: { client: PipelineCard; staff: StaffOption[]; canAssign: boolean; onAssign: (client: PipelineCard, staffId: string | null) => void; busy: boolean; pulsing: boolean }) {
  return <article className={`ops-dispatch-client min-w-0 !p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(242,142,34,.12)] ${pulsing ? "cg-assignment-pulse" : ""}`}>
    <div className="ops-dispatch-client-head">
      <div className="min-w-0"><Link href={`/staff/client/${client.id}`} className="block truncate text-base font-bold text-white hover:text-orange-300">{client.full_name}</Link>
        <code>{client.ref}</code></div>
      {client.auto_dispatched_at && <span className="ops-auto-badge">Auto-Dispatched</span>}
    </div>
    <div className="ops-dispatch-meta text-sm">
      <span>{client.shift_name ?? client.shift_code ?? "—"}</span>
      <span>{client.shift_days ?? "—"}</span>
      <span>{client.shift_hours ?? "—"}</span>
    </div>
    <div className="ops-dispatch-footer flex flex-wrap items-center gap-2">
      {canAssign ? <select aria-label={`Assign ${client.full_name}`} value={client.assigned_staff ?? ""} disabled={busy} onChange={e => onAssign(client, e.target.value || null)} className="ops-select min-w-32 !text-sm">
        <option value="">Unassigned</option>{staff.map(x => <option value={x.id} key={x.id}>{x.display_name}</option>)}
      </select> : <span>{client.assigned_name ?? "Unassigned"}</span>}
      <Link href={`/staff/client/${client.id}`} className="rounded-lg border border-orange-300/25 px-3 py-2 text-sm font-semibold text-orange-200">Open file</Link>
      {client.payment_status === "paid" && <b>Paid ${Number(client.fee_amount ?? 0).toFixed(0)}</b>}
    </div>
  </article>;
}

const LANES: { period: DispatchPeriod; title: string; subtitle: string }[] = [
  { period: "morning", title: "Morning", subtitle: "القائمة الصباحية" },
  { period: "evening", title: "Evening", subtitle: "القائمة المسائية" },
  { period: "night", title: "Night", subtitle: "القائمة الليلية" },
  { period: "needs_manual_review", title: "Needs review", subtitle: "يتطلب تصنيف يدوي" },
];

function DispatchLane({ title, subtitle, column, tone, staff, canAssign, onAssign, busyId, lastAssignedId, loading, onMore }: {
  title: string;
  subtitle: string;
  column: PipelineColumn;
  tone: DispatchPeriod;
  staff: StaffOption[]; canAssign: boolean; onAssign: (client: PipelineCard, staffId: string | null) => void; busyId: string | null; lastAssignedId: string | null;
  loading: boolean; onMore: () => void;
}) {
  return (
    <section className="ops-dispatch-lane" data-tone={tone}>
      <header>
        <div><strong>{title}</strong><span>{subtitle}</span></div>
        <b>{column.total}</b>
      </header>
      <div className="ops-dispatch-list">
        {column.cards.map((client) => <DispatchClient key={client.id} client={client} staff={staff} canAssign={canAssign} onAssign={onAssign} busy={busyId === client.id} pulsing={lastAssignedId === client.id} />)}
        <ShowMore column={column} loading={loading} onMore={onMore} testId="lane-show-more" />
        {!column.total && <div className="ops-dispatch-empty">No clients in this lane.</div>}
      </div>
    </section>
  );
}

function withAssignment(card: PipelineCard, id: string, staffId: string | null, name: string | null): PipelineCard {
  return card.id === id ? { ...card, assigned_staff: staffId, assigned_name: name } : card;
}

export function PipelineBoard({ data, staff, canAssign }: { data: PipelineBoardData; staff: StaffOption[]; canAssign: boolean }) {
  const onMutated = useTargetedMutation();
  const [columns, setColumns] = useState(data.columns);
  const [seen, setSeen] = useState(data);
  const [locations, setLocations] = useState<LocationLanes[] | null>(null);
  const [locationsStale, setLocationsStale] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"pipeline" | "location">("pipeline");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [lastAssignedId, setLastAssignedId] = useState<string | null>(null);

  if (seen !== data) {
    // A server render supersedes every optimistic change and every loaded batch.
    setSeen(data);
    setColumns(data.columns);
    setLocationsStale(true);
  }

  const loadLocations = useCallback(async () => {
    setLoadingKey("locations");
    setError(null);
    try {
      const body = await readSlice<{ locations: LocationLanes[] }>("view=locations");
      setLocations(body.locations);
      setLocationsStale(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load locations");
    } finally {
      setLoadingKey(null);
    }
  }, []);

  // The dispatcher loads when it is first opened, and again on reopening after
  // a server render has made the loaded lanes stale.
  function showView(next: "pipeline" | "location") {
    setView(next);
    if (next === "location" && (locations === null || locationsStale) && loadingKey !== "locations") void loadLocations();
  }

  async function moreForStage(stage: string) {
    const column = columns[stage];
    if (!column) return;
    setLoadingKey(`stage:${stage}`);
    setError(null);
    try {
      const batch = await readSlice<PipelineColumn>(`stage=${encodeURIComponent(stage)}&offset=${column.cards.length}`);
      setColumns((current) => ({ ...current, [stage]: appendBatch(current[stage] ?? { cards: [], total: 0 }, batch) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load more clients");
    } finally {
      setLoadingKey(null);
    }
  }

  async function moreForLane(location: LocationLanes, period: DispatchPeriod) {
    const lane = location.lanes[period];
    const key = `lane:${location.key}:${period}`;
    setLoadingKey(key);
    setError(null);
    try {
      const batch = await readSlice<PipelineColumn>(`site=${encodeURIComponent(location.key)}&period=${period}&offset=${lane.cards.length}`);
      setLocations((current) => current?.map((l) => l.key === location.key ? { ...l, lanes: { ...l.lanes, [period]: appendBatch(l.lanes[period], batch) } } : l) ?? current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load more clients");
    } finally {
      setLoadingKey(null);
    }
  }

  async function move(client: PipelineCard, nextStage: string) {
    const previous = client.pipeline_stage;
    if (nextStage === previous) return;
    const snapshot = columns;
    setBusyId(client.id);
    setError(null);
    setColumns((current) => {
      const from = current[previous];
      const to = current[nextStage];
      const next = { ...current };
      if (from) next[previous] = { cards: from.cards.filter((c) => c.id !== client.id), total: Math.max(0, from.total - 1) };
      if (to) next[nextStage] = { cards: [{ ...client, pipeline_stage: nextStage }, ...to.cards.filter((c) => c.id !== client.id)], total: to.total + 1 };
      return next;
    });
    try {
      await operation({ operation: "move_stage", client_id: client.id, stage: nextStage });
      onMutated("move_stage", client.id);
    } catch (e) {
      setColumns(snapshot);
      setError(e instanceof Error ? e.message : "Unable to move client");
    } finally {
      setBusyId(null);
    }
  }

  async function assign(client: PipelineCard, staffId: string | null) {
    if (client.assigned_staff === staffId) return;
    const name = staff.find((s) => s.id === staffId)?.display_name ?? null;
    const snapshot = locations;
    setBusyId(client.id);
    setError(null);
    setLocations((current) => current?.map((l) => ({
      ...l,
      lanes: Object.fromEntries(Object.entries(l.lanes).map(([period, lane]) => [period, { ...lane, cards: lane.cards.map((c) => withAssignment(c, client.id, staffId, name)) }])) as LocationLanes["lanes"],
    })) ?? current);
    try {
      await operation({ operation: "reassign_client", client_id: client.id, staff_id: staffId, task_ids: [] });
      onMutated("reassign_client", client.id);
      // Lane totals and the telemetry come from the server; reload the lanes so
      // the dispatcher matches the refreshed board.
      void loadLocations();
      setLastAssignedId(client.id);
      window.setTimeout(() => setLastAssignedId((v) => (v === client.id ? null : v)), 1400);
      if (voiceEnabled && staffId && name && "speechSynthesis" in window) {
        const phrases = [`تم إسناد الملف بنجاح إلى الأستاذ ${name}.`, `أهلاً أستاذ ${name}، نتمنى لك التوفيق في متابعة الملف.`, `تم تأكيد التعيين، شكراً أستاذ ${name}.`];
        const utterance = new SpeechSynthesisUtterance(phrases[Math.floor(Math.random() * phrases.length)]);
        utterance.lang = "ar-SA";
        utterance.rate = 0.95;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      }
    } catch (e) {
      setLocations(snapshot);
      setError(e instanceof Error ? e.message : "Assignment failed");
    } finally {
      setBusyId(null);
    }
  }

  function findCard(id: string, stage: string) {
    return columns[stage]?.cards.find((c) => c.id === id) ?? null;
  }

  return (
    <div className="ops-page">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · OPERATIONS</p>
          <h1>Candidate Pipeline</h1>
          <p>ملف واحد لكل عميل · نقل مرحلي بدون إنشاء نسخ مكررة</p>
        </div>
        <div className="ops-segmented" role="group" aria-label="Pipeline views">
          <button type="button" data-active={view === "pipeline"} aria-pressed={view === "pipeline"} onClick={() => showView("pipeline")}>Pipeline</button>
          <button type="button" data-active={view === "location"} aria-pressed={view === "location"} onClick={() => showView("location")}>Location & Shift</button>
        </div>
      </header>

      {error && <div className="ops-error" role="alert">{error}</div>}
      <LocationShiftTelemetry locations={data.telemetry.locations} total={data.telemetry.total} assigned={data.telemetry.assigned} />
      <div className="flex items-center justify-end"><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-amber-300/20 bg-white/[.04] px-3 py-2 text-sm text-slate-200"><input type="checkbox" checked={voiceEnabled} onChange={e => setVoiceEnabled(e.target.checked)} /> Arabic voice confirmations</label></div>

      {view === "pipeline" ? (
        <div className="ops-kanban" data-testid="pipeline-board" tabIndex={0} role="region" aria-label="Pipeline columns">
          {data.stages.map((stage) => {
            const column = columns[stage.key] ?? { cards: [], total: 0 };
            return (
              <section
                key={stage.key}
                className="ops-column"
                data-stage={stage.key}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDrop={(e) => {
                  e.preventDefault();
                  const client = findCard(e.dataTransfer.getData("text/client-id"), e.dataTransfer.getData("text/from-stage"));
                  if (client) void move(client, stage.key);
                }}
              >
                <div className="ops-column-head">
                  <span className="ops-stage-dot" style={{ background: stage.color }} />
                  <div><strong>{stage.label_en}</strong><span dir="rtl">{stage.label_ar}</span></div>
                  <b data-testid="column-total">{column.total}</b>
                </div>
                <div className="ops-column-list">
                  {column.cards.map((client) => <ClientCard key={client.id} client={client} stages={data.stages} onMove={move} busy={busyId === client.id} />)}
                  <ShowMore column={column} loading={loadingKey === `stage:${stage.key}`} onMore={() => void moreForStage(stage.key)} testId="column-show-more" />
                  {!column.total && <div className="ops-empty">Drop client here</div>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="ops-location-stack" data-testid="location-dispatcher" aria-busy={loadingKey === "locations"}>
          {locations === null && loadingKey === "locations" && <div className="ops-glass-card ops-empty-large">Loading locations…</div>}
          {(locations ?? []).map((location) => (
            <article key={location.key} className="ops-location-board">
              <header className="ops-location-head">
                <div>
                  <p className="ops-kicker">AMAZON LOCATION</p>
                  <h2>{location.siteName}</h2>
                  <span>{location.siteCode}{location.siteAddress ? ` · ${location.siteAddress}` : ""}</span>
                </div>
                <div className="ops-location-total"><strong>{location.total}</strong><span>clients</span></div>
              </header>
              <div className="ops-location-lanes ops-location-lanes-four">
                {LANES.map((lane) => (
                  <DispatchLane
                    key={lane.period}
                    title={lane.title}
                    subtitle={lane.subtitle}
                    column={location.lanes[lane.period]}
                    tone={lane.period}
                    staff={staff}
                    canAssign={canAssign}
                    onAssign={assign}
                    busyId={busyId}
                    lastAssignedId={lastAssignedId}
                    loading={loadingKey === `lane:${location.key}:${lane.period}`}
                    onMore={() => void moreForLane(location, lane.period)}
                  />
                ))}
              </div>
            </article>
          ))}
          {locations !== null && !locations.length && <div className="ops-glass-card ops-empty-large">No clients are available for location dispatch.</div>}
        </div>
      )}
    </div>
  );
}
