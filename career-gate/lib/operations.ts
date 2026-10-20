import "server-only";
import { LEDGER_JSON, normalizeLedger, type PaymentTransactionRow } from "@/lib/accounting-ledger-read";

export type { PaymentTransactionRow } from "@/lib/accounting-ledger-read";
import { BALANCE_NET_FEE, CLIENT_FIELD, DISCOUNT_AMOUNT, JSON_FIELD } from "@/lib/accounting-schema";
import { withStaff, type StaffSession } from "@/lib/auth";

export type PipelineStage = {
  key: string;
  position: number;
  label_en: string;
  label_ar: string;
  color: string;
  terminal: boolean;
};

import type { DispatchPeriod } from "@/lib/pipeline-period";

export type { DispatchPeriod } from "@/lib/pipeline-period";
export type LedgerPaymentStatus = "unpaid" | "partially_paid" | "paid" | "refunded";
export type { TransactionDirection, TransactionType } from "@/lib/accounting-ledger-read";

export type OperationsClient = {
  id: string;
  ref: string;
  full_name: string;
  phone: string;
  email: string | null;
  pipeline_stage: string;
  current_status: string;
  next_step: string;
  assigned_staff: string | null;
  assigned_name: string | null;
  staff_code: string | null;
  created_at: string;
  updated_at: string;
  site_code: string | null;
  site_name: string | null;
  site_address: string | null;
  shift_code: string | null;
  shift_name: string | null;
  shift_days: string | null;
  shift_hours: string | null;
  shift_period: DispatchPeriod | "unspecified" | null;
  auto_dispatched_at: string | null;
  pay_snapshot: string | null;
  payment_status: LedgerPaymentStatus | null;
  fee_amount: number | null;
};

/** The fields the pipeline board and the location dispatcher render, and nothing else. */
export type PipelineClient = Pick<OperationsClient,
  "id" | "ref" | "full_name" | "pipeline_stage" | "current_status" | "next_step" | "assigned_staff" | "assigned_name" |
  "site_code" | "site_name" | "site_address" | "shift_code" | "shift_name" | "shift_days" | "shift_hours" | "shift_period" |
  "auto_dispatched_at" | "payment_status" | "fee_amount">;

export type AccountingRow = {
  account_id: string;
  client_id: string;
  ref: string;
  full_name: string;
  phone: string;
  email: string | null;
  created_at: string;
  site_code: string | null;
  site_name: string | null;
  fee_amount: number;
  discount_amount: number;
  net_fee: number;
  discount_reason: string | null;
  discount_input_type: "amount" | "percentage" | null;
  discount_input_value: number | null;
  amount_paid: number;
  refund_amount: number;
  net_credits: number;
  balance: number;
  payment_status: LedgerPaymentStatus;
  application_status: string;
  application_completed_by: string | null;
  application_completed_name: string | null;
  assigned_staff: string | null;
  assigned_name: string | null;
  staff_code: string | null;
  commission_id: string | null;
  commission_staff_id: string | null;
  commission_name: string | null;
  commission_amount: number;
  commission_status: string | null;
  transactions: PaymentTransactionRow[];
  updated_at: string;
};

export type OperationsStaff = {
  id: string;
  display_name: string;
  email: string | null;
  role: string;
  active: boolean;
  staff_code: string | null;
  commission_type: "fixed" | "percent";
  commission_value: number;
  eligible_for_round_robin: boolean;
};

function normalizeRows<T>(rows: unknown) {
  return rows as T[];
}

export const ACCOUNTING_PAGE_SIZE = 25;
export const ACCOUNTING_STATUSES = ["unpaid", "partially_paid", "paid", "refunded"] as const;

export type AccountingFilters = {
  status: LedgerPaymentStatus | "all";
  staffId: string | null;
  q: string;
  clientId: string | null;
  page: number;
};

export type AccountingTotals = {
  count: number;
  outstanding: number;
  paid: number;
  refunded: number;
  commissions: number;
};

export type AccountingPage = {
  rows: AccountingRow[];
  totals: AccountingTotals;
  page: number;
  pageSize: number;
  pageCount: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/** Turns untrusted search params into a closed filter set. Anything unknown falls back to "all". */
export function parseAccountingFilters(params: Record<string, string | string[] | undefined>): AccountingFilters {
  const status = first(params.status);
  const staff = first(params.staff);
  const client = first(params.client);
  const rawPage = Number(first(params.page) ?? "1");
  return {
    status: (ACCOUNTING_STATUSES as readonly string[]).includes(status ?? "") ? (status as LedgerPaymentStatus) : "all",
    staffId: staff && UUID_RE.test(staff) ? staff : null,
    q: (first(params.q) ?? "").trim().slice(0, 120),
    clientId: client && UUID_RE.test(client) ? client : null,
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 10000) : 1,
  };
}

