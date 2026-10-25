"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  AddNoteForm, AppointmentForm, AssignForm, ContactedForm, DocumentForm, FollowupForm, NextStepForm, type Panel, StatusForm, TaskForm,
} from "@/components/staff/ClientActions";
import { ClientHero, ClientTabBar, CommandDeck, ProfileTab, type ClientTab, type TabItem } from "@/components/staff/client-file/parts";
import { CLIENT_FILE_SURFACE } from "@/components/staff/realtime/surfaces";
import { useTargetedPayloads } from "@/components/staff/realtime/useTargetedUpdate";
import { useStaff } from "@/components/staff/StaffContext";
import { SoftDelete } from "@/components/staff/SoftDelete";
import type { Row } from "@/components/staff/sections/common";
import { Documents } from "@/components/staff/sections/Documents";
import { Activity, Alerts, Assessments, IntakeAgent, Messages } from "@/components/staff/sections/Insight";
import { Preferences } from "@/components/staff/sections/Profile";
import { Appointments, Contacts, Followups, Notes, Tasks } from "@/components/staff/sections/Work";
import type { ClientAccountSummary } from "@/lib/client-account";
import { afterNextPaint } from "@/lib/after-paint";

export type ClientFileData = {
  client: Row; employment: Row[]; preferences: Row[]; documents: Row[]; extractions: Row[]; appointments: Row[]; notes: Row[];
  tasks: Row[]; contacts: Row[]; followups: Row[]; postHire: Row[]; assessments: Row[]; activity: Row[]; authorization: Row | null;
  notifications: Row[]; alerts: Row[]; agentRun: Row | null; references: Row[];
};
export type ClientPanel = Panel;
export type { ClientTab } from "@/components/staff/client-file/parts";

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
  const [panel, setPanel] = useState<Panel | null>(initialPanel);

  // The server resolves the requested tab from the URL. After that the tab is
  // local: the tab bar highlights at once, and the section body renders in a
  // transition so the click paints before the heavier section is built.
  const startTab: ClientTab = initialTab ?? (initialPanel ? panelTab[initialPanel] : "profile");
  const [tab, setTab] = useState<ClientTab>(startTab);
  const [seenStartTab, setSeenStartTab] = useState<ClientTab>(startTab);
  const [, startTabTransition] = useTransition();
  if (seenStartTab !== startTab) {
    setSeenStartTab(startTab);
    setTab(startTab);
  }

  const replaceTab = useCallback((nextTab: ClientTab) => {
    // The tab bar marks the choice at once; the section, which can be large,
    // renders after that frame has painted, so it never delays the feedback.
    afterNextPaint(() => startTabTransition(() => setTab(nextTab)));
    const params = new URLSearchParams(window.location.search);
    params.set("tab", nextTab);
    params.delete("action");
    const query = params.toString();
    // Keeps the link shareable without a server render: the data is already here.
    window.history.replaceState(window.history.state, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
  }, []);

  const close = useCallback(() => setPanel(null), []);
  const openPanel = useCallback((p: Panel) => {
    replaceTab(panelTab[p]);
    setPanel(p);
    setTimeout(() => document.getElementById("action-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }, [replaceTab]);
  const togglePanel = useCallback((p: Panel) => {
    if (panel === p) close();
    else openPanel(p);
  }, [panel, close, openPanel]);
  const opener = (p: Panel) => () => openPanel(p);

  const tabs = useMemo<TabItem[]>(() => [
    { id: "profile", label: "Profile" },
    { id: "preferences", label: "Job Preferences", count: data.preferences.length },
    { id: "documents", label: "Documents", count: data.documents.length },
    { id: "appointments", label: "Appointments", count: data.appointments.length },
    { id: "work", label: "Notes / Tasks / Contacts", count: data.notes.length + data.tasks.length + data.contacts.length },
    { id: "activity", label: "Activity Log", count: data.activity.length },
  ], [data.preferences.length, data.documents.length, data.appointments.length, data.notes.length, data.tasks.length, data.contacts.length, data.activity.length]);

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ClientHero c={c} account={account} />

      <ClientTabBar tabs={tabs} active={tab} onSelect={replaceTab} />

      <CommandDeck clientId={String(c.id)} status={String(c.current_status)} panel={panel} isManager={isManager} onToggle={togglePanel} />

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
        <ProfileTab c={c} activity={data.activity} notifications={data.notifications} employment={data.employment} authorization={data.authorization} preferences={data.preferences} />
      )}

      {tab === "preferences" && <Preferences clientId={c.id} prefs={data.preferences} />}

      {tab === "documents" && (
        <div className="space-y-4" data-testid="documents-tab-content">
          <Documents docs={data.documents} extractions={data.extractions} onAdd={opener("document")} />
          <Assessments clientId={c.id} items={data.assessments} references={data.references} />
        </div>
      )}

      {tab === "appointments" && <Appointments appts={data.appointments} onAdd={isManager ? opener("appointment") : null} />}

      {tab === "work" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-4"><Notes notes={data.notes} onAdd={opener("note")} /><Tasks tasks={data.tasks} onAdd={opener("task")} /><Followups followups={data.followups} onAdd={opener("followup")} /></div>
          <div className="space-y-4"><Contacts contacts={data.contacts} onAdd={opener("contacted")} /><Messages c={c} notifications={data.notifications} onContacted={opener("contacted")} /><IntakeAgent clientId={c.id} run={data.agentRun} /></div>
        </div>
      )}

      {tab === "activity" && (
        <div className="space-y-4"><Activity activity={data.activity} />{isAdmin && !c.deleted_at && <SoftDelete clientId={c.id} />}</div>
      )}
    </div>
  );
}
