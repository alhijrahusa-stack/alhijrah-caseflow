import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";
import { STATUSES, STATUS_LABELS, type Status } from "@/lib/domain";

export const REPORT_PERIODS = [7, 30, 90] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** Days without an update after which an active file counts as stalled. */
export const STALL_DAYS = 14;

const COMPLETION_ACTIONS = ["status_changed", "status_overridden"];
const OPEN_TASKS = ["pending", "in_progress"];

export function parseReportPeriod(value: string | string[] | undefined): ReportPeriod {
  const raw = Number(Array.isArray(value) ? value[0] : value);
  return (REPORT_PERIODS as readonly number[]).includes(raw) ? (raw as ReportPeriod) : 30;
}

export type CountRow = { key: string; n: number };
export type StaffPerformance = { id: string; name: string; active: number; ready_or_done: number; overdue_tasks: number; completed_period: number };
export type WeeklyIntake = { week_start: string; n: number };
export type StalledStatus = { status: Status; n: number; oldest_days: number };

export type ReportKpis = {
  newCurrent: number;
  newPrevious: number;
  last30: number;
  completedCurrent: number;
  completedPrevious: number;
  collectedCurrent: number;
  collectedPrevious: number;
  receivables: number;
  active: number;
  unassignedActive: number;
  stalled: number;
  medianDaysToComplete: number | null;
  documentsAwaitingReview: number;
  urgentAlerts: number;
};

export type Insight = { tone: "attention" | "positive" | "neutral"; text: string; href: string; action: string };

export type ReportIntelligence = {
  period: ReportPeriod;
  kpis: ReportKpis;
  funnel: { status: Status; label: string; n: number }[];
  weekly: WeeklyIntake[];
  staff: StaffPerformance[];
  stalled: StalledStatus[];
  byStatus: CountRow[];
  bySource: CountRow[];
  byStaff: { name: string; n: number; ready_or_done: number }[];
  bySite: CountRow[];
  docs: CountRow[];
  alerts: CountRow[];
  insights: Insight[];
};

const num = (value: unknown) => (value == null ? 0 : Number(value));

/** Relative change in whole percent, or null when there is no base to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Deterministic findings derived from the figures on the page. Each one states
 * the numbers it rests on and links to where the work is done; nothing is
 * inferred beyond the counts.
 */
export function deriveInsights(k: ReportKpis, stalled: StalledStatus[], period: ReportPeriod): Insight[] {
  const out: Insight[] = [];
  if (k.urgentAlerts > 0) {
    out.push({ tone: "attention", text: `${k.urgentAlerts} high or critical audit alert${k.urgentAlerts === 1 ? " is" : "s are"} open.`, href: "/staff/audit-alerts", action: "Review alerts" });
  }
  if (k.stalled > 0) {
    const top = stalled[0];
    const where = top ? ` The largest group is ${STATUS_LABELS[top.status]} (${top.n}, oldest ${top.oldest_days} days).` : "";
    out.push({ tone: "attention", text: `${k.stalled} active file${k.stalled === 1 ? " has" : "s have"} had no update for ${STALL_DAYS}+ days.${where}`, href: "/staff/pipeline", action: "Open pipeline" });
  }
  if (k.unassignedActive > 0) {
    out.push({ tone: "attention", text: `${k.unassignedActive} active file${k.unassignedActive === 1 ? " has" : "s have"} no assigned owner.`, href: "/staff/staff?tab=assignments", action: "Assign owners" });
  }
  if (k.documentsAwaitingReview > 0) {
    out.push({ tone: "attention", text: `${k.documentsAwaitingReview} document${k.documentsAwaitingReview === 1 ? " awaits" : "s await"} staff review.`, href: "/staff", action: "Open dashboard" });
  }
  const intake = percentChange(k.newCurrent, k.newPrevious);
  if (intake !== null && Math.abs(intake) >= 20) {
    out.push({
      tone: intake > 0 ? "positive" : "attention",
      text: `New applications are ${intake > 0 ? "up" : "down"} ${Math.abs(intake)}% against the previous ${period} days (${k.newCurrent} vs ${k.newPrevious}).`,
      href: "/staff/clients",
      action: "Open clients",
    });
  }
  const collected = percentChange(k.collectedCurrent, k.collectedPrevious);
  if (collected !== null && Math.abs(collected) >= 20) {
    out.push({
      tone: collected > 0 ? "positive" : "attention",
      text: `Collections are ${collected > 0 ? "up" : "down"} ${Math.abs(collected)}% against the previous ${period} days.`,
      href: "/staff/accounting",
      action: "Open accounts",
    });
  }
  if (k.completedCurrent > 0 && k.medianDaysToComplete !== null) {
    out.push({
      tone: "positive",
      text: `${k.completedCurrent} file${k.completedCurrent === 1 ? "" : "s"} completed in the last ${period} days; median ${k.medianDaysToComplete} day${k.medianDaysToComplete === 1 ? "" : "s"} from intake to completion.`,
      href: "/staff/archive",
      action: "Open archive",
    });
  }
  if (!out.length) {
    out.push({ tone: "neutral", text: "No open exceptions: no stalled, unassigned or unreviewed work was found.", href: "/staff", action: "Open dashboard" });
  }
  return out;
}

