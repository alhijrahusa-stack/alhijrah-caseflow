"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  AddNoteForm, AppointmentForm, AssignForm, ContactedForm, DocumentForm, FollowupForm, NextStepForm, type Panel, StatusForm, TaskForm,
} from "@/components/staff/ClientActions";
import { ClientAccountPanel } from "@/components/staff/ClientAccountPanel";
import { InlineField } from "@/components/staff/InlineField";
import { RealtimeRefresher } from "@/components/staff/RealtimeRefresher";
import { CLIENT_FILE_SURFACE } from "@/components/staff/realtime/surfaces";
import { useTargetedPayloads } from "@/components/staff/realtime/useTargetedUpdate";
import { useStaff } from "@/components/staff/StaffContext";
import { useHydrated } from "@/components/staff/useHydrated";
import { StatusBadge } from "@/components/staff/StatusBadge";
import { SoftDelete } from "@/components/staff/SoftDelete";
import { StatusTimeline } from "@/components/staff/StatusTimeline";
import { useRowAction, type Row } from "@/components/staff/sections/common";
import { Documents } from "@/components/staff/sections/Documents";
import { Activity, Alerts, Assessments, IntakeAgent, Messages } from "@/components/staff/sections/Insight";
import { AmazonHistory, ClientInfo, EmploymentHistory, Preferences } from "@/components/staff/sections/Profile";
import { Appointments, Contacts, Followups, Notes, RescheduleModal, Tasks } from "@/components/staff/sections/Work";
import { fromLocalInput } from "@/lib/format";
import type { ClientAccountSummary } from "@/lib/client-account";
import type { Status } from "@/lib/domain";

export type ClientFileData = {
  client: Row; employment: Row[]; preferences: Row[]; documents: Row[]; extractions: Row[]; appointments: Row[]; notes: Row[];
  tasks: Row[]; contacts: Row[]; followups: Row[]; postHire: Row[]; assessments: Row[]; activity: Row[]; authorization: Row | null;
  notifications: Row[]; alerts: Row[]; agentRun: Row | null; references: Row[];
};
export type ClientPanel = Panel;
export type ClientTab = "profile" | "preferences" | "documents" | "appointments" | "work" | "activity";

const panelTab: Record<Panel, ClientTab> = {
  document: "documents",
  appointment: "appointments",
  note: "work",
  task: "work",
  contacted: "work",
  status: "profile",
  next_step: "profile",
  followup: "work",
  assign: "profile",
};

/** Client-file slices that arrive as a list and replace the rendered one. */
const LIST_SLICES = [
  "employment", "preferences", "documents", "extractions", "appointments", "notes",
  "tasks", "contacts", "followups", "postHire", "assessments", "activity",
  "notifications", "alerts", "references",
] as const;

type LiveState = { data: ClientFileData; account: ClientAccountSummary };

/**
 * Patches only the slices a targeted update delivered. Anything the update did
 * not carry is left exactly as the server rendered it.
 */
function applyPayloads(current: LiveState, payloads: Record<string, unknown>): LiveState {
  const data: ClientFileData = { ...current.data };
  let touched = false;
  if (payloads.client && typeof payloads.client === "object") {
    data.client = payloads.client as Row;
    touched = true;
  }
  for (const key of LIST_SLICES) {
    const value = payloads[key];
    if (Array.isArray(value)) {
      (data as unknown as Record<string, unknown>)[key] = value as Row[];
      touched = true;
    }
  }
  for (const key of ["authorization", "agentRun"] as const) {
    if (key in payloads) {
      (data as unknown as Record<string, unknown>)[key] = (payloads[key] ?? null) as Row | null;
      touched = true;
    }
  }
  const account = payloads.account !== undefined
    ? (payloads.account as ClientAccountSummary)
    : current.account;
  if (!touched && account === current.account) return current;
  return { data, account };
}

function pipelineLabel(value: unknown) {
  return String(value ?? "portal_intake").replace(/_/g, " ");
}

