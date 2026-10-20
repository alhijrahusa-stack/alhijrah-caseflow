"use client";

import Link from "next/link";
import { LocationShiftTelemetry } from "@/components/staff/LocationShiftTelemetry";
import { useMemo, useState } from "react";
import type { DispatchPeriod, PipelineClient, PipelineStage } from "@/lib/operations";
import { useTargetedMutation } from "@/components/staff/realtime/useTargetedMutation";

function legacyShiftPeriod(hours: string | null): DispatchPeriod {
  if (!hours) return "needs_manual_review";
  const meridiem = hours.match(/([0-9]{1,2}):[0-9]{2}\s*(ص|م|AM|PM|am|pm)?/);
  if (!meridiem) return "needs_manual_review";
  let hour = Number(meridiem[1]);
  const marker = (meridiem[2] ?? "").toLowerCase();
  if (marker === "م" || marker === "pm") {
    if (hour < 12) hour += 12;
  } else if ((marker === "ص" || marker === "am") && hour === 12) {
    hour = 0;
  }
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 22) return "evening";
  if (hour >= 0 && hour <= 23) return "night";
  return "needs_manual_review";
}

function normalizedPeriod(client: PipelineClient): DispatchPeriod {
  if(client.shift_code==="night") return "night";
  if(client.shift_code==="morning") return "morning";
  const value = client.shift_period;
  if (value === "morning" || value === "evening" || value === "night" || value === "needs_manual_review") return value;
  if (value === "unspecified") return "needs_manual_review";
  return legacyShiftPeriod(client.shift_hours);
}

/** Cards mounted per column or lane before the user asks for more; counts always cover every client. */
const COLUMN_BATCH = 30;
const LANE_BATCH = 24;

