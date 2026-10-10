"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  AddNoteForm, AppointmentForm, AssignForm, ContactedForm, DocumentForm, FollowupForm, NextStepForm, type Panel, StatusForm, TaskForm,
} from "@/components/staff/ClientActions";
import { ClientAccountPanel } from "@/components/staff/ClientAccountPanel";
import { InlineField } from "@/components/staff/InlineField";
import { RealtimeRefresher } from "@/components/staff/RealtimeRefresher";
import { useStaff } from "@/components/staff/StaffContext";
import { StatusBadge } from "@/components/staff/StatusBadge";
import { SoftDelete } from "@/components/staff/SoftDelete";
import { StatusTimeline } from "@/components/staff/StatusTimeline";
import type { Row } from "@/components/staff/sections/common";
import { Documents } from "@/components/staff/sections/Documents";
import { Activity, Alerts, Assessments, IntakeAgent, Messages } from "@/components/staff/sections/Insight";
import { AmazonHistory, ClientInfo, EmploymentHistory, Preferences } from "@/components/staff/sections/Profile";
import { Appointments, Contacts, Followups, Notes, Tasks } from "@/components/staff/sections/Work";
import type { ClientAccountSummary } from "@/lib/client-account";
import type { Status } from "@/lib/domain";

export type ClientFileData = {
  client: Row; employment: Row[]; preferences: Row[]; documents: Row[]; extractions: Row[]; appointments: Row[]; notes: Row[];
  tasks: Row[]; contacts: Row[]; followups: Row[]; postHire: Row[]; assessments: Row[]; activity: Row[]; authorization: Row | null;
  notifications: Row[]; alerts: Row[]; agentRun: Row | null; references: Row[];
};
export type ClientPanel = Panel;
export type ClientTab = "profile" | "preferences" | "documents" | "appointments" | "work" | "activity";

const CLIENT_TABS = new Set<ClientTab>(["profile", "preferences", "documents", "appointments", "work", "activity"]);
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

function pipelineLabel(value: unknown) {
  return String(value ?? "portal_intake").replace(/_/g, " ");
}

function validTab(value: string | null): value is ClientTab {
  return Boolean(value && CLIENT_TABS.has(value as ClientTab));
}

