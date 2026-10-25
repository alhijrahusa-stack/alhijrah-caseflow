"use client";

import Link from "next/link";
import { memo, useState } from "react";
import type { Panel } from "@/components/staff/ClientActions";
import { ClientAccountPanel } from "@/components/staff/ClientAccountPanel";
import { InlineField } from "@/components/staff/InlineField";
import { RealtimeRefresher } from "@/components/staff/RealtimeRefresher";
import { StatusBadge } from "@/components/staff/StatusBadge";
import { StatusTimeline } from "@/components/staff/StatusTimeline";
import type { Row } from "@/components/staff/sections/common";
import { AmazonHistory, ClientInfo, EmploymentHistory } from "@/components/staff/sections/Profile";
import type { ClientAccountSummary } from "@/lib/client-account";
import type { Status } from "@/lib/domain";

/*
 * The Client 360 surface in separately memoized parts. A tab switch or an
 * opened action panel re-renders only the parts whose inputs changed; the hero,
 * account panel and command deck keep their last render.
 */

export type ClientTab = "profile" | "preferences" | "documents" | "appointments" | "work" | "activity";
export type TabItem = { id: ClientTab; label: string; count?: number };

function pipelineLabel(value: unknown) {
  return String(value ?? "portal_intake").replace(/_/g, " ");
}

export const ClientHero = memo(function ClientHero({ c, account }: { c: Row; account: ClientAccountSummary | null }) {
  return (
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
  );
});

/**
 * Owns the highlighted tab, so a click repaints this bar alone; the section
 * body follows in the parent's transition. A new `active` (from the server or
 * an action panel) re-syncs the highlight.
 */
export const ClientTabBar = memo(function ClientTabBar({ tabs, active, onSelect }: { tabs: TabItem[]; active: ClientTab; onSelect: (tab: ClientTab) => void }) {
  const [selected, setSelected] = useState(active);
  const [seen, setSeen] = useState(active);
  if (seen !== active) {
    setSeen(active);
    setSelected(active);
  }
  return (
    <div className="cg-profile-tabs" aria-label="Client file sections">
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          className="staff-tab cg-profile-tab whitespace-nowrap"
          data-active={selected === item.id}
          aria-busy={selected === item.id && active !== item.id}
          onClick={() => { setSelected(item.id); onSelect(item.id); }}
        >
          {item.label}{item.count != null && <span className="ml-1.5 font-mono text-[9px] text-slate-600">{item.count}</span>}
        </button>
      ))}
    </div>
  );
});

const QUICK: [Panel, string, "all" | "manager"][] = [
  ["document", "Add Document", "all"], ["appointment", "Add Appointment", "manager"], ["note", "Add Note", "all"], ["task", "Add Task", "all"],
  ["contacted", "Mark Contacted", "all"], ["status", "Change Status", "manager"], ["next_step", "Set Next Step", "all"],
  ["followup", "Add Follow-Up", "all"], ["assign", "Assign Staff", "manager"],
];

const ACTION_WEIGHT: Partial<Record<Status, Panel[]>> = {
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

/** The status-weighted action deck: the actions the current status calls for come first. */
export const CommandDeck = memo(function CommandDeck({ clientId, status, panel, isManager, onToggle }: {
  clientId: string;
  status: string;
  panel: Panel | null;
  isManager: boolean;
  onToggle: (panel: Panel) => void;
}) {
  const promoted = ACTION_WEIGHT[status as Status] ?? [];
  const ordered = QUICK
    .filter(([, , who]) => who === "all" || isManager)
    .sort(([a], [b]) => {
      const ai = promoted.indexOf(a);
      const bi = promoted.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  return (
    <div className="cg-command-deck" data-testid="quick-actions" aria-label="Client command deck">
      <div className="cg-command-track">
        <span className="cg-command-context" aria-hidden="true">COMMAND</span>
        <Link href={`/staff/client/${clientId}/edit`} aria-label="Edit Client" className="cg-command-button cg-command-primary">Correct Data</Link>
        {ordered.map(([p, label], index) => (
          <button key={p} type="button" onClick={() => onToggle(p)} aria-expanded={panel === p}
            data-promoted={index < promoted.length}
            className={`cg-command-button ${panel === p ? "cg-command-active" : ""}`}>
            <span className="cg-command-signal" aria-hidden="true" />
            {label}
          </button>
        ))}
        <Link href={`/staff/client/${clientId}/status-preview`} className="cg-command-button" data-testid="open-status-page">Open Status Page</Link>
      </div>
    </div>
  );
});

type StatusEvent = { at: string; from: Status; to: Status; by: string; override: boolean };

export const ProfileTab = memo(function ProfileTab({ c, activity, notifications, employment, authorization, preferences }: {
  c: Row;
  activity: Row[];
  notifications: Row[];
  employment: Row[];
  authorization: Row | null;
  preferences: Row[];
}) {
  const statusEvents: StatusEvent[] = activity
    .filter((l) => l.action === "status_changed" || l.action === "status_overridden")
    .map((l) => ({ at: l.created_at, from: l.old_value?.status as Status, to: l.new_value?.status as Status, by: l.staff_name, override: l.action === "status_overridden" }))
    .reverse();
  const createdEvent = activity.find((l) => l.action === "client_created");
  const createdStatus = (createdEvent?.new_value?.status as Status) ?? (statusEvents[0]?.from ?? c.current_status);

  return (
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
            <span className="rounded-full border border-sky-300/30 bg-sky-300/10 px-3 py-1 text-xs text-sky-100">{notifications.length} notifications</span>
          </div>
          <div className="relative mt-4 grid gap-2 sm:grid-cols-2">
            {notifications.length === 0 ? <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">No notifications recorded / لا توجد إشعارات مسجلة</p> : notifications.slice(0, 6).map((n, i) => <article key={String(n.id ?? i)} className="min-w-0 rounded-xl border border-white/10 bg-white/5 p-3 transition-all duration-300 hover:border-amber-300/40 hover:bg-white/10"><p className="break-words text-sm font-semibold text-white">{String(n.template ?? "Client update").replace(/_/g, " ")}</p><div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300"><span>{String(n.channel ?? "notification")}</span><span className="rounded-full border border-white/20 px-2 py-1">{String(n.status ?? "unknown")}</span></div></article>)}
          </div>
          <Link href={`/staff/client/${c.id}?tab=work`} className="relative mt-4 inline-flex rounded-xl border border-amber-300/40 px-4 py-2 text-xs font-semibold text-amber-200 transition-all duration-300 hover:bg-amber-300/10">View all notifications / عرض جميع الإشعارات</Link>
        </section>
        <EmploymentHistory rows={employment} editHref={`/staff/client/${c.id}/edit`} />
      </div>
      <div className="space-y-4"><ClientInfo c={c} authorization={authorization} preferences={preferences} /><AmazonHistory c={c} /></div>
    </div>
  );
});
