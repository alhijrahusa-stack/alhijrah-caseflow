import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { teamWorkload, type TeamWorkloadData } from "@/lib/operational-team";
import { providerStates, type ProviderState } from "@/lib/providers/config";
import { TZ } from "@/lib/queries";

const OPEN_TASKS = ["pending", "in_progress"];
const OPEN_APPOINTMENTS = ["scheduled", "confirmed", "rescheduled"];
const BLOCKING_DOCUMENT_STATES = ["needs_review", "needs_reupload", "rejected"];

export type PipelineMetric = { status: string; total: number };
export type DashboardSystemHealth = {
  status: "HEALTHY" | "DEGRADED" | "FAILED";
  db_ms: number;
  queue: {
    queued: number;
    running: number;
    retrying: number;
    dead: number;
    not_configured: number;
    oldest_queued_seconds: number | null;
  };
  failed_notifications_24h: number;
  open_audit_alerts: number;
  providers: Record<string, ProviderState>;
};

export type DashboardCommandData = {
  new_clients: number;
  appointments_2h: number;
  tasks_due: number;
  overdue_tasks: number;
  overdue_followups: number;
  document_attention: number;
  unassigned_clients: number;
  completed_this_month: number;
  efficiency: number | null;
  readiness: {
    ready: number;
    nearly_ready: number;
    blocked: number;
    missing_requirements: number;
  };
  finance: {
    receivables: number;
    collected_this_month: number;
    refunds_this_month: number;
    commissions_attention: number;
  };
  pipeline: PipelineMetric[];
  lifecycle: Record<"intake" | "account" | "job" | "appointments" | "paperwork" | "registry", number>;
  payment_pending: number;
  paperwork_pending: number;
  exceptions: number;
  team: TeamWorkloadData;
  system: DashboardSystemHealth | null;
};

async function systemHealth(session: StaffSession): Promise<DashboardSystemHealth | null> {
  if (session.staff.role !== "admin") return null;
  const db = sql();
  const started = performance.now();
  try {
    const [[row], [{ failed_notifications_24h }], [{ open_audit_alerts }]] = await Promise.all([
      db`
      select
        count(*) filter (where status='queued')::int as queued,
        count(*) filter (where status='running')::int as running,
        count(*) filter (where status='queued' and attempts>0 and last_error is not null)::int as retrying,
        count(*) filter (where status='dead')::int as dead,
        count(*) filter (where status='not_configured')::int as not_configured,
        extract(epoch from (now()-min(created_at) filter (where status='queued')))::int as oldest_queued_seconds
      from jobs`,
      db`
      select count(*)::int as failed_notifications_24h
      from notifications where status='failed' and updated_at>=now()-interval '24 hours'`,
      db`select count(*)::int as open_audit_alerts from audit_alerts where status='open'`,
    ]);
    const dbMs = Math.round(performance.now() - started);
    const providers = providerStates();
    const failed = Number(row?.dead ?? 0) > 0 || Number(failed_notifications_24h ?? 0) > 0;
    const degraded = failed || Number(row?.not_configured ?? 0) > 0 || Number(open_audit_alerts ?? 0) > 0 || dbMs > 1000;
    return {
      status: failed ? "FAILED" : degraded ? "DEGRADED" : "HEALTHY",
      db_ms: dbMs,
      queue: {
        queued: Number(row?.queued ?? 0),
        running: Number(row?.running ?? 0),
        retrying: Number(row?.retrying ?? 0),
        dead: Number(row?.dead ?? 0),
        not_configured: Number(row?.not_configured ?? 0),
        oldest_queued_seconds: row?.oldest_queued_seconds == null ? null : Number(row.oldest_queued_seconds),
      },
      failed_notifications_24h: Number(failed_notifications_24h ?? 0),
      open_audit_alerts: Number(open_audit_alerts ?? 0),
      providers,
    };
  } catch {
    return {
      status: "FAILED",
      db_ms: Math.round(performance.now() - started),
      queue: { queued: 0, running: 0, retrying: 0, dead: 0, not_configured: 0, oldest_queued_seconds: null },
      failed_notifications_24h: 0,
      open_audit_alerts: 0,
      providers: providerStates(),
    };
  }
}

