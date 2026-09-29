"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useStaff } from "@/components/staff/StaffContext";
import type { DashboardClient, DashboardReport, StaffDashboardData } from "@/lib/staff-dashboard";

type Tab = "today" | "week" | "reports" | "settings";
type IconName = "search" | "calendar" | "check" | "plus" | "file" | "phone" | "activity" | "user" | "arrow" | "x" | "clock" | "alert";
type Filters = {
  q: string;
  status: string;
  owner: string;
  source: string;
  agency: "all" | "agency" | "direct";
  date: "all" | "today" | "7" | "30";
  lifecycle: "all" | "active" | "completed" | "stopped";
};

type BulkState = { kind: "idle" | "saving" | "success" | "error"; message: string };

const VIEW_KEY = "career-gate.staff.dashboard.view.v2";
const DEFAULT_FILTERS: Filters = { q: "", status: "", owner: "", source: "", agency: "all", date: "all", lifecycle: "all" };
const NEEDS_ACTION = new Set(["needs_review", "ready_to_apply", "appointment_required", "assessment_required"]);

const STATUS_META: Record<string, { label: string; color: string }> = {
  new_intake: { label: "New Intake", color: "#D8B56A" },
  needs_review: { label: "Needs Review", color: "#EF4444" },
  ready_to_apply: { label: "Ready to Apply", color: "#60A5FA" },
  application_in_progress: { label: "Application in Progress", color: "#38BDF8" },
  assessment_required: { label: "Assessment Required", color: "#F59E0B" },
  shift_selected: { label: "Shift Selected", color: "#22D3EE" },
  appointment_required: { label: "Appointment Required", color: "#EF4444" },
  appointment_scheduled: { label: "Appointment Scheduled", color: "#22D3EE" },
  pre_hire_completed: { label: "Pre-Hire Completed", color: "#22D3EE" },
  screening_pending: { label: "Screening Pending", color: "#38BDF8" },
  i9_available: { label: "I-9 Available", color: "#22D3EE" },
  post_hire_tasks: { label: "Post-Hire Tasks", color: "#38BDF8" },
  ready_for_first_day: { label: "Ready for First Day", color: "#10B981" },
  completed: { label: "Completed", color: "#10B981" },
  cancelled: { label: "Stopped", color: "#64748B" },
};

function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} {...common}>
      {name === "search" && <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></>}
      {name === "calendar" && <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>}
      {name === "check" && <><path d="m9 11 3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>}
      {name === "plus" && <path d="M12 5v14M5 12h14" />}
      {name === "file" && <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></>}
      {name === "phone" && <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.33 1.84.56 2.8.69A2 2 0 0 1 22 16.92z" />}
      {name === "activity" && <path d="M3 12h4l3-9 4 18 3-9h4" />}
      {name === "user" && <><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></>}
      {name === "arrow" && <path d="m9 18 6-6-6-6" />}
      {name === "x" && <path d="M18 6 6 18M6 6l12 12" />}
      {name === "clock" && <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}
      {name === "alert" && <><path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>}
    </svg>
  );
}

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status.replace(/_/g, " "), color: "#64748B" };
}

function pretty(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "—";
}

function sourceLabel(value: string) {
  if (value === "public_intake") return "Portal";
  if (value === "staff_manual") return "Office";
  return pretty(value);
}

