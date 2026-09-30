"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { RealtimeRefresher } from "@/components/staff/RealtimeRefresher";
import { useStaff } from "@/components/staff/StaffContext";
import type {
  DashboardClient,
  DashboardPeriod,
  DashboardReport,
  DashboardTab,
  StaffDashboardData,
} from "@/lib/staff-dashboard";

type IconName = "search" | "calendar" | "check" | "plus" | "file" | "phone" | "activity" | "user" | "arrow" | "x" | "clock" | "alert";

const STATUS_META: Record<string, { label: string; color: string }> = {
  new_intake: { label: "New Intake", color: "#64748B" },
  needs_review: { label: "Needs Review", color: "#6366F1" },
  ready_to_apply: { label: "Ready to Apply", color: "#8B5CF6" },
  application_in_progress: { label: "Application in Progress", color: "#8B5CF6" },
  assessment_required: { label: "Assessment Required", color: "#F59E0B" },
  shift_selected: { label: "Shift Selected", color: "#22D3EE" },
  appointment_required: { label: "Appointment Required", color: "#F59E0B" },
  appointment_scheduled: { label: "Appointment Scheduled", color: "#22D3EE" },
  pre_hire_completed: { label: "Pre-Hire Completed", color: "#22D3EE" },
  screening_pending: { label: "Screening Pending", color: "#22D3EE" },
  i9_available: { label: "I-9 Available", color: "#22D3EE" },
  post_hire_tasks: { label: "Post-Hire Tasks", color: "#22D3EE" },
  ready_for_first_day: { label: "Ready for First Day", color: "#10B981" },
  completed: { label: "Completed", color: "#10B981" },
  cancelled: { label: "Stopped", color: "#EF4444" },
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
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Detroit", month: "short", day: "numeric" }).format(date);
}

function contactAge(value: string | null) {
  if (!value) return "No contact recorded";
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000));
  if (days === 0) return "Contacted today";
  if (days === 1) return "Last contact 1 day ago";
  return `Last contact ${days} days ago`;
}

function clientEvent(client: DashboardClient) {
  if (client.next_appointment) return `${dateTime(client.next_appointment)}${client.site_code ? ` · ${client.site_code}` : ""}`;
  if (client.next_task_due) return `Task due ${dateTime(client.next_task_due) ?? dateOnly(client.next_task_due)}`;
  if (client.next_followup_due) return `Follow-up ${dateOnly(client.next_followup_due)}`;
  return client.site_code ? client.site_code : "No scheduled event";
}

function ClientCard({ client, onOpen }: { client: DashboardClient; onOpen: () => void }) {
  const meta = statusMeta(client.current_status);
  return (
    <article className="staff-client-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: meta.color, boxShadow: `0 0 18px ${meta.color}66` }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="truncate text-sm font-semibold text-slate-100">{client.full_name}</h3>
            <code className="text-[11px] text-slate-500">{client.ref}</code>
          </div>
          <p className="mt-2 flex items-center gap-2 text-xs text-slate-400"><Icon name="calendar" />{clientEvent(client)}</p>
          <p className="mt-1.5 text-xs text-slate-300"><span className="text-slate-500">Next:</span> {client.next_step}</p>
          <p className="mt-1.5 flex items-center gap-2 text-xs text-slate-500"><Icon name="phone" />{contactAge(client.last_contact_at)}</p>
        </div>
        <button type="button" onClick={onOpen} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-200 hover:border-white/20 hover:bg-white/5">
          Open
        </button>
      </div>
    </article>
  );
}

function Group({ title, clients, defaultOpen = false, onOpen }: { title: string; clients: DashboardClient[]; defaultOpen?: boolean; onOpen: (c: DashboardClient) => void }) {
  return (
    <details open={defaultOpen} className="staff-glass rounded-2xl">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-slate-200">
        <span>{title} <span className="ml-2 font-mono text-xs text-slate-500">{clients.length}</span></span>
        <span className="text-slate-600">⌄</span>
      </summary>
      <div className="grid gap-2 border-t border-white/[.06] p-3 lg:grid-cols-2 2xl:grid-cols-3">
        {clients.length ? clients.map((client) => <ClientCard key={client.id} client={client} onOpen={() => onOpen(client)} />) : <p className="col-span-full px-2 py-5 text-sm text-slate-600">No clients in this group.</p>}
      </div>
    </details>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="staff-kpi rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400">{label}</p>
        <span className="h-2 w-2 rounded-full" style={{ background: tone }} />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">{value}</p>
    </div>
  );
}