export function ClientFile({
  data: serverData,
  account: serverAccount = null,
  initialPanel = null,
  initialTab = null,
}: {
  data: ClientFileData;
  account?: ClientAccountSummary;
  initialPanel?: ClientPanel | null;
  initialTab?: ClientTab | null;
}) {
  // Stable across client re-renders: only a new server render changes either
  // prop, and only then may the targeted patches be discarded.
  const serverState = useMemo<LiveState>(() => ({ data: serverData, account: serverAccount }), [serverData, serverAccount]);
  const live = useTargetedPayloads<LiveState>({
    resources: CLIENT_FILE_SURFACE.resources,
    clientId: typeof serverData.client.id === "string" ? serverData.client.id : null,
    initial: serverState,
    apply: applyPayloads,
  });
  const data = live.data;
  const account = live.account;
  const { client: c } = data;
  const { isManager, isAdmin } = useStaff();
  const isMounted = useHydrated();
  const rescheduleAction = useRowAction("Appointment decision saved");
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const rescheduleAppt = data.appointments.find((appt) => String(appt.id) === reschedulingId) ?? null;
  const [panel, setPanel] = useState<Panel | null>(initialPanel);

  // The server resolves the requested tab from the URL. After that the tab is
  // local: the button highlights at once, and the section body renders in a
  // transition so the click paints before the heavier section is built.
  const startTab: ClientTab = initialTab ?? (initialPanel ? panelTab[initialPanel] : "profile");
  const [selectedTab, setSelectedTab] = useState<ClientTab>(startTab);
  const [tab, setTab] = useState<ClientTab>(startTab);
  const [seenStartTab, setSeenStartTab] = useState<ClientTab>(startTab);
  const [, startTabTransition] = useTransition();
  if (seenStartTab !== startTab) {
    setSeenStartTab(startTab);
    setSelectedTab(startTab);
    setTab(startTab);
  }

  const replaceTab = (nextTab: ClientTab) => {
    setSelectedTab(nextTab);
    startTabTransition(() => setTab(nextTab));
    const params = new URLSearchParams(window.location.search);
    params.set("tab", nextTab);
    params.delete("action");
    const query = params.toString();
    // Keeps the link shareable without a server render: the data is already here.
    window.history.replaceState(window.history.state, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  };

  const close = () => setPanel(null);
  const openPanel = (p: Panel) => () => {
    replaceTab(panelTab[p]);
    setPanel(p);
    setTimeout(() => document.getElementById("action-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  };

  const quick: [Panel, string, boolean][] = [
    ["document", "Add Document", true], ["appointment", "Add Appointment", isManager], ["note", "Add Note", true], ["task", "Add Task", true],
    ["contacted", "Mark Contacted", true], ["status", "Change Status", isManager], ["next_step", "Set Next Step", true],
    ["followup", "Add Follow-Up", true], ["assign", "Assign Staff", isManager],
  ];

  const actionWeight: Partial<Record<Status, Panel[]>> = {
    new_intake: ["document", "next_step", "contacted"],
    needs_review: ["document", "task", "next_step"],
    ready_to_apply: ["next_step", "task", "contacted"],
    application_in_progress: ["task", "contacted", "next_step"],
    assessment_required: ["task", "contacted", "next_step"],
    appointment_required: ["appointment", "contacted", "task"],
    appointment_scheduled: ["appointment", "task", "contacted"],
    i9_available: ["document", "task", "next_step"],
    post_hire_tasks: ["task", "followup", "contacted"],
    ready_for_first_day: ["followup", "contacted", "task"],
  };
  const promoted = actionWeight[c.current_status as Status] ?? [];
  const orderedQuick = [...quick].sort(([a], [b]) => {
    const ai = promoted.indexOf(a);
    const bi = promoted.indexOf(b);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  const statusEvents = useMemo(() => data.activity
    .filter((l) => l.action === "status_changed" || l.action === "status_overridden")
    .map((l) => ({ at: l.created_at, from: l.old_value?.status as Status, to: l.new_value?.status as Status, by: l.staff_name, override: l.action === "status_overridden" }))
    .reverse(), [data.activity]);
  const createdEvent = data.activity.find((l) => l.action === "client_created");
  const createdStatus = (createdEvent?.new_value?.status as Status) ?? (statusEvents[0]?.from ?? c.current_status);

  const tabs: { id: ClientTab; label: string; count?: number }[] = [
    { id: "profile", label: "Profile" },
    { id: "preferences", label: "Job Preferences", count: data.preferences.length },
    { id: "documents", label: "Documents", count: data.documents.length },
    { id: "appointments", label: "Appointments", count: data.appointments.length },
    { id: "work", label: "Notes / Tasks / Contacts", count: data.notes.length + data.tasks.length + data.contacts.length },
    { id: "activity", label: "Activity Log", count: data.activity.length },
  ];

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <section className="cg-client-hero" data-testid="client-hero" aria-labelledby="client-name-heading">
        <div className="cg-client-hero-aura" aria-hidden="true" />
        <div className="cg-client-identity">
          <div className="cg-client-avatar" aria-hidden="true">{String(c.full_name).trim().slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <div className="cg-client-identity-line">
              <p className="cg-client-kicker">CLIENT 360 · COMMAND CENTER</p>
              <span className="cg-live-client"><span aria-hidden="true" /> Live Client</span>
            </div>
            <h1 id="client-name-heading" className="cg-client-name" data-testid="client-name">{c.full_name}</h1>
            <div className="cg-client-meta">
              <span className="cg-client-ref" data-testid="client-ref">{c.ref}</span>
              <StatusBadge status={c.current_status} />
              <span className="cg-client-pipeline">{pipelineLabel(c.pipeline_stage)}</span>
              {account?.payment_status === "paid" && <span className="cg-client-paid">Paid · ${account.net_fee.toFixed(2)}</span>}
            </div>
            <p className="cg-client-handler">Handled by: <strong data-testid="assigned-name">{c.assigned_name ?? "Unassigned"}</strong></p>
          </div>
          <div className="cg-client-live-slot"><RealtimeRefresher clientId={c.id} /></div>
        </div>

        {c.deleted_at && <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/[.06] px-3 py-2 text-xs text-red-200">Deleted: {c.delete_reason}</div>}

        <div className="cg-client-command-grid">
          <article className="cg-client-command-card">
            <div className="cg-command-card-icon" aria-hidden="true">◈</div>
            <div>
              <p className="cg-command-card-label">Current Status</p>
              <div className="mt-2" data-testid="current-status"><StatusBadge status={c.current_status} /></div>
            </div>
          </article>
          <article className="cg-client-command-card cg-client-command-card-primary">
            <div className="cg-command-card-icon" aria-hidden="true">↗</div>
            <div className="min-w-0">
              <p className="cg-command-card-label">Next Step</p>
              <div className="mt-1 text-sm font-medium text-slate-100" data-testid="next-step"><InlineField clientId={c.id} field="next_step" label="Next step" value={c.next_step} /></div>
            </div>
          </article>
          {account && (
            <div className="cg-client-account-summary">
              <ClientAccountPanel clientId={String(c.id)} account={account} />
            </div>
          )}
        </div>
      </section>

      <div className="cg-profile-tabs" aria-label="Client file sections">
        {tabs.map((item) => (
          <button key={item.id} type="button" className="staff-tab cg-profile-tab whitespace-nowrap" data-active={selectedTab === item.id} aria-busy={selectedTab === item.id && tab !== item.id} onClick={() => replaceTab(item.id)}>
            {item.label}{item.count != null && <span className="ml-1.5 font-mono text-[9px] text-slate-600">{item.count}</span>}
          </button>
        ))}
      </div>

      <div className="cg-command-deck" data-testid="quick-actions" aria-label="Client command deck">
        <div className="cg-command-track">
          <span className="cg-command-context" aria-hidden="true">COMMAND</span>
          <Link href={`/staff/client/${c.id}/edit`} aria-label="Edit Client" className="cg-command-button cg-command-primary">Correct Data</Link>
          {orderedQuick.filter(([, , allowed]) => allowed).map(([p, label], index) => (
            <button key={p} type="button" disabled={!isMounted} onClick={panel === p ? close : openPanel(p)} aria-expanded={panel === p}
              data-promoted={index < promoted.length}
              className={`cg-command-button ${panel === p ? "cg-command-active" : ""}`}>
              <span className="cg-command-signal" aria-hidden="true" />
              {label}
            </button>
          ))}
          <Link href={`/staff/client/${c.id}/status-preview`} className="cg-command-button" data-testid="open-status-page">Open Status Page</Link>
        </div>
      </div>

      <div id="action-panel" data-testid="client-action-panel" aria-busy={!isMounted} className="relative z-40 scroll-mt-40">
        {isMounted && panel === "document" && <DocumentForm clientId={c.id} onDone={close} />}
        {isMounted && panel === "appointment" && <AppointmentForm clientId={c.id} clientName={c.full_name} onDone={close} />}
        {isMounted && panel === "note" && <AddNoteForm clientId={c.id} onDone={close} />}
        {isMounted && panel === "task" && <TaskForm clientId={c.id} onDone={close} />}
        {isMounted && panel === "contacted" && <ContactedForm clientId={c.id} onDone={close} />}
        {isMounted && panel === "status" && <StatusForm clientId={c.id} current={c.current_status} nextStep={c.next_step} onDone={close} />}
        {isMounted && panel === "next_step" && <NextStepForm clientId={c.id} nextStep={c.next_step} onDone={close} />}
        {isMounted && panel === "followup" && <FollowupForm clientId={c.id} onDone={close} />}
        {isMounted && panel === "assign" && <AssignForm clientId={c.id} current={c.assigned_staff} onDone={close} />}
      </div>

      {isMounted && rescheduleAppt && <RescheduleModal
        key={String(rescheduleAppt.id)}
        appt={rescheduleAppt}
        pending={rescheduleAction.pending}
        error={rescheduleAction.error}
        onClose={() => setReschedulingId(null)}
        onSave={async ({ when, location, notes }) => {
          const instant = fromLocalInput(when);
          if (!Number.isFinite(instant.getTime())) { rescheduleAction.setError("Invalid appointment date"); return; }
          const ok = await rescheduleAction.go({
            action: "update_appointment",
            appointment_id: rescheduleAppt.id,
            scheduled_at: instant.toISOString(),
            location: location || null,
            notes: notes || null,
          });
          if (ok) setReschedulingId(null);
        }}
      />}

      {isManager && data.alerts.length > 0 && <Alerts alerts={data.alerts} />}

      {tab === "profile" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <section className="cg-status-stage" id="status-timeline" data-testid="section-status-timeline" aria-labelledby="status-timeline-title">
              <header className="cg-status-stage-header">
                <div>
                  <p className="cg-status-kicker">LIVING WORKFLOW</p>
                  <h2 id="status-timeline-title">Status Timeline</h2>
                </div>
                <span className="cg-status-live"><span aria-hidden="true" /> LIVE PATH</span>
              </header>
              <div className="cg-status-stage-body">
                <StatusTimeline created={{ at: c.created_at, status: createdStatus }} events={statusEvents} current={c.current_status} />
              </div>
            </section>
            <section className="relative overflow-hidden rounded-2xl border border-amber-300/30 bg-gradient-to-br from-[#173d61] via-[#102b49] to-[#0b1b32] p-5 shadow-[0_18px_45px_rgba(0,0,0,.2)]" aria-labelledby="client-notifications-title">
              <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-amber-300/10 blur-3xl" />
              <div className="relative flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-[10px] font-bold tracking-[.18em] text-amber-300">CAREER GATE · بوابة التوظيف</p><h2 id="client-notifications-title" className="mt-2 text-lg font-bold text-white">Client Notifications / إشعارات العميل</h2><p className="mt-1 text-xs text-slate-300">Official client communication history</p></div>
                <span className="rounded-full border border-sky-300/30 bg-sky-300/10 px-3 py-1 text-xs text-sky-100">{data.notifications.length} notifications</span>
              </div>
              <div className="relative mt-4 grid gap-2 sm:grid-cols-2">
                {data.notifications.length===0 ? <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">No notifications recorded / لا توجد إشعارات مسجلة</p> : data.notifications.slice(0,6).map((n,i)=><article key={String(n.id??i)} className="min-w-0 rounded-xl border border-white/10 bg-white/5 p-3 transition-all duration-300 hover:border-amber-300/40 hover:bg-white/10"><p className="break-words text-sm font-semibold text-white">{String(n.template??"Client update").replace(/_/g," ")}</p><div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300"><span>{String(n.channel??"notification")}</span><span className="rounded-full border border-white/20 px-2 py-1">{String(n.status??"unknown")}</span></div></article>)}
              </div>
              <Link href={`/staff/client/${c.id}?tab=work`} className="relative mt-4 inline-flex rounded-xl border border-amber-300/40 px-4 py-2 text-xs font-semibold text-amber-200 transition-all duration-300 hover:bg-amber-300/10">View all notifications / عرض جميع الإشعارات</Link>
            </section>
            <EmploymentHistory rows={data.employment} editHref={`/staff/client/${c.id}/edit`} />
          </div>
          <div className="space-y-4"><ClientInfo c={c} authorization={data.authorization} preferences={data.preferences} /><AmazonHistory c={c} /></div>
        </div>
      )}

      {tab === "preferences" && <Preferences clientId={c.id} prefs={data.preferences} />}

      {tab === "documents" && (
        <div className="space-y-4" data-testid="documents-tab-content">
          <Documents docs={data.documents} extractions={data.extractions} onAdd={openPanel("document")} />
          <Assessments clientId={c.id} items={data.assessments} references={data.references} />
        </div>
      )}

      {tab === "appointments" && <Appointments
        appts={data.appointments}
        onAdd={isManager ? openPanel("appointment") : null}
        reschedulingId={reschedulingId}
        onReschedule={(id) => { rescheduleAction.setError(null); setReschedulingId(id); }}
      />}

      {tab === "work" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-4"><Notes notes={data.notes} onAdd={openPanel("note")} /><Tasks tasks={data.tasks} onAdd={openPanel("task")} /><Followups followups={data.followups} onAdd={openPanel("followup")} /></div>
          <div className="space-y-4"><Contacts contacts={data.contacts} onAdd={openPanel("contacted")} /><Messages c={c} notifications={data.notifications} onContacted={openPanel("contacted")} /><IntakeAgent clientId={c.id} run={data.agentRun} /></div>
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-4"><Activity activity={data.activity} />{isAdmin && !c.deleted_at && <SoftDelete clientId={c.id} />}</div>
      )}
    </div>
  );
}