export async function reportIntelligence(session: StaffSession, period: ReportPeriod): Promise<ReportIntelligence> {
  return withStaff(session, async (tx) => {
    // Fresh fragments per use: a fragment is bound to the statement it is interpolated into.
    const current = () => tx`now() - make_interval(days => ${period})`;
    const previous = () => tx`now() - make_interval(days => ${period * 2})`;
    const [kpiRows, byStatus, weekly, staff, stalled, bySource, byStaff, bySite, docs, alerts] = await Promise.all([
      tx`
        with active as (
          select id,assigned_staff,updated_at from clients
          where deleted_at is null and current_status not in ('completed','cancelled')
        ),
        completions as (
          select l.client_id,min(l.created_at) completed_at
          from activity_log l
          where l.action=any(${COMPLETION_ACTIONS}) and l.new_value->>'status'='completed' and l.created_at>=${previous()}
          group by l.client_id
        )
        select
          (select count(*) from clients where deleted_at is null and created_at>=${current()})::int new_current,
          (select count(*) from clients where deleted_at is null and created_at>=${previous()} and created_at<${current()})::int new_previous,
          (select count(*) from clients where deleted_at is null and created_at>=now()-interval '30 days')::int last30,
          (select count(*) from completions where completed_at>=${current()})::int completed_current,
          (select count(*) from completions where completed_at<${current()})::int completed_previous,
          (select coalesce(sum(t.amount),0) from payment_transactions t
            where t.transaction_type='payment' and t.status='confirmed' and t.occurred_at>=${current()}) collected_current,
          (select coalesce(sum(t.amount),0) from payment_transactions t
            where t.transaction_type='payment' and t.status='confirmed' and t.occurred_at>=${previous()} and t.occurred_at<${current()}) collected_previous,
          (select coalesce(sum(greatest(b.balance,0)),0) from client_account_balances b join active a on a.id=b.client_id) receivables,
          (select count(*) from active)::int active,
          (select count(*) from active where assigned_staff is null)::int unassigned_active,
          (select count(*) from active where updated_at<now()-make_interval(days => ${STALL_DAYS}))::int stalled,
          (select round(percentile_cont(0.5) within group (order by extract(epoch from (cp.completed_at-c.created_at))/86400)::numeric)
             from completions cp join clients c on c.id=cp.client_id where cp.completed_at>=${current()}) median_days,
          (select count(*) from documents d join clients c on c.id=d.client_id
            where c.deleted_at is null and d.status='needs_review')::int documents_awaiting_review,
          (select count(*) from audit_alerts where status='open' and severity in ('high','critical'))::int urgent_alerts`,
      tx`select current_status as key,count(*)::int as n from clients where deleted_at is null group by 1`,
      tx`
        select to_char(w.week_start,'YYYY-MM-DD') week_start,count(c.id)::int n
        from generate_series(date_trunc('week',now())-interval '11 weeks',date_trunc('week',now()),interval '1 week') w(week_start)
        left join clients c on c.deleted_at is null and c.created_at>=w.week_start and c.created_at<w.week_start+interval '1 week'
        group by w.week_start order by w.week_start`,
      tx`
        select st.id,st.display_name as name,
               count(c.id) filter (where c.current_status not in ('completed','cancelled'))::int active,
               count(c.id) filter (where c.current_status in ('completed','ready_for_first_day'))::int ready_or_done,
               (select count(*) from tasks t where t.assigned_to=st.id and t.status=any(${OPEN_TASKS}) and t.due_at<now())::int overdue_tasks,
               (select count(distinct l.client_id) from activity_log l
                 where l.staff_id=st.id and l.action=any(${COMPLETION_ACTIONS}) and l.new_value->>'status'='completed'
                   and l.created_at>=${current()})::int completed_period
        from staff st
        left join clients c on c.assigned_staff=st.id and c.deleted_at is null
        where st.active
        group by st.id,st.display_name
        order by active desc,st.display_name`,
      tx`
        select current_status as status,count(*)::int n,
               floor(extract(epoch from (now()-min(updated_at)))/86400)::int oldest_days
        from clients
        where deleted_at is null and current_status not in ('completed','cancelled')
          and updated_at<now()-make_interval(days => ${STALL_DAYS})
        group by 1 order by 2 desc`,
      tx`select source as key,count(*)::int as n from clients where deleted_at is null group by 1 order by 2 desc`,
      tx`
        select coalesce(st.display_name,'Unassigned') as name,count(*)::int as n,
               count(*) filter (where c.current_status in ('completed','ready_for_first_day'))::int as ready_or_done
        from clients c left join staff st on st.id=c.assigned_staff where c.deleted_at is null group by 1 order by 2 desc`,
      tx`
        select p.site_name as key,count(distinct p.client_id)::int as n from client_preferences p join clients c on c.id=p.client_id
        where c.deleted_at is null and p.rank='primary' group by 1 order by 2 desc`,
      tx`select status as key,count(*)::int as n from documents d join clients c on c.id=d.client_id where c.deleted_at is null group by 1 order by 2 desc`,
      tx`select severity as key,count(*)::int as n from audit_alerts where status='open' group by 1 order by 2 desc`,
    ]);

    const k = kpiRows[0] ?? {};
    const kpis: ReportKpis = {
      newCurrent: num(k.new_current),
      newPrevious: num(k.new_previous),
      last30: num(k.last30),
      completedCurrent: num(k.completed_current),
      completedPrevious: num(k.completed_previous),
      collectedCurrent: num(k.collected_current),
      collectedPrevious: num(k.collected_previous),
      receivables: num(k.receivables),
      active: num(k.active),
      unassignedActive: num(k.unassigned_active),
      stalled: num(k.stalled),
      medianDaysToComplete: k.median_days == null ? null : Number(k.median_days),
      documentsAwaitingReview: num(k.documents_awaiting_review),
      urgentAlerts: num(k.urgent_alerts),
    };
    const statusCounts = new Map((byStatus as unknown as CountRow[]).map((r) => [r.key, num(r.n)]));
    const stalledRows = (stalled as unknown as StalledStatus[]).map((r) => ({ status: r.status, n: num(r.n), oldest_days: num(r.oldest_days) }));

    return {
      period,
      kpis,
      funnel: STATUSES.map((status) => ({ status, label: STATUS_LABELS[status], n: statusCounts.get(status) ?? 0 })),
      weekly: (weekly as unknown as WeeklyIntake[]).map((w) => ({ week_start: w.week_start, n: num(w.n) })),
      staff: (staff as unknown as StaffPerformance[]).map((s) => ({
        id: s.id, name: s.name, active: num(s.active), ready_or_done: num(s.ready_or_done),
        overdue_tasks: num(s.overdue_tasks), completed_period: num(s.completed_period),
      })),
      stalled: stalledRows,
      byStatus: [...statusCounts.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n),
      bySource: (bySource as unknown as CountRow[]).map((r) => ({ key: r.key, n: num(r.n) })),
      byStaff: (byStaff as unknown as { name: string; n: number; ready_or_done: number }[]).map((r) => ({ name: r.name, n: num(r.n), ready_or_done: num(r.ready_or_done) })),
      bySite: (bySite as unknown as CountRow[]).map((r) => ({ key: r.key, n: num(r.n) })),
      docs: (docs as unknown as CountRow[]).map((r) => ({ key: r.key, n: num(r.n) })),
      alerts: (alerts as unknown as CountRow[]).map((r) => ({ key: r.key, n: num(r.n) })),
      insights: deriveInsights(kpis, stalledRows, period),
    };
  });
}
