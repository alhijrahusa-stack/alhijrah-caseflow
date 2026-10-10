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
  const [accountExpanded, setAccountExpanded] = useState(false);

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
      <section className="cg-client-hero" aria-labelledby="client-name-heading">
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
            <article className="cg-client-account-summary">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="cg-command-card-label">Client Account</p>
                  <div className="mt-2 flex flex-wrap items-baseline gap-2">
                    <span className="cg-account-status">{account.payment_status}</span>
                    <strong className="text-lg text-slate-50">${account.net_fee.toFixed(2)}</strong>
                    <span className="text-[11px] text-slate-400">Outstanding ${account.outstanding.toFixed(2)}</span>
                  </div>
                </div>
                <button type="button" className="cg-account-toggle" aria-expanded={accountExpanded} onClick={() => setAccountExpanded((value) => !value)}>
                  {accountExpanded ? "Hide" : "View"}
                </button>
              </div>
              {accountExpanded && <div className="mt-3"><ClientAccountPanel clientId={String(c.id)} account={account} /></div>}
            </article>
          )}
        </div>
      </section>

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

      <div id="action-panel" className="relative z-40 scroll-mt-40">
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