export async function dashboardCommandData(session: StaffSession): Promise<DashboardCommandData> {
  const [team, operational, system] = await Promise.all([
    teamWorkload(session),
    withStaff(session, async (tx) => {
      await tx`select set_config('statement_timeout', '6500', true)`;
      const [row] = await tx`
        with active as (
          select id,assigned_staff from clients
          where deleted_at is null and current_status not in ('completed','cancelled')
        ),
        -- The latest document of each (client, type) that is in a blocking state.
        -- Candidates are narrowed by status first so the RLS predicate runs on
        -- them alone, not on every document of every active client.
        attention_docs as (
          select d.client_id
          from documents d join active a on a.id=d.client_id
          where d.status=any(${BLOCKING_DOCUMENT_STATES})
            and not exists (
              select 1 from documents n
              where n.client_id=d.client_id and n.doc_type=d.doc_type
                and (n.uploaded_at,n.id)>(d.uploaded_at,d.id)
            )
        ),
        health as (
          select a.id,
            (a.assigned_staff is not null
             and not exists (select 1 from tasks t where t.client_id=a.id and t.status=any(${OPEN_TASKS}) and t.due_at is not null and t.due_at<now())
             and not exists (select 1 from followups f where f.client_id=a.id and f.status='open' and f.due_date<(now() at time zone ${TZ})::date)
             and not exists (select 1 from attention_docs d where d.client_id=a.id)) as healthy
          from active a
        ),
        readiness_rollup as (
          select
            count(*) filter (where r.total_requirements>0 and r.readiness_percent=100)::int as ready_count,
            count(*) filter (where r.total_requirements>0 and r.readiness_percent between 75 and 99)::int as nearly_ready_count,
            count(*) filter (where r.total_requirements>0 and coalesce(r.readiness_percent,0)<75)::int as blocked_count,
            coalesce(sum(greatest(r.total_requirements-r.completed_requirements,0)),0)::int as missing_requirements
          from client_readiness r join active a on a.id=r.client_id
        )
        select
          (select count(*)::int from clients c where c.deleted_at is null and c.current_status='new_intake') as new_clients,
          (select count(*)::int from appointments a join active c on c.id=a.client_id where a.status=any(${OPEN_APPOINTMENTS}) and a.scheduled_at>=now() and a.scheduled_at<=now()+interval '2 hours') as appointments_2h,
          (select count(*)::int from tasks t join active c on c.id=t.client_id where t.status=any(${OPEN_TASKS}) and t.due_at is not null and (t.due_at at time zone ${TZ})::date=(now() at time zone ${TZ})::date) as tasks_due,
          (select count(*)::int from tasks t join active c on c.id=t.client_id where t.status=any(${OPEN_TASKS}) and t.due_at is not null and t.due_at<now()) as overdue_tasks,
          (select count(*)::int from followups f join active c on c.id=f.client_id where f.status='open' and f.due_date<(now() at time zone ${TZ})::date) as overdue_followups,
          (select count(distinct d.client_id)::int from attention_docs d) as document_attention,
          (select count(*)::int from active where assigned_staff is null) as unassigned_clients,
          (select count(*)::int from clients c where c.deleted_at is null and c.current_status='completed' and exists (select 1 from activity_log l where l.client_id=c.id and l.action in ('status_changed','status_overridden') and l.new_value->>'status'='completed' and l.created_at>=date_trunc('month',now()))) as completed_this_month,
          (select count(*)::int from health) as active_count,
          (select count(*) filter (where healthy)::int from health) as healthy_count,
          rr.ready_count,
          rr.nearly_ready_count,
          rr.blocked_count,
          rr.missing_requirements,
          (select coalesce(sum(greatest(b.balance,0)),0)::numeric from client_account_balances b join active a on a.id=b.client_id) as receivables,
          (select coalesce(sum(t.amount),0)::numeric from payment_transactions t join active a on a.id=t.client_id where t.transaction_type='payment' and t.status='confirmed' and t.created_at>=date_trunc('month',now())) as collected_this_month,
          (select coalesce(sum(t.amount),0)::numeric from payment_transactions t join active a on a.id=t.client_id where t.transaction_type='refund' and t.status='confirmed' and t.created_at>=date_trunc('month',now())) as refunds_this_month,
          (select count(*)::int from commissions c join active a on a.id=c.client_id where c.status in ('pending','eligible')) as commissions_attention
        from readiness_rollup rr`;
      const pipelineRows = await tx`
        select current_status as status,count(*)::int as total
        from clients
        where deleted_at is null and current_status not in ('cancelled')
        group by current_status
        order by current_status`;
      const [lifecycleCounts] = await tx`
        select
          count(*) filter (where c.current_status in ('new_intake','needs_review'))::int intake,
          count(*) filter (where c.current_status in ('ready_to_apply','application_in_progress','assessment_required','shift_selected','appointment_required')
             and not career_gate_private.has_ready_gate_job_account(c.id))::int account,
          count(*) filter (where c.current_status in ('shift_selected','appointment_required')
             and career_gate_private.has_ready_gate_job_account(c.id)
             and exists(select 1 from client_readiness r where r.client_id=c.id and r.total_requirements>0 and r.readiness_percent=100))::int job,
          count(*) filter (where c.current_status='appointment_scheduled')::int appointments,
          count(*) filter (where c.current_status in ('pre_hire_completed','screening_pending','i9_available','post_hire_tasks','ready_for_first_day')
             and exists(select 1 from appointment_outcomes o where o.client_id=c.id and o.decision='pass')
             and coalesce(a.payment_status,'pending')<>'paid')::int payment_pending,
          count(*) filter (where c.current_status in ('pre_hire_completed','screening_pending','i9_available','post_hire_tasks','ready_for_first_day')
             and a.payment_status='paid')::int paperwork_pending,
          count(*) filter (where c.current_status in ('completed','cancelled'))::int registry
        from clients c
        left join client_accounts a on a.client_id=c.id
        where c.deleted_at is null`;
      const active = Number(row?.active_count ?? 0);
      const healthy = Number(row?.healthy_count ?? 0);
      const metrics = {
        new_clients: Number(row?.new_clients ?? 0),
        appointments_2h: Number(row?.appointments_2h ?? 0),
        tasks_due: Number(row?.tasks_due ?? 0),
        overdue_tasks: Number(row?.overdue_tasks ?? 0),
        overdue_followups: Number(row?.overdue_followups ?? 0),
        document_attention: Number(row?.document_attention ?? 0),
        unassigned_clients: Number(row?.unassigned_clients ?? 0),
        completed_this_month: Number(row?.completed_this_month ?? 0),
        efficiency: active === 0 ? null : Math.round((healthy / active) * 100),
        readiness: {
          ready: Number(row?.ready_count ?? 0),
          nearly_ready: Number(row?.nearly_ready_count ?? 0),
          blocked: Number(row?.blocked_count ?? 0),
          missing_requirements: Number(row?.missing_requirements ?? 0),
        },
        finance: {
          receivables: Number(row?.receivables ?? 0),
          collected_this_month: Number(row?.collected_this_month ?? 0),
          refunds_this_month: Number(row?.refunds_this_month ?? 0),
          commissions_attention: Number(row?.commissions_attention ?? 0),
        },
        pipeline: pipelineRows.map((p) => ({ status: String(p.status), total: Number(p.total) })),
        lifecycle: {
          intake: Number(lifecycleCounts?.intake ?? 0),
          account: Number(lifecycleCounts?.account ?? 0),
          job: Number(lifecycleCounts?.job ?? 0),
          appointments: Number(lifecycleCounts?.appointments ?? 0),
          paperwork: Number(lifecycleCounts?.payment_pending ?? 0) + Number(lifecycleCounts?.paperwork_pending ?? 0),
          registry: Number(lifecycleCounts?.registry ?? 0),
        },
        payment_pending: Number(lifecycleCounts?.payment_pending ?? 0),
        paperwork_pending: Number(lifecycleCounts?.paperwork_pending ?? 0),
      };
      return metrics;
    }),
    systemHealth(session),
  ]);
  const exceptions = operational.overdue_tasks + operational.overdue_followups + operational.document_attention + operational.unassigned_clients + operational.readiness.blocked + (system?.queue.dead ?? 0) + (system?.failed_notifications_24h ?? 0) + (system?.open_audit_alerts ?? 0);
  return { ...operational, exceptions, team, system };
}

export async function monitoredDashboardCommandData(session: StaffSession): Promise<DashboardCommandData> {
  const started = performance.now();
  try {
    const data = await dashboardCommandData(session);
    const durationMs = Math.round(performance.now() - started);
    if (durationMs > 2000) console.warn(JSON.stringify({ event: "slow_dashboard_load", duration_ms: durationMs }));
    return data;
  } catch (cause) {
    console.error(JSON.stringify({ event: "dashboard_load_failed", duration_ms: Math.round(performance.now() - started), error_type: cause instanceof Error ? cause.name : "Unknown" }));
    throw cause;
  }
}