function dateTime(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateOnly(value: string | null) {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00-04:00`) : new Date(value);
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Detroit", month: "short", day: "numeric", year: "numeric" }).format(date);
}

function relativeTime(value: string, now: number | null) {
  if (!now) return dateTime(value) ?? dateOnly(value) ?? "—";
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return dateOnly(value) ?? "—";
}

function contactAge(value: string | null) {
  if (!value) return "No contact recorded";
  return `Last contact ${dateTime(value) ?? dateOnly(value) ?? "—"}`;
}

function clientEvent(client: DashboardClient) {
  if (client.next_appointment) return `${dateTime(client.next_appointment)}${client.site_code ? ` · ${client.site_code}` : ""}`;
  if (client.next_task_due) return `Task due ${dateTime(client.next_task_due) ?? dateOnly(client.next_task_due)}`;
  if (client.next_followup_due) return `Follow-up ${dateOnly(client.next_followup_due)}`;
  return client.site_code ? `${client.site_code}${client.shift_code ? ` · ${client.shift_code}` : ""}` : "No scheduled event";
}

function priority(client: DashboardClient) {
  if (client.current_status === "new_intake") return { label: "NEW", tone: "new" as const };
  if (NEEDS_ACTION.has(client.current_status) || client.has_today_task || client.has_today_followup || client.has_today_appointment) {
    return { label: "NEEDS ACTION", tone: "attention" as const };
  }
  return { label: "ACTIVE", tone: "active" as const };
}

function ClientCard({
  client,
  now,
  onOpen,
  selectable,
  selected,
  onToggle,
}: {
  client: DashboardClient;
  now: number | null;
  onOpen: () => void;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const meta = statusMeta(client.current_status);
  const p = priority(client);
  const cardTone = p.tone === "new" ? "staff-card-new" : p.tone === "attention" ? "staff-card-attention" : "";
  return (
    <article
      className={`staff-client-card ${cardTone} rounded-2xl p-4 ${selected ? "ring-1 ring-cyan-300/40" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`Open ${client.full_name} ${client.ref}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="flex items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Select ${client.full_name}`}
            className="mt-1 h-4 w-4 shrink-0 accent-cyan-400"
            onClick={(event) => event.stopPropagation()}
            onChange={onToggle}
          />
        )}
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.color, boxShadow: `0 0 16px ${meta.color}55` }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate">{client.full_name}</h3>
            <span className="staff-priority-badge" data-tone={p.tone}>{p.label}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 staff-card-meta">
            <code>{client.ref}</code>
            <span>{relativeTime(client.updated_at, now)}</span>
            <span>{sourceLabel(client.source)}</span>
            {client.via_agency === true && <span>Agency</span>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="staff-card-status"><span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />{meta.label}</span>
            <span className="staff-card-status">{pretty(client.pipeline_stage)}</span>
          </div>
          <p className="mt-3 flex items-center gap-2 text-slate-400"><Icon name="calendar" />{clientEvent(client)}</p>
          <p className="mt-2 text-slate-300"><span className="text-slate-500">Next:</span> {client.next_step}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3 staff-card-meta">
            <span><Icon name="user" className="me-1 inline h-3.5 w-3.5" />{client.assigned_name ?? "Unassigned"}{client.assigned_staff_code ? ` · ${client.assigned_staff_code}` : ""}</span>
            <span><Icon name="file" className="me-1 inline h-3.5 w-3.5" />{client.document_count} docs</span>
            <span><Icon name="phone" className="me-1 inline h-3.5 w-3.5" />{contactAge(client.last_contact_at)}</span>
          </div>
        </div>
        <button
          type="button"
          className="staff-client-open shrink-0"
          onClick={(event) => { event.stopPropagation(); onOpen(); }}
        >
          Open
        </button>
      </div>
    </article>
  );
}

function Group({
  title,
  subtitle,
  clients,
  now,
  defaultOpen = false,
  onOpen,
  selectable,
  selectedIds,
  onToggle,
}: {
  title: string;
  subtitle?: string;
  clients: DashboardClient[];
  now: number | null;
  defaultOpen?: boolean;
  onOpen: (client: DashboardClient) => void;
  selectable: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <details open={defaultOpen} className="staff-glass rounded-2xl">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-slate-200">
        <span>
          <strong>{title}</strong>
          {subtitle && <span className="ms-2 text-xs font-normal text-slate-500">{subtitle}</span>}
        </span>
        <span className="flex items-center gap-2"><b className="font-mono text-xs text-slate-400">{clients.length}</b><span className="text-slate-600">⌄</span></span>
      </summary>
      <div className="grid gap-2 border-t border-white/[.06] p-3 lg:grid-cols-2 2xl:grid-cols-3">
        {clients.length ? clients.map((client) => (
          <ClientCard
            key={client.id}
            client={client}
            now={now}
            onOpen={() => onOpen(client)}
            selectable={selectable}
            selected={selectedIds.has(client.id)}
            onToggle={() => onToggle(client.id)}
          />
        )) : <p className="col-span-full px-2 py-6 text-sm text-slate-600">No clients in this group.</p>}
      </div>
    </details>
  );
}