export function ClientFile({
  data,
  account = null,
  initialPanel = null,
  initialTab = null,
}: {
  data: ClientFileData;
  account?: ClientAccountSummary;
  initialPanel?: ClientPanel | null;
  initialTab?: ClientTab | null;
}) {
  const { client: c } = data;
  const { isManager, isAdmin } = useStaff();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [panel, setPanel] = useState<Panel | null>(initialPanel);

  const urlTab = searchParams.get("tab");
  const tab: ClientTab = validTab(urlTab)
    ? urlTab
    : initialPanel
      ? panelTab[initialPanel]
      : initialTab ?? "profile";

  const replaceTab = (nextTab: ClientTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    params.delete("action");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const close = () => setPanel(null);
  const openPanel = (p: Panel) => () => {
    replaceTab(panelTab[p]);
    setPanel(p);
    setTimeout(() => document.getElementById("action-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
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

  const statusEvents = data.activity
    .filter((l) => l.action === "status_changed" || l.action === "status_overridden")
    .map((l) => ({ at: l.created_at, from: l.old_value?.status as Status, to: l.new_value?.status as Status, by: l.staff_name, override: l.action === "status_overridden" }))
    .reverse();
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
      <div className="staff-glass-strong rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/[.055] text-sm font-semibold text-slate-200">{String(c.full_name).trim().slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold" data-testid="client-name">{c.full_name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-slate-500" data-testid="client-ref">{c.ref}</span>
              <StatusBadge status={c.current_status} />
              <span className="rounded-full border border-indigo-400/20 bg-indigo-400/[.07] px-2 py-1 text-[9px] capitalize text-indigo-200">{pipelineLabel(c.pipeline_stage)}</span>
              {account?.payment_status === "paid" && <span className="rounded-full border border-emerald-400/25 bg-emerald-400/[.08] px-2 py-1 text-[9px] font-semibold text-emerald-300">Paid · ${account.net_fee.toFixed(2)}</span>}
            </div>
          </div>
          <span className="text-xs text-slate-500">Handled by: <span data-testid="assigned-name">{c.assigned_name ?? "Unassigned"}</span></span>
          {c.deleted_at && <span className="rounded bg-red-950/50 px-2 py-1 text-xs text-red-300">Deleted: {c.delete_reason}</span>}
          <span className="ml-auto"><RealtimeRefresher clientId={c.id} /></span>
        </div>

        <div className={`mt-4 grid gap-4 ${account ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
          <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3">
            <p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Current Status</p>
            <div className="mt-2" data-testid="current-status"><StatusBadge status={c.current_status} /></div>
          </div>
          <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3">
            <p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Next Step</p>
            <div className="mt-1 text-sm" data-testid="next-step"><InlineField clientId={c.id} field="next_step" label="Next step" value={c.next_step} /></div>
          </div>
          {account && <ClientAccountPanel clientId={String(c.id)} account={account} />}
        </div>
      </div>

      <div className="cg-profile-tabs" aria-label="Client file sections">
        {tabs.map((item) => (
          <button key={item.id} type="button" className="staff-tab cg-profile-tab whitespace-nowrap" data-active={tab === item.id} onClick={() => replaceTab(item.id)}>
            {item.label}{item.count != null && <span className="ml-1.5 font-mono text-[9px] text-slate-600">{item.count}</span>}
          </button>
        ))}
      </div>

      <div className="cg-command-deck" data-testid="quick-actions" aria-label="Client command deck">
        <div className="cg-command-track">
          <span className="cg-command-context" aria-hidden="true">COMMAND</span>
          <Link href={`/staff/client/${c.id}/edit`} aria-label="Edit Client" className="cg-command-button cg-command-primary">Correct Data</Link>
          {orderedQuick.filter(([, , allowed]) => allowed).map(([p, label], index) => (
            <button key={p} type="button" onClick={panel === p ? close : openPanel(p)} aria-expanded={panel === p}
              data-promoted={index < promoted.length}
              className={`cg-command-button ${panel === p ? "cg-command-active" : ""}`}>
              <span className="cg-command-signal" aria-hidden="true" />
              {label}
            </button>
          ))}
          <Link href={`/staff/client/${c.id}/status-preview`} className="cg-command-button" data-testid="open-status-page">Open Status Page</Link>
        </div>
      </div>

      <div id="action-panel">
        {panel === "document" && <DocumentForm clientId={c.id} onDone={close} />}
        {panel === "appointment" && <AppointmentForm clientId={c.id} onDone={close} />}
        {panel === "note" && <AddNoteForm clientId={c.id} onDone={close} />}
        {panel === "task" && <TaskForm clientId={c.id} onDone={close} />}
        {panel === "contacted" && <ContactedForm clientId={c.id} onDone={close} />}
        {panel === "status" && <StatusForm clientId={c.id} current={c.current_status} nextStep={c.next_step} onDone={close} />}
        {panel === "next_step" && <NextStepForm clientId={c.id} nextStep={c.next_step} onDone={close} />}
        {panel === "followup" && <FollowupForm clientId={c.id} onDone={close} />}
        {panel === "assign" && <AssignForm clientId={c.id} current={c.assigned_staff} onDone={close} />}
      </div>

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
            <EmploymentHistory rows={data.employment} editHref={`/staff/client/${c.id}/edit`} />
          </div>
          <div className="space-y-4"><ClientInfo c={c} authorization={data.authorization} /><AmazonHistory c={c} /></div>
        </div>
      )}

      {tab === "preferences" && <Preferences clientId={c.id} prefs={data.preferences} />}

      {tab === "documents" && (
        <div className="space-y-4" data-testid="documents-tab-content">
          <Documents docs={data.documents} extractions={data.extractions} onAdd={openPanel("document")} />
          <Assessments clientId={c.id} items={data.assessments} references={data.references} />
        </div>
      )}

      {tab === "appointments" && <Appointments appts={data.appointments} onAdd={isManager ? openPanel("appointment") : null} />}

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
