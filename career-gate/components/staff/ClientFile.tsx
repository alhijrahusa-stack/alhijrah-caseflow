"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AddNoteForm, AppointmentForm, AssignForm, ContactedForm, DocumentForm, FollowupForm, NextStepForm, type Panel, StatusForm, TaskForm,
} from "@/components/staff/ClientActions";
import { InlineField } from "@/components/staff/InlineField";
import { RealtimeRefresher } from "@/components/staff/RealtimeRefresher";
import { useStaff } from "@/components/staff/StaffContext";
import { StatusBadge } from "@/components/staff/StatusBadge";
import { SoftDelete } from "@/components/staff/SoftDelete";
import { StatusTimeline } from "@/components/staff/StatusTimeline";
import type { Row } from "@/components/staff/sections/common";
import { Card } from "@/components/staff/sections/common";
import { Documents } from "@/components/staff/sections/Documents";
import { Activity, Alerts, Assessments, IntakeAgent, Messages } from "@/components/staff/sections/Insight";
import { AmazonHistory, ClientInfo, EmploymentHistory, Preferences } from "@/components/staff/sections/Profile";
import { Appointments, Contacts, Followups, Notes, PostHire, Tasks } from "@/components/staff/sections/Work";
import type { Status } from "@/lib/domain";

export type ClientFileData = {
  client: Row; employment: Row[]; preferences: Row[]; documents: Row[]; extractions: Row[]; appointments: Row[]; notes: Row[];
  tasks: Row[]; contacts: Row[]; followups: Row[]; postHire: Row[]; assessments: Row[]; activity: Row[]; authorization: Row | null;
  notifications: Row[]; alerts: Row[]; agentRun: Row | null; references: Row[];
};

export function ClientFile({ data }: { data: ClientFileData }) {
  const { client: c } = data;
  const { isManager, isAdmin } = useStaff();
  const [panel, setPanel] = useState<Panel | null>(null);
  const close = () => setPanel(null);
  const openPanel = (p: Panel) => () => {
    setPanel(p);
    setTimeout(() => document.getElementById("action-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const quick: [Panel, string, boolean][] = [
    ["document", "Add Document", true], ["appointment", "Add Appointment", isManager], ["note", "Add Note", true], ["task", "Add Task", true],
    ["contacted", "Mark Contacted", true], ["status", "Change Status", isManager], ["next_step", "Set Next Step", true],
    ["followup", "Add Follow-Up", true], ["assign", "Assign Staff", isManager],
  ];

  const statusEvents = data.activity
    .filter((l) => l.action === "status_changed" || l.action === "status_overridden")
    .map((l) => ({ at: l.created_at, from: l.old_value?.status as Status, to: l.new_value?.status as Status, by: l.staff_name, override: l.action === "status_overridden" }))
    .reverse();
  const createdEvent = data.activity.find((l) => l.action === "client_created");
  const createdStatus = (createdEvent?.new_value?.status as Status) ?? (statusEvents[0]?.from ?? c.current_status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold" data-testid="client-name">{c.full_name}</h1>
        <span className="font-mono text-sm text-slate-500" data-testid="client-ref">{c.ref}</span>
        <StatusBadge status={c.current_status} />
        <span className="text-xs text-slate-500">Handled by: <span data-testid="assigned-name">{c.assigned_name ?? "Unassigned"}</span></span>
        {c.deleted_at && <span className="rounded bg-red-100 px-2 text-xs text-red-800">Deleted: {c.delete_reason}</span>}
        <span className="ml-auto"><RealtimeRefresher clientId={c.id} /></span>
      </div>

      <div className="sticky top-[57px] z-20 -mx-4 flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur lg:-mx-6 lg:px-6" data-testid="quick-actions">
        <Link href={`/staff/client/${c.id}/edit`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">Edit Client</Link>
        {quick.filter(([, , allowed]) => allowed).map(([p, label]) => (
          <button key={p} type="button" onClick={panel === p ? close : openPanel(p)} aria-expanded={panel === p}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors duration-200 ${panel === p ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 bg-white hover:bg-slate-50"}`}>
            {label}
          </button>
        ))}
        <Link href={`/staff/client/${c.id}/status-preview`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50" data-testid="open-status-page">
          Open Status Page
        </Link>
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

      {isManager && <Alerts alerts={data.alerts} />}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Current Status & Next Step" id="status">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Current Status</p>
                  <p className="mt-1 font-semibold" data-testid="current-status"><StatusBadge status={c.current_status} /></p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Next Step</p>
                  <div className="mt-1" data-testid="next-step"><InlineField clientId={c.id} field="next_step" label="Next step" value={c.next_step} /></div>
                </div>
              </div>
              <StatusTimeline created={{ at: c.created_at, status: createdStatus }} events={statusEvents} current={c.current_status} />
            </div>
          </Card>
          <Preferences clientId={c.id} prefs={data.preferences} />
          <Documents docs={data.documents} extractions={data.extractions} onAdd={openPanel("document")} />
          <Appointments appts={data.appointments} onAdd={isManager ? openPanel("appointment") : null} />
          <Assessments clientId={c.id} items={data.assessments} references={data.references} />
          <Tasks tasks={data.tasks} onAdd={openPanel("task")} />
          <Followups followups={data.followups} onAdd={openPanel("followup")} />
          <PostHire clientId={c.id} items={data.postHire} startDate={c.start_date} />
        </div>
        <div className="space-y-4">
          <ClientInfo c={c} authorization={data.authorization} />
          <AmazonHistory c={c} />
          <EmploymentHistory rows={data.employment} editHref={`/staff/client/${c.id}/edit`} />
          <IntakeAgent clientId={c.id} run={data.agentRun} />
          <Messages c={c} notifications={data.notifications} onContacted={openPanel("contacted")} />
          <Notes notes={data.notes} onAdd={openPanel("note")} />
          <Contacts contacts={data.contacts} onAdd={openPanel("contacted")} />
          <Activity activity={data.activity} />
          {isAdmin && !c.deleted_at && <SoftDelete clientId={c.id} />}
        </div>
      </div>
    </div>
  );
}