function ShowMore({ hidden, step, onMore, testId }: { hidden: number; step: number; onMore: () => void; testId: string }) {
  if (hidden <= 0) return null;
  return (
    <button type="button" onClick={onMore} data-testid={testId}
      className="w-full rounded-xl border border-amber-300/30 bg-amber-300/[.06] px-3 py-2 text-sm font-semibold text-amber-200 transition hover:bg-amber-300/10">
      Show {Math.min(step, hidden)} more · {hidden} hidden
    </button>
  );
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
  client: PipelineClient;
  stages: PipelineStage[];
  onMove: (client: PipelineClient, stage: string) => void;
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

type LocationGroup = {
  key: string;
  siteCode: string;
  siteName: string;
  siteAddress: string | null;
  morning: PipelineClient[];
  evening: PipelineClient[];
  night: PipelineClient[];
  needs_manual_review: PipelineClient[];
};

type StaffOption={id:string;display_name:string};
function DispatchClient({client,staff,canAssign,onAssign,busy,pulsing}:{client:PipelineClient;staff:StaffOption[];canAssign:boolean;onAssign:(client:PipelineClient,staffId:string|null)=>void;busy:boolean;pulsing:boolean}){
 return <article className={`ops-dispatch-client min-w-0 !p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(242,142,34,.12)] ${pulsing?"cg-assignment-pulse":""}`}>
   <div className="ops-dispatch-client-head">
     <div className="min-w-0"><Link href={`/staff/client/${client.id}`} className="block truncate text-base font-bold text-white hover:text-orange-300">{client.full_name}</Link>
     <code>{client.ref}</code></div>
     {client.auto_dispatched_at&&<span className="ops-auto-badge">Auto-Dispatched</span>}
   </div>
   <div className="ops-dispatch-meta text-sm">
    <span>{client.shift_name??client.shift_code??"—"}</span>
    <span>{client.shift_days??"—"}</span>
    <span>{client.shift_hours??"—"}</span>
   </div>
   <div className="ops-dispatch-footer flex flex-wrap items-center gap-2">
    {canAssign?<select aria-label={`Assign ${client.full_name}`} value={client.assigned_staff??""} disabled={busy} onChange={e=>onAssign(client,e.target.value||null)} className="ops-select min-w-32 !text-sm">
      <option value="">Unassigned</option>{staff.map(x=><option value={x.id} key={x.id}>{x.display_name}</option>)}
    </select>:<span>{client.assigned_name??"Unassigned"}</span>}
    <Link href={`/staff/client/${client.id}`} className="rounded-lg border border-orange-300/25 px-3 py-2 text-sm font-semibold text-orange-200">Open file</Link>
    {client.payment_status==="paid"&&<b>Paid ${Number(client.fee_amount??0).toFixed(0)}</b>}
   </div>
 </article>;
}

function DispatchLane({ title, subtitle, clients, tone, staff, canAssign, onAssign, busyId, lastAssignedId }: {
  title: string;
  subtitle: string;
  clients: PipelineClient[];
  tone: "morning" | "evening" | "night" | "needs_manual_review";
  staff: StaffOption[]; canAssign:boolean; onAssign:(client:PipelineClient,staffId:string|null)=>void; busyId:string|null; lastAssignedId:string|null;
}) {
  const [limit, setLimit] = useState(LANE_BATCH);
  return (
    <section className="ops-dispatch-lane" data-tone={tone}>
      <header>
        <div><strong>{title}</strong><span>{subtitle}</span></div>
        <b>{clients.length}</b>
      </header>
      <div className="ops-dispatch-list">
        {clients.slice(0, limit).map((client) => <DispatchClient key={client.id} client={client} staff={staff} canAssign={canAssign} onAssign={onAssign} busy={busyId===client.id} pulsing={lastAssignedId===client.id}/>)}
        <ShowMore hidden={clients.length - limit} step={LANE_BATCH} onMore={() => setLimit((n) => n + LANE_BATCH)} testId="lane-show-more" />
        {!clients.length && <div className="ops-dispatch-empty">No clients in this lane.</div>}
      </div>
    </section>
  );
}

export function PipelineBoard({ stages, clients, staff, canAssign }: { stages: PipelineStage[]; clients: PipelineClient[]; staff:StaffOption[]; canAssign:boolean }) {
  const onMutated = useTargetedMutation();
  const [rows, setRows] = useState(clients);
  const [seen, setSeen] = useState(clients);
  const [limits, setLimits] = useState<Record<string, number>>({});
  if (seen !== clients) {
    // A server render supersedes every optimistic row.
    setSeen(clients);
    setRows(clients);
  }
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"pipeline" | "location">("pipeline");
  const [voiceEnabled,setVoiceEnabled]=useState(false);
  const [lastAssignedId,setLastAssignedId]=useState<string|null>(null);


  async function move(client: PipelineClient, nextStage: string) {
    if (nextStage === client.pipeline_stage) return;
    const previous = client.pipeline_stage;
    setBusyId(client.id);
    setError(null);
    setRows((current) => current.map((x) => x.id === client.id ? { ...x, pipeline_stage: nextStage } : x));
    try {
      await operation({ operation: "move_stage", client_id: client.id, stage: nextStage });
      onMutated("move_stage", String(client.id));
    } catch (e) {
      setRows((current) => current.map((x) => x.id === client.id ? { ...x, pipeline_stage: previous } : x));
      setError(e instanceof Error ? e.message : "Unable to move client");
    } finally {
      setBusyId(null);
    }
  }

  async function assign(client:PipelineClient,staffId:string|null){
    if(client.assigned_staff===staffId)return;
    setBusyId(client.id);setError(null);
    const oldId=client.assigned_staff,oldName=client.assigned_name;
    setRows(x=>x.map(row=>row.id===client.id?{...row,assigned_staff:staffId,assigned_name:staff.find(s=>s.id===staffId)?.display_name??null}:row));
    try{
      await operation({operation:"reassign_client",client_id:client.id,staff_id:staffId,task_ids:[]});
      onMutated("reassign_client",client.id);
      setLastAssignedId(client.id);
      window.setTimeout(()=>setLastAssignedId(v=>v===client.id?null:v),1400);
      if(voiceEnabled && staffId && "speechSynthesis" in window){
        const name=staff.find(s=>s.id===staffId)?.display_name;
        if(name){const phrases=[`تم إسناد الملف بنجاح إلى الأستاذ ${name}.`,`أهلاً أستاذ ${name}، نتمنى لك التوفيق في متابعة الملف.`,`تم تأكيد التعيين، شكراً أستاذ ${name}.`];
          const utterance=new SpeechSynthesisUtterance(phrases[Math.floor(Math.random()*phrases.length)]);utterance.lang="ar-SA";utterance.rate=0.95;window.speechSynthesis.cancel();window.speechSynthesis.speak(utterance);}
      }
    }catch(e){
      setRows(x=>x.map(row=>row.id===client.id?{...row,assigned_staff:oldId,assigned_name:oldName}:row));
      setError(e instanceof Error?e.message:"Assignment failed");
    }finally{setBusyId(null);}
  }

  const byStage = useMemo(() => {
    const map = new Map<string, PipelineClient[]>();
    for (const client of rows) {
      const list = map.get(client.pipeline_stage);
      if (list) list.push(client);
      else map.set(client.pipeline_stage, [client]);
    }
    return map;
  }, [rows]);

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
      current[normalizedPeriod(client)].push(client);
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
        <div className="ops-segmented" role="tablist" aria-label="Pipeline views">
          <button type="button" data-active={view === "pipeline"} onClick={() => setView("pipeline")}>Pipeline</button>
          <button type="button" data-active={view === "location"} onClick={() => setView("location")}>Location & Shift</button>
        </div>
      </header>

      {error && <div className="ops-error" role="alert">{error}</div>}
      <LocationShiftTelemetry clients={rows} periodOf={normalizedPeriod}/>
      <div className="flex items-center justify-end"><label className="flex cursor-pointer items-center gap-2 rounded-xl border border-amber-300/20 bg-white/[.04] px-3 py-2 text-sm text-slate-200"><input type="checkbox" checked={voiceEnabled} onChange={e=>setVoiceEnabled(e.target.checked)}/> Arabic voice confirmations</label></div>

      {view === "pipeline" ? (
        <div className="ops-kanban" data-testid="pipeline-board">
          {stages.map((stage) => {
            const group = byStage.get(stage.key) ?? [];
            const limit = limits[stage.key] ?? COLUMN_BATCH;
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
                  {group.slice(0, limit).map((client) => <ClientCard key={client.id} client={client} stages={stages} onMove={move} busy={busyId === client.id} />)}
                  <ShowMore hidden={group.length - limit} step={COLUMN_BATCH} onMore={() => setLimits((current) => ({ ...current, [stage.key]: limit + COLUMN_BATCH }))} testId="column-show-more" />
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
                <div className="ops-location-total"><strong>{location.morning.length + location.evening.length + location.night.length + location.needs_manual_review.length}</strong><span>clients</span></div>
              </header>
              <div className="ops-location-lanes ops-location-lanes-four">
                <DispatchLane title="Morning" subtitle="القائمة الصباحية" clients={location.morning} tone="morning" staff={staff} canAssign={canAssign} onAssign={assign} busyId={busyId} lastAssignedId={lastAssignedId} />
                <DispatchLane title="Evening" subtitle="القائمة المسائية" clients={location.evening} tone="evening" staff={staff} canAssign={canAssign} onAssign={assign} busyId={busyId} lastAssignedId={lastAssignedId} />
                <DispatchLane title="Night" subtitle="القائمة الليلية" clients={location.night} tone="night" staff={staff} canAssign={canAssign} onAssign={assign} busyId={busyId} lastAssignedId={lastAssignedId} />
                <DispatchLane title="Needs review" subtitle="يتطلب تصنيف يدوي" clients={location.needs_manual_review} tone="needs_manual_review" staff={staff} canAssign={canAssign} onAssign={assign} busyId={busyId} lastAssignedId={lastAssignedId} />
              </div>
            </article>
          ))}
          {!locations.length && <div className="ops-glass-card ops-empty-large">No clients are available for location dispatch.</div>}
        </div>
      )}
    </div>
  );
}