function Kpi({ label, value, tone, href, testId, cardTestId }: { label: string; value: number; tone: string; href?: string; testId?: string; cardTestId?: string }) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p>{label}</p>
        <span className="h-2 w-2 rounded-full" style={{ background: tone }} />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight" data-testid={testId}>{value}</p>
    </>
  );
  return href ? (
    <Link href={href} className="staff-kpi block rounded-2xl p-4 transition-transform duration-150 hover:-translate-y-px active:scale-[.985]" data-testid={cardTestId}>{content}</Link>
  ) : <div className="staff-kpi rounded-2xl p-4">{content}</div>;
}

function ReportBlock({ title, rows }: { title: string; rows: { label: string; value: number; color?: string }[] }) {
  return (
    <section className="staff-glass rounded-2xl p-4">
      <h3 className="text-[15px] font-semibold text-slate-200">{title}</h3>
      <div className="mt-3 space-y-2">
        {rows.length ? rows.map((row) => (
          <div key={row.label} className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-white/[.05] bg-white/[.018] px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-sm text-slate-300">
              {row.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />}
              <span className="truncate">{row.label}</span>
            </div>
            <strong className="font-mono text-sm text-slate-100">{row.value}</strong>
          </div>
        )) : <p className="py-4 text-sm text-slate-600">No data for this period.</p>}
      </div>
    </section>
  );
}