function ReportBlock({ title, rows }: { title: string; rows: { label: string; value: number; color?: string }[] }) {
  return (
    <section className="staff-glass rounded-2xl p-4">
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      <div className="mt-3 space-y-2">
        {rows.length ? rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 rounded-xl border border-white/[.05] bg-white/[.018] px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-xs text-slate-300">
              {row.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />}
              <span className="truncate">{row.label}</span>
            </div>
            <strong className="font-mono text-xs text-slate-100">{row.value}</strong>
          </div>
        )) : <p className="py-4 text-xs text-slate-600">No data for this period.</p>}
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
    [], ["Status", "Count"], ...report.by_status.map((x) => [x.key, String(x.n)]),
    [], ["Staff", "Actions"], ...report.by_staff.map((x) => [x.name, String(x.n)]),
    [], ["Document status", "Count"], ...report.documents.map((x) => [x.key, String(x.n)]),
    [], ["Appointment status", "Count"], ...report.appointments.map((x) => [x.key, String(x.n)]),
  ];
  return rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function StaffDashboard({
  data,
  initialTab = "today",
  initialPeriod = 7,
  meRole,
}: {
  data: StaffDashboardData;
  initialTab?: DashboardTab;
  initialPeriod?: DashboardPeriod;
  meRole: string;
}) {
  const router = useRouter();
  const { staff } = useStaff();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<DashboardClient | null>(null);
  const tab = initialTab;
  const report = data.reports[String(initialPeriod)] ?? null;
  const weekClients = useMemo(() => [...data.groups.today, ...data.groups.week], [data.groups.today, data.groups.week]);

  const navigateTab = (nextTab: DashboardTab) => {
    const href = nextTab === "reports"
      ? `/staff?tab=reports&period=${initialPeriod}`
      : `/staff?tab=${nextTab}`;
    startTransition(() => {
      router.push(href, { scroll: false });
    });
  };

  const navigatePeriod = (nextPeriod: DashboardPeriod) => {
    startTransition(() => {
      router.push(`/staff?tab=reports&period=${nextPeriod}`, { scroll: false });
    });
  };

  async function exportPdf() {
    if (!report) return;
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
    report.by_status.forEach((r) => write(`${statusMeta(r.key).label}: ${r.n}`));
    y -= 6;
    write("Staff activity", 12, true);
    report.by_staff.forEach((r) => write(`${r.name}: ${r.n} actions`));
    y -= 6;
    write("Documents", 12, true);
    report.documents.forEach((r) => write(`${r.key}: ${r.n}`));
    y -= 6;
    write("Appointments", 12, true);
    report.appointments.forEach((r) => write(`${r.key}: ${r.n}`));
    const bytes = await pdf.save();
    downloadBlob(`career-gate-report-${report.days}d.pdf`, new Blob([bytes as BlobPart], { type: "application/pdf" }));
  }

  const tabs: { id: DashboardTab; ar: string; en: string }[] = [
    { id: "today", ar: "اليوم", en: "Today" },
    { id: "week", ar: "الأسبوع", en: "Week" },
    { id: "reports", ar: "التقارير", en: "Reports" },
    { id: "settings", ar: "الإعدادات", en: "Settings" },
  ];

  return (
    <div className="mx-auto max-w-[1600px] pb-28" aria-busy={isPending}>
      <div className="mb-5 flex items-center gap-1 overflow-x-auto rounded-2xl border border-white/[.06] bg-white/[.018] p-1.5">
        {tabs.map((item) => (
          <button key={item.id} type="button" className="staff-tab min-w-[116px] rounded-xl px-4 py-2.5 text-sm font-medium" data-active={tab === item.id}
            onClick={() => navigateTab(item.id)}>
            <span lang="ar" dir="rtl">{item.ar}</span><span className="ml-2 text-[10px] text-slate-600">{item.en}</span>
          </button>
        ))}
        {(tab === "today" || tab === "week") && <span className="ml-auto px-2"><RealtimeRefresher /></span>}
      </div>

      {tab === "today" && (
        <div className="space-y-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Icon name="alert" className="h-4 w-4 text-amber-400" /> يحتاج انتباهك</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="New clients" value={data.attention.new_clients} tone="#64748B" />
              <Kpi label="Appointments within 2 hours" value={data.attention.appointments_2h} tone="#22D3EE" />
              <Kpi label="Overdue follow-ups" value={data.attention.overdue_followups} tone="#EF4444" />
              <Kpi label="Documents needing action" value={data.attention.document_attention} tone="#F59E0B" />
            </div>
          </div>
          <Group title="اليوم · Today" clients={data.groups.today} defaultOpen onOpen={setSelected} />
          <Group title="هذا الأسبوع · This week" clients={data.groups.week} onOpen={setSelected} />
          <Group title="لاحقاً · Later" clients={data.groups.later} onOpen={setSelected} />
          <Group title="مكتملة · Completed" clients={data.groups.completed} onOpen={setSelected} />
          <Group title="متوقفة · Stopped" clients={data.groups.stopped} onOpen={setSelected} />
        </div>
      )}

      {tab === "week" && (
        <div className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div><h2 className="text-lg font-semibold text-slate-100">Rolling 7 days</h2><p className="mt-1 text-xs text-slate-500">Scheduled appointments, due tasks, follow-ups, and active attention cases.</p></div>
            <span className="font-mono text-xs text-slate-500">{weekClients.length} clients</span>
          </div>
          <Group title="Next 7 days" clients={weekClients} defaultOpen onOpen={setSelected} />
        </div>
      )}

      {tab === "reports" && report && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto"><h2 className="text-lg font-semibold text-slate-100">Reports</h2><p className="mt-1 text-xs text-slate-500">Database-derived operational metrics.</p></div>
            <select value={String(initialPeriod)} onChange={(e) => navigatePeriod(Number(e.target.value) as DashboardPeriod)} className="input w-auto min-w-40">
              <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
            </select>
            <button type="button" onClick={() => downloadBlob(`career-gate-report-${report.days}d.csv`, new Blob([csvText(report)], { type: "text/csv;charset=utf-8" }))}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium hover:bg-white/5">CSV</button>
            <button type="button" onClick={exportPdf} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium hover:bg-white/5">PDF</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="staff-kpi rounded-2xl p-5"><p className="text-xs text-slate-500">New clients</p><p className="mt-2 text-3xl font-semibold">{report.new_clients}</p></div>
            <div className="staff-kpi rounded-2xl p-5"><p className="text-xs text-slate-500">Average processing time</p><p className="mt-2 text-3xl font-semibold">{report.average_processing_days == null ? "—" : `${report.average_processing_days} days`}</p></div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ReportBlock title="Status distribution" rows={report.by_status.map((x) => ({ label: statusMeta(x.key).label, value: x.n, color: statusMeta(x.key).color }))} />
            <ReportBlock title="Staff performance" rows={report.by_staff.map((x) => ({ label: x.name, value: x.n }))} />
            <ReportBlock title="Documents" rows={report.documents.map((x) => ({ label: x.key.replace(/_/g, " "), value: x.n }))} />
            <ReportBlock title="Appointments" rows={report.appointments.map((x) => ({ label: x.key.replace(/_/g, " "), value: x.n }))} />
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="staff-glass rounded-2xl p-5">
            <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Staff Directory</h2>{meRole === "admin" && <Link href="/staff/settings/team" className="text-xs text-indigo-300 hover:text-indigo-200">Manage team</Link>}</div>
            <div className="mt-4 space-y-2">
              {staff.map((member) => (
                <div key={member.id} className="flex items-center gap-3 rounded-xl border border-white/[.05] bg-white/[.018] px-3 py-3">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-white/[.06] text-xs text-slate-300"><Icon name="user" /></span>
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-200">{member.display_name}</p><p className="truncate text-xs text-slate-600">{member.email ?? "No sign-in email assigned"}</p></div>
                  <span className="rounded-full border border-white/[.07] px-2 py-1 text-[10px] uppercase text-slate-400">{member.role}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="staff-glass rounded-2xl p-5">
            <h2 className="text-sm font-semibold">Job Catalog</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="staff-kpi rounded-xl p-3"><dt className="text-slate-500">State</dt><dd className="mt-1 font-medium">{data.settings.catalog.state}</dd></div>
              <div className="staff-kpi rounded-xl p-3"><dt className="text-slate-500">Schema</dt><dd className="mt-1 font-mono">v{data.settings.catalog.schema_version}</dd></div>
              <div className="staff-kpi rounded-xl p-3"><dt className="text-slate-500">Facilities</dt><dd className="mt-1 font-mono">{data.settings.catalog.facilities}</dd></div>
              <div className="staff-kpi rounded-xl p-3"><dt className="text-slate-500">Selectable shifts</dt><dd className="mt-1 font-mono">{data.settings.catalog.selectable_options}</dd></div>
            </dl>
            <p className="mt-3 break-all font-mono text-[10px] text-slate-600">{data.settings.catalog.version}</p>
          </section>
          <section className="staff-glass rounded-2xl p-5 xl:col-span-2">
            <h2 className="text-sm font-semibold">Notifications & Integrations</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(data.settings.integrations).map(([key, value]) => (
                <div key={key} className="rounded-xl border border-white/[.05] bg-white/[.018] p-3"><p className="text-[10px] uppercase tracking-wide text-slate-600">{key.replace(/_/g, " ")}</p><p className={`mt-1 text-xs font-medium ${value === "CONFIGURED" ? "text-emerald-400" : "text-slate-500"}`}>{value}</p></div>
              ))}
            </div>
          </section>
        </div>
      )}

      <div className="staff-bottom-bar fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-2xl p-1.5">
        {meRole !== "staff" && <Link href="/staff/new-client" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/5"><Icon name="plus" />New client</Link>}
        <Link href="/staff/appointments" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/5"><Icon name="calendar" />Appointments</Link>
        <Link href="/staff/tasks" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/5"><Icon name="check" />My tasks</Link>
        <button type="button" onClick={() => navigateTab("settings")} className="rounded-xl px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/5">Settings</button>
      </div>

      {selected && (
        <div className="fixed inset-0 z-40 bg-black/55" onMouseDown={() => setSelected(null)}>
          <aside className="staff-sidepanel absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto p-5" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/[.06] text-sm font-semibold text-slate-200">{selected.full_name.trim().slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold">{selected.full_name}</h2><code className="text-xs text-slate-500">{selected.ref}</code></div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-white" aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[.06] bg-white/[.025] p-3 text-xs">
              <span className="h-2 w-2 rounded-full" style={{ background: statusMeta(selected.current_status).color }} />
              <span>{statusMeta(selected.current_status).label}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href={`/staff/client/${selected.id}?action=status`} className="rounded-xl border border-white/10 px-3 py-2.5 text-center text-xs hover:bg-white/5">Update status</Link>
              <Link href={`/staff/client/${selected.id}/edit`} className="rounded-xl border border-white/10 px-3 py-2.5 text-center text-xs hover:bg-white/5">Correct data</Link>
            </div>
            <div className="mt-5 divide-y divide-white/[.06] rounded-2xl border border-white/[.06]">
              {[
                ["Profile", selected.assigned_name ?? "Unassigned"],
                ["Job Preferences", selected.site_code ? `${selected.site_code} · ${selected.shift_code ?? "—"}` : "None"],
                ["Documents", String(selected.document_count)],
                ["Appointments", selected.next_appointment ? dateTime(selected.next_appointment) ?? "Scheduled" : "None"],
                ["Notes", String(selected.note_count)],
                ["Tasks", String(selected.task_count)],
                ["Contacts", String(selected.contact_count)],
                ["Activity", contactAge(selected.last_contact_at)],
              ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 px-4 py-3 text-xs"><span className="text-slate-500">{label}</span><span className="max-w-[60%] truncate text-right text-slate-200">{value}</span></div>)}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href={`/staff/client/${selected.id}?action=note`} className="rounded-xl border border-white/10 px-3 py-2 text-center text-xs hover:bg-white/5">+ Note</Link>
              <Link href={`/staff/client/${selected.id}?action=task`} className="rounded-xl border border-white/10 px-3 py-2 text-center text-xs hover:bg-white/5">+ Task</Link>
              {meRole !== "staff" && <Link href={`/staff/client/${selected.id}?action=appointment`} className="rounded-xl border border-white/10 px-3 py-2 text-center text-xs hover:bg-white/5">+ Appointment</Link>}
              <Link href={`/staff/client/${selected.id}?action=contacted`} className="rounded-xl border border-white/10 px-3 py-2 text-center text-xs hover:bg-white/5">Contact</Link>
            </div>
            <Link href={`/staff/client/${selected.id}`} className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-400">Open full file <Icon name="arrow" /></Link>
          </aside>
        </div>
      )}
    </div>
  );
}