function likePattern(term: string) {
  return `%${term.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/**
 * One page of accounts plus totals over the whole filtered set, in one statement.
 * Filtering, ordering and paging happen in Postgres so the browser receives
 * only the rows it renders; the ledger is built for those rows alone.
 */
export async function accountingData(session: StaffSession, filters: AccountingFilters): Promise<AccountingPage> {
  return withStaff(session, async (tx) => {
    const term = filters.q ? likePattern(filters.q) : null;
    const offset = (filters.page - 1) * ACCOUNTING_PAGE_SIZE;
    const rows = await tx`
      with base as (
        select a.id account_id,a.client_id,c.ref,c.full_name,c.phone,c.email,c.created_at,
               b.fee_amount,b.amount_paid,b.refund_amount,b.net_credits,b.balance,b.payment_status,
               ${filters.staffId ? tx`(${tx.unsafe(CLIENT_FIELD("c", "application_completed_by"))})` : tx`null::text`} application_completed_by,
               a.assigned_staff,
               cm.id commission_id,cm.employee_id commission_staff_id,
               coalesce(cm.amount,0) commission_amount,cm.status commission_status,a.updated_at,
               case b.payment_status when 'unpaid' then 0 when 'partially_paid' then 1 when 'paid' then 2 else 3 end status_rank
        from client_accounts a
        join client_account_balances b on b.account_id=a.id
        join clients c on c.id=a.client_id
        left join commissions cm on cm.account_id=a.id and cm.trigger_event='account_paid'
        where c.deleted_at is null
          ${filters.clientId ? tx`and a.client_id=${filters.clientId}` : tx``}
      ),
      filtered as materialized (
        select * from base
        where true
          ${filters.status !== "all" ? tx`and payment_status=${filters.status}` : tx``}
          ${filters.staffId ? tx`and (assigned_staff=${filters.staffId} or commission_staff_id=${filters.staffId} or application_completed_by=${filters.staffId})` : tx``}
          ${term ? tx`and (lower(full_name) like ${term} or lower(ref) like ${term} or lower(coalesce(phone,'')) like ${term}
                       or lower(coalesce(email,'')) like ${term}
                       or exists (
                         select 1 from (
                           select site_code,site_name from client_preferences p
                           where p.client_id=base.client_id
                           order by case p.rank when 'primary' then 0 else 1 end,p.preference_order
                           limit 1
                         ) primary_site
                         where lower(coalesce(primary_site.site_code,'')) like ${term} or lower(coalesce(primary_site.site_name,'')) like ${term}))` : tx``}
      ),
      totals as (
        select count(*)::int total_count,
               coalesce(sum(greatest(balance,0)),0) total_outstanding,
               coalesce(sum(amount_paid),0) total_paid,
               coalesce(sum(refund_amount),0) total_refunded,
               coalesce(sum(commission_amount) filter (where commission_status is not null and commission_status not in ('cancelled','reversed')),0) total_commissions
        from filtered
      ),
      page as (
        select * from filtered
        order by status_rank,updated_at desc,account_id
        limit ${ACCOUNTING_PAGE_SIZE} offset ${offset}
      )
      select page.account_id,page.client_id,page.ref,page.full_name,page.phone,page.email,page.created_at,
             page.fee_amount,page.amount_paid,page.refund_amount,page.net_credits,page.balance,page.payment_status,
             page.assigned_staff,page.commission_id,page.commission_staff_id,page.commission_amount,page.commission_status,
             page.updated_at,page.status_rank,
             ${tx.unsafe(DISCOUNT_AMOUNT("pb"))} discount_amount,${tx.unsafe(BALANCE_NET_FEE("pb"))} net_fee,
             ${tx.unsafe(`to_jsonb(pa)->>'discount_reason'`)} discount_reason,
             ${tx.unsafe(`to_jsonb(pa)->>'discount_input_type'`)} discount_input_type,
             ${tx.unsafe(`(to_jsonb(pa)->>'discount_input_value')::numeric`)} discount_input_value,
             ${tx.unsafe(JSON_FIELD("cj.j", "application_status"))} application_status,
             ${tx.unsafe(JSON_FIELD("cj.j", "application_completed_by"))} application_completed_by,
             p.site_code,p.site_name,
             completer.display_name application_completed_name,
             owner.display_name assigned_name,owner.staff_code,
             cs.display_name commission_name,
             coalesce(tr.transactions,'[]'::jsonb) transactions,totals.*
      from totals
      left join page on true
      left join client_accounts pa on pa.id=page.account_id
      left join client_account_balances pb on pb.account_id=page.account_id
      left join clients pc on pc.id=page.client_id
      -- Columns added by migration 033 are read off the serialized row, for the
      -- page only, so a pre-033 schema still renders.
      left join lateral (select to_jsonb(pc) j) cj on page.account_id is not null
      left join staff owner on owner.id=page.assigned_staff
      left join staff completer on completer.id=${tx.unsafe(JSON_FIELD("cj.j", "application_completed_by"))}::uuid
      left join staff cs on cs.id=page.commission_staff_id
      left join lateral (
        select site_code,site_name from client_preferences p
        where p.client_id=page.client_id
        order by case p.rank when 'primary' then 0 else 1 end,p.preference_order
        limit 1
      ) p on page.account_id is not null
      left join lateral (select page.account_id id) acct on page.account_id is not null
      left join lateral (${tx.unsafe(LEDGER_JSON("acct"))}) tr on page.account_id is not null
      order by page.status_rank,page.updated_at desc,page.account_id`;
    const head = rows[0] as Record<string, unknown> | undefined;
    const totals: AccountingTotals = {
      count: Number(head?.total_count ?? 0),
      outstanding: Number(head?.total_outstanding ?? 0),
      paid: Number(head?.total_paid ?? 0),
      refunded: Number(head?.total_refunded ?? 0),
      commissions: Number(head?.total_commissions ?? 0),
    };
    const pageRows = normalizeRows<AccountingRow & Record<string, unknown>>(rows)
      .filter((r) => r.account_id != null)
      .map((r): AccountingRow => ({
        account_id: r.account_id,
        client_id: r.client_id,
        ref: r.ref,
        full_name: r.full_name,
        phone: r.phone,
        email: r.email,
        created_at: r.created_at,
        site_code: r.site_code,
        site_name: r.site_name,
        fee_amount: Number(r.fee_amount),
        discount_amount: Number(r.discount_amount),
        net_fee: Number(r.net_fee),
        discount_reason: r.discount_reason,
        discount_input_type: r.discount_input_type,
        discount_input_value: r.discount_input_value == null ? null : Number(r.discount_input_value),
        amount_paid: Number(r.amount_paid),
        refund_amount: Number(r.refund_amount),
        net_credits: Number(r.net_credits),
        balance: Number(r.balance),
        payment_status: r.payment_status,
        application_status: r.application_status,
        application_completed_by: r.application_completed_by,
        application_completed_name: r.application_completed_name,
        assigned_staff: r.assigned_staff,
        assigned_name: r.assigned_name,
        staff_code: r.staff_code,
        commission_id: r.commission_id,
        commission_staff_id: r.commission_staff_id,
        commission_name: r.commission_name,
        commission_amount: Number(r.commission_amount),
        commission_status: r.commission_status,
        transactions: normalizeLedger(r.transactions),
        updated_at: r.updated_at,
      }));
    return {
      rows: pageRows,
      totals,
      page: filters.page,
      pageSize: ACCOUNTING_PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(totals.count / ACCOUNTING_PAGE_SIZE)),
    };
  });
}

/** Active and inactive staff for filters and pickers, without the client list `distributionData` carries. */
export async function staffDirectory(session: StaffSession) {
  return withStaff(session, async (tx) => {
    const staff = await tx`select id,display_name,email,role,active,staff_code,commission_type,commission_value,eligible_for_round_robin
       from staff order by active desc,staff_code nulls last,display_name`;
    return normalizeRows<OperationsStaff>(staff).map((s) => ({ ...s, commission_value: Number(s.commission_value) }));
  });
}

export async function distributionData(session: StaffSession) {
  return withStaff(session, async (tx) => {
    const [staff, clients, settings] = await Promise.all([
      tx`select id,display_name,email,role,active,staff_code,commission_type,commission_value,eligible_for_round_robin
         from staff order by active desc,staff_code nulls last,display_name`,
      tx`select c.id,c.ref,c.full_name,c.phone,c.email,c.pipeline_stage,c.assigned_staff,
                s.display_name assigned_name,s.staff_code,c.updated_at
         from clients c left join staff s on s.id=c.assigned_staff
         where c.deleted_at is null order by c.assigned_staff nulls first,c.updated_at desc limit 1000`,
      tx`select round_robin_enabled,cursor,updated_at from assignment_settings where singleton=true`,
    ]);
    return {
      staff: normalizeRows<OperationsStaff>(staff).map((s) => ({ ...s, commission_value: Number(s.commission_value) })),
      clients: clients as unknown as Array<{
        id: string; ref: string; full_name: string; phone: string; email: string | null; pipeline_stage: string;
        assigned_staff: string | null; assigned_name: string | null; staff_code: string | null; updated_at: string;
      }>,
      settings: settings[0] ? {
        round_robin_enabled: Boolean(settings[0].round_robin_enabled),
        cursor: Number(settings[0].cursor),
        updated_at: String(settings[0].updated_at),
      } : { round_robin_enabled: false, cursor: 0, updated_at: "" },
    };
  });
}