function csvText(report: DashboardReport) {
  const rows: string[][] = [
    ["Metric", "Value"],
    ["Period days", String(report.days)],
    ["New clients", String(report.new_clients)],
    ["Average processing days", report.average_processing_days == null ? "N/A" : String(report.average_processing_days)],
    [], ["Status", "Count"], ...report.by_status.map((row) => [row.key, String(row.n)]),
    [], ["Staff", "Actions"], ...report.by_staff.map((row) => [row.name, String(row.n)]),
    [], ["Document status", "Count"], ...report.documents.map((row) => [row.key, String(row.n)]),
    [], ["Appointment status", "Count"], ...report.appointments.map((row) => [row.key, String(row.n)]),
  ];
  return rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function isRecent(createdAt: string, days: number, now: number | null) {
  if (!now) return true;
  const age = now - new Date(createdAt).getTime();
  return age >= 0 && age <= days * 86400000;
}

export function StaffDashboard({ data, initialTab = "today", meRole }: { data: StaffDashboardData; initialTab?: Tab; meRole: string }) {
  const router = useRouter();
  const { activeStaff } = useStaff();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [selected, setSelected] = useState<DashboardClient | null>(null);
  const [period, setPeriod] = useState("7");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkStaffId, setBulkStaffId] = useState("");
  const [bulkState, setBulkState] = useState<BulkState>({ kind: "idle", message: "" });
  const [restored, setRestored] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const report = data.reports[period] ?? data.reports["7"];
  const canBulkAssign = meRole === "admin" || meRole === "manager";

  const allClients = useMemo(() => [
    ...data.groups.today,
    ...data.groups.week,
    ...data.groups.later,
    ...data.groups.completed,
    ...data.groups.stopped,
  ], [data.groups.today, data.groups.week, data.groups.later, data.groups.completed, data.groups.stopped]);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (restored) return;
    try {
      const raw = window.sessionStorage.getItem(VIEW_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { tab?: Tab; filters?: Partial<Filters>; selectedId?: string | null; scrollY?: number };
        if (saved.tab && ["today", "week", "reports", "settings"].includes(saved.tab)) setTab(saved.tab);
        if (saved.filters) setFilters({ ...DEFAULT_FILTERS, ...saved.filters });
        if (saved.selectedId) setSelected(allClients.find((client) => client.id === saved.selectedId) ?? null);
        requestAnimationFrame(() => window.scrollTo({ top: Number(saved.scrollY) || 0, behavior: "auto" }));
      }
    } catch {
      window.sessionStorage.removeItem(VIEW_KEY);
    } finally {
      setRestored(true);
    }
  }, [allClients, restored]);

  useEffect(() => {
    if (!restored) return;
    let frame = 0;
    const persist = () => {
      window.sessionStorage.setItem(VIEW_KEY, JSON.stringify({ tab, filters, selectedId: selected?.id ?? null, scrollY: window.scrollY }));
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(persist);
    };
    persist();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      persist();
      window.removeEventListener("scroll", onScroll);
    };
  }, [filters, restored, selected?.id, tab]);

  useEffect(() => {
    if (!selected) return;
    const fresh = allClients.find((client) => client.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [allClients, selected]);

  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selected]);

  const filteredClients = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return allClients.filter((client) => {
      if (q) {
        const haystack = [client.full_name, client.ref, client.phone, client.email, client.id, client.current_status, client.pipeline_stage, client.next_step, client.assigned_name, client.assigned_staff_code, client.site_code, client.shift_code]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filters.status && client.current_status !== filters.status) return false;
      if (filters.owner === "unassigned" && client.assigned_staff) return false;
      if (filters.owner && filters.owner !== "unassigned" && client.assigned_staff !== filters.owner) return false;
      if (filters.source && client.source !== filters.source) return false;
      if (filters.agency === "agency" && client.via_agency !== true) return false;
      if (filters.agency === "direct" && client.via_agency === true) return false;
      if (filters.lifecycle === "active" && ["completed", "cancelled"].includes(client.current_status)) return false;
      if (filters.lifecycle === "completed" && client.current_status !== "completed") return false;
      if (filters.lifecycle === "stopped" && client.current_status !== "cancelled") return false;
      if (filters.date === "today" && !isRecent(client.created_at, 1, now)) return false;
      if (filters.date === "7" && !isRecent(client.created_at, 7, now)) return false;
      if (filters.date === "30" && !isRecent(client.created_at, 30, now)) return false;
      return true;
    });
  }, [allClients, filters, now]);

  const groups = useMemo(() => {
    const result = {
      newClients: [] as DashboardClient[],
      needsAction: [] as DashboardClient[],
      inProgress: [] as DashboardClient[],
      upcoming: [] as DashboardClient[],
      completed: [] as DashboardClient[],
      stopped: [] as DashboardClient[],
    };
    for (const client of filteredClients) {
      if (client.current_status === "completed") { result.completed.push(client); continue; }
      if (client.current_status === "cancelled") { result.stopped.push(client); continue; }
      if (client.current_status === "new_intake") { result.newClients.push(client); continue; }
      if (NEEDS_ACTION.has(client.current_status) || client.has_today_appointment || client.has_today_task || client.has_today_followup) {
        result.needsAction.push(client);
        continue;
      }
      if (client.has_week_appointment || client.has_week_task || client.has_week_followup) { result.upcoming.push(client); continue; }
      result.inProgress.push(client);
    }
    return result;
  }, [filteredClients]);

  const weekClients = useMemo(() => filteredClients.filter((client) =>
    client.has_today_appointment || client.has_today_task || client.has_today_followup ||
    client.has_week_appointment || client.has_week_task || client.has_week_followup
  ), [filteredClients]);

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  async function bulkAssign() {
    if (!canBulkAssign || !selectedIds.size || bulkState.kind === "saving") return;
    setBulkState({ kind: "saving", message: "Saving assignment…" });
    const response = await fetch("/api/staff/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "bulk_assign", client_ids: Array.from(selectedIds), staff_id: bulkStaffId || null }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok || !body?.ok) {
      setBulkState({ kind: "error", message: body?.error?.message ?? "Assignment failed. No local success was applied." });
      return;
    }
    setBulkState({ kind: "success", message: `${selectedIds.size} client${selectedIds.size === 1 ? "" : "s"} updated.` });
    setSelectedIds(new Set());
    router.refresh();
  }

  async function exportPdf() {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let y = 748;
    const write = (text: string, size = 10, strong = false) => {
      page.drawText(text.slice(0, 95), { x: 42, y, size, font: strong ? bold : font, color: rgb(.08, .1, .15) });
      y -= size + 8;
    };
    write("CAREER GATE — Staff Report", 17, true);
    write(`Period: last ${report.days} days`, 10);
    write(`New clients: ${report.new_clients}`, 11, true);
    write(`Average processing time: ${report.average_processing_days == null ? "N/A" : `${report.average_processing_days} days`}`, 11, true);
    y -= 6;
    write("Status distribution", 12, true);
    report.by_status.forEach((row) => write(`${statusMeta(row.key).label}: ${row.n}`));
    y -= 6;
    write("Staff activity", 12, true);
    report.by_staff.forEach((row) => write(`${row.name}: ${row.n} actions`));
    y -= 6;
    write("Documents", 12, true);
    report.documents.forEach((row) => write(`${row.key}: ${row.n}`));
    y -= 6;
    write("Appointments", 12, true);
    report.appointments.forEach((row) => write(`${row.key}: ${row.n}`));
    const bytes = await pdf.save();
    downloadBlob(`career-gate-report-${report.days}d.pdf`, new Blob([bytes as BlobPart], { type: "application/pdf" }));
  }

  const tabs: { id: Tab; ar: string; en: string }[] = [
    { id: "today", ar: "اليوم", en: "Today" },
    { id: "week", ar: "الأسبوع", en: "Week" },
    { id: "reports", ar: "التقارير", en: "Reports" },
    { id: "settings", ar: "الإعدادات", en: "Settings" },
  ];

  return (
    <div className="staff-dashboard-frame" data-testid="staff-dashboard">
      <section className="staff-dashboard-hero" aria-labelledby="staff-dashboard-title">
        <div>
          <p className="staff-dashboard-kicker">LIVE OPERATIONS CENTER</p>
          <h1 id="staff-dashboard-title">Staff Dashboard</h1>
          <p>Prioritize new requests, files requiring action, scheduled work, and completed cases without leaving the operations workspace.</p>
        </div>
        <span className="staff-dashboard-live">Operational data</span>
      </section>

      <div className="staff-dashboard-tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className="staff-tab"
            data-active={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            <span lang="ar" dir="rtl">{item.ar}</span><span className="ms-2 text-xs text-slate-500">{item.en}</span>
          </button>
        ))}
      </div>

      {(tab === "today" || tab === "week") && (
        <>
          <div className="staff-dashboard-toolbar" aria-label="Dashboard filters">
            <label className="sr-only" htmlFor="dashboard-search">Search dashboard clients</label>
            <input
              id="dashboard-search"
              type="search"
              value={filters.q}
              placeholder="Name, file, phone, email, client ID…"
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
            />
            <select aria-label="Filter by status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
            </select>
            <select aria-label="Filter by assigned staff" value={filters.owner} onChange={(event) => setFilters((current) => ({ ...current, owner: event.target.value }))}>
              <option value="">All staff</option>
              <option value="unassigned">Unassigned</option>
              {data.settings.team.filter((member) => member.active).map((member) => <option key={member.id} value={member.id}>{member.display_name}</option>)}
            </select>
            <select aria-label="Filter by source" value={filters.source} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))}>
              <option value="">All sources</option>
              <option value="public_intake">Portal</option>
              <option value="staff_manual">Office</option>
            </select>
            <select aria-label="Filter by agency" value={filters.agency} onChange={(event) => setFilters((current) => ({ ...current, agency: event.target.value as Filters["agency"] }))}>
              <option value="all">Agency: all</option>
              <option value="agency">Via agency</option>
              <option value="direct">Direct / not marked agency</option>
            </select>
            <select aria-label="Filter by created date" value={filters.date} onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value as Filters["date"] }))}>
              <option value="all">Any created date</option>
              <option value="today">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </select>
            <select aria-label="Filter by lifecycle" value={filters.lifecycle} onChange={(event) => setFilters((current) => ({ ...current, lifecycle: event.target.value as Filters["lifecycle"] }))}>
              <option value="all">Active + closed</option>
              <option value="active">Active only</option>
              <option value="completed">Completed only</option>
              <option value="stopped">Stopped only</option>
            </select>
          </div>
          <div className="staff-dashboard-filter-summary">
            <span>{filteredClients.length} of {allClients.length} visible · Search and filters stay in this browser session.</span>
            <button type="button" className="staff-dashboard-reset" onClick={resetFilters}>Reset filters</button>
          </div>
        </>
      )}

      {tab === "today" && (
        <div className="space-y-4">
          <div>
            <div>
              <p className="staff-dashboard-section-title"><Icon name="alert" />Needs your attention</p>
              <p className="staff-dashboard-section-subtitle">Live counts from the current staff-scoped database view.</p>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="New clients" value={data.attention.new_clients} tone="#D8B56A" href="/staff/clients?status=new_intake" testId="count-new_intake" cardTestId="card-new_intake" />
              <Kpi label="Appointments within 2 hours" value={data.attention.appointments_2h} tone="#22D3EE" href="/staff/appointments" />
              <Kpi label="Overdue follow-ups" value={data.attention.overdue_followups} tone="#EF4444" href="/staff/follow-ups?view=overdue" />
              <Kpi label="Documents needing action" value={data.attention.document_attention} tone="#F59E0B" />
            </div>
          </div>

          <Group title="New" subtitle="New Intake" clients={groups.newClients} now={now} defaultOpen onOpen={setSelected} selectable={canBulkAssign} selectedIds={selectedIds} onToggle={toggleSelected} />
          <Group title="Needs Action" subtitle="Review, appointment, or due work" clients={groups.needsAction} now={now} defaultOpen onOpen={setSelected} selectable={canBulkAssign} selectedIds={selectedIds} onToggle={toggleSelected} />
          <Group title="In Progress" subtitle="Active workflow" clients={groups.inProgress} now={now} onOpen={setSelected} selectable={canBulkAssign} selectedIds={selectedIds} onToggle={toggleSelected} />
          <Group title="Upcoming" subtitle="Tasks, follow-ups, or appointments in the next 7 days" clients={groups.upcoming} now={now} onOpen={setSelected} selectable={canBulkAssign} selectedIds={selectedIds} onToggle={toggleSelected} />
          <Group title="Completed" clients={groups.completed} now={now} onOpen={setSelected} selectable={canBulkAssign} selectedIds={selectedIds} onToggle={toggleSelected} />
          <Group title="Stopped" subtitle="Cancelled workflow state" clients={groups.stopped} now={now} onOpen={setSelected} selectable={canBulkAssign} selectedIds={selectedIds} onToggle={toggleSelected} />
        </div>
      )}

      {tab === "week" && (
        <div className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div><h2 className="text-[22px] font-bold text-slate-100">Rolling 7 days</h2><p className="mt-1 text-sm text-slate-500">Scheduled appointments, due tasks, follow-ups, and active attention cases.</p></div>
            <span className="font-mono text-sm text-slate-500">{weekClients.length} clients</span>
          </div>
          <Group title="Upcoming operational work" clients={weekClients} now={now} defaultOpen onOpen={setSelected} selectable={canBulkAssign} selectedIds={selectedIds} onToggle={toggleSelected} />
        </div>
      )}

      {tab === "reports" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="me-auto"><h2 className="text-[22px] font-bold text-slate-100">Reports</h2><p className="mt-1 text-sm text-slate-500">Database-derived operational metrics.</p></div>
            <select value={period} onChange={(event) => setPeriod(event.target.value)} className="input w-auto min-w-40">
              <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
            </select>
            <button type="button" onClick={() => downloadBlob(`career-gate-report-${report.days}d.csv`, new Blob([csvText(report)], { type: "text/csv;charset=utf-8" }))}
              className="staff-header-action">CSV</button>
            <button type="button" onClick={exportPdf} className="staff-header-action">PDF</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="staff-kpi rounded-2xl p-5"><p>New clients</p><p className="mt-2 text-3xl font-semibold">{report.new_clients}</p></div>
            <div className="staff-kpi rounded-2xl p-5"><p>Average processing time</p><p className="mt-2 text-3xl font-semibold">{report.average_processing_days == null ? "—" : `${report.average_processing_days} days`}</p></div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ReportBlock title="Status distribution" rows={report.by_status.map((row) => ({ label: statusMeta(row.key).label, value: row.n, color: statusMeta(row.key).color }))} />
            <ReportBlock title="Staff performance" rows={report.by_staff.map((row) => ({ label: row.name, value: row.n }))} />
            <ReportBlock title="Documents" rows={report.documents.map((row) => ({ label: pretty(row.key), value: row.n }))} />
            <ReportBlock title="Appointments" rows={report.appointments.map((row) => ({ label: pretty(row.key), value: row.n }))} />
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="staff-glass rounded-2xl p-5">
            <div className="flex items-center justify-between"><h2 className="text-[18px] font-semibold">Staff Directory</h2>{meRole === "admin" && <Link href="/staff/settings/team" className="text-sm text-cyan-300 hover:text-cyan-200">Manage team</Link>}</div>
            <div className="mt-4 space-y-2">
              {data.settings.team.map((member) => (
                <div key={member.id} className="flex min-h-[58px] items-center gap-3 rounded-xl border border-white/[.06] bg-white/[.018] px-3 py-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-300/10 bg-cyan-300/[.04] text-sm text-cyan-100">{member.display_name.trim().slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0 flex-1"><p className="text-[15px] font-semibold text-slate-200">{member.display_name}</p><p className="truncate text-xs text-slate-500">{member.staff_code ?? member.email ?? "No staff code"}</p></div>
                  <span className="rounded-full border border-white/[.08] px-2.5 py-1 text-xs font-semibold uppercase text-slate-400">{member.role}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="staff-glass rounded-2xl p-5">
            <h2 className="text-[18px] font-semibold">Job Catalog</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="staff-kpi rounded-xl p-3"><dt className="text-slate-500">State</dt><dd className="mt-1 font-medium">{data.settings.catalog.state}</dd></div>
              <div className="staff-kpi rounded-xl p-3"><dt className="text-slate-500">Schema</dt><dd className="mt-1 font-mono">v{data.settings.catalog.schema_version}</dd></div>
              <div className="staff-kpi rounded-xl p-3"><dt className="text-slate-500">Facilities</dt><dd className="mt-1 font-mono">{data.settings.catalog.facilities}</dd></div>
              <div className="staff-kpi rounded-xl p-3"><dt className="text-slate-500">Selectable shifts</dt><dd className="mt-1 font-mono">{data.settings.catalog.selectable_options}</dd></div>
            </dl>
            <p className="mt-3 break-all font-mono text-xs text-slate-600">{data.settings.catalog.version}</p>
          </section>
          <section className="staff-glass rounded-2xl p-5 xl:col-span-2">
            <h2 className="text-[18px] font-semibold">Notifications & Integrations</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(data.settings.integrations).map(([key, value]) => (
                <div key={key} className="rounded-xl border border-white/[.06] bg-white/[.018] p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{pretty(key)}</p><p className={`mt-1 text-sm font-medium ${value === "CONFIGURED" ? "text-emerald-400" : "text-slate-500"}`}>{value}</p></div>
              ))}
            </div>
          </section>
        </div>
      )}

      {canBulkAssign && selectedIds.size > 0 && (
        <div className="staff-bulk-bar" role="region" aria-label="Bulk actions">
          <strong>{selectedIds.size} selected</strong>
          <select aria-label="Assign selected clients to staff" value={bulkStaffId} onChange={(event) => setBulkStaffId(event.target.value)} disabled={bulkState.kind === "saving"}>
            <option value="">Unassigned</option>
            {activeStaff.map((member) => <option key={member.id} value={member.id}>{member.display_name}{member.staff_code ? ` · ${member.staff_code}` : ""}</option>)}
          </select>
          <button type="button" data-primary="true" onClick={bulkAssign} disabled={bulkState.kind === "saving"}>{bulkState.kind === "saving" ? "Saving…" : "Assign selected"}</button>
          <button type="button" onClick={() => { setSelectedIds(new Set()); setBulkState({ kind: "idle", message: "" }); }} disabled={bulkState.kind === "saving"}>Clear</button>
          {bulkState.message && <span className={bulkState.kind === "error" ? "text-xs text-red-300" : bulkState.kind === "success" ? "text-xs text-emerald-300" : "text-xs text-slate-400"} role="status">{bulkState.message}</span>}
        </div>
      )}

      <div className="staff-bottom-bar fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-2xl p-1.5">
        {meRole !== "staff" && <Link href="/staff/new-client" className="flex items-center gap-2 rounded-xl px-3 py-2 text-slate-200 hover:bg-white/5"><Icon name="plus" />New client</Link>}
        <Link href="/staff/appointments" className="flex items-center gap-2 rounded-xl px-3 py-2 text-slate-300 hover:bg-white/5"><Icon name="calendar" />Appointments</Link>
        <Link href="/staff/tasks" className="flex items-center gap-2 rounded-xl px-3 py-2 text-slate-300 hover:bg-white/5"><Icon name="check" />My tasks</Link>
        <button type="button" onClick={() => setTab("settings")} className="rounded-xl px-3 py-2 text-slate-300 hover:bg-white/5">Settings</button>
      </div>

      {selected && (
        <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]" onMouseDown={() => setSelected(null)}>
          <aside
            className="staff-sidepanel absolute end-0 top-0 h-full w-full max-w-lg overflow-y-auto p-5"
            role="dialog"
            aria-modal="true"
            aria-label={`Client details for ${selected.full_name}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-cyan-300/10 bg-cyan-300/[.045] text-base font-semibold text-cyan-100">{selected.full_name.trim().slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1"><h2 className="truncate">{selected.full_name}</h2><code>{selected.ref}</code></div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-xl p-2 text-slate-500 hover:bg-white/5 hover:text-white" aria-label="Close client details"><Icon name="x" /></button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="staff-card-status"><span className="h-2 w-2 rounded-full" style={{ background: statusMeta(selected.current_status).color }} />{statusMeta(selected.current_status).label}</span>
              <span className="staff-card-status">{pretty(selected.pipeline_stage)}</span>
              {selected.via_agency === true && <span className="staff-priority-badge">AGENCY</span>}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href={`/staff/client/${selected.id}?action=status`} className="rounded-xl border border-white/10 px-3 py-2.5 text-center hover:border-cyan-300/20 hover:bg-cyan-300/[.04]">Update status</Link>
              <Link href={`/staff/client/${selected.id}/edit`} className="rounded-xl border border-white/10 px-3 py-2.5 text-center hover:border-cyan-300/20 hover:bg-cyan-300/[.04]">Correct data</Link>
            </div>

            <div className="mt-5 divide-y divide-white/[.06] rounded-2xl border border-white/[.07] bg-white/[.018]">
              {[
                ["Phone", selected.phone],
                ["Email", selected.email ?? "—"],
                ["Assigned Staff", selected.assigned_name ? `${selected.assigned_name}${selected.assigned_staff_code ? ` · ${selected.assigned_staff_code}` : ""}` : "Unassigned"],
                ["Source", sourceLabel(selected.source)],
                ["Job Preference", selected.site_code ? `${selected.site_code} · ${selected.shift_code ?? "—"}` : "None"],
                ["Documents", String(selected.document_count)],
                ["Appointments", selected.next_appointment ? dateTime(selected.next_appointment) ?? "Scheduled" : "None"],
                ["Notes", String(selected.note_count)],
                ["Tasks", String(selected.task_count)],
                ["Contacts", String(selected.contact_count)],
                ["Created", dateTime(selected.created_at) ?? dateOnly(selected.created_at) ?? "—"],
                ["Last Activity", relativeTime(selected.updated_at, now)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="staff-drawer-label">{label}</span>
                  <span className="staff-drawer-value max-w-[64%] break-words text-end">{value}</span>
                </div>
              ))}
            </div>

            <section className="staff-timeline" aria-label="Operational timeline">
              <h3 className="mb-4 text-sm font-semibold text-slate-200">Operational timeline</h3>
              <div className="staff-timeline-item"><strong className="block text-slate-200">Client created</strong><span>{dateTime(selected.created_at) ?? dateOnly(selected.created_at)}</span></div>
              {(selected.next_appointment || selected.next_task_due || selected.next_followup_due) && <div className="staff-timeline-item"><strong className="block text-slate-200">Scheduled work</strong><span>{clientEvent(selected)}</span></div>}
              <div className="staff-timeline-item"><strong className="block text-slate-200">Current state · {statusMeta(selected.current_status).label}</strong><span>{pretty(selected.pipeline_stage)} · {selected.next_step}</span></div>
              <div className="staff-timeline-item"><strong className="block text-slate-200">Last recorded update</strong><span>{dateTime(selected.updated_at) ?? dateOnly(selected.updated_at)}</span></div>
            </section>

            {selected.document_count === 0 && (
              <div className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[.035] p-3 text-sm text-amber-100" role="status">
                No documents are currently recorded on this client file.
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href={`/staff/client/${selected.id}?action=note`} className="rounded-xl border border-white/10 px-3 py-2 text-center hover:bg-white/5">+ Note</Link>
              <Link href={`/staff/client/${selected.id}?action=task`} className="rounded-xl border border-white/10 px-3 py-2 text-center hover:bg-white/5">+ Task</Link>
              {meRole !== "staff" && <Link href={`/staff/client/${selected.id}?action=appointment`} className="rounded-xl border border-white/10 px-3 py-2 text-center hover:bg-white/5">+ Appointment</Link>}
              <Link href={`/staff/client/${selected.id}?action=contacted`} className="rounded-xl border border-white/10 px-3 py-2 text-center hover:bg-white/5">Contact</Link>
            </div>
            <Link href={`/staff/client/${selected.id}`} className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-blue-500 to-blue-700 px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(37,99,235,.22)] hover:brightness-105">Open full file <Icon name="arrow" /></Link>
          </aside>
        </div>
      )}
    </div>
  );
}
