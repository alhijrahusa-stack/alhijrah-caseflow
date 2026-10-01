import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export type PipelineStage = {
  key: string;
  position: number;
  label_en: string;
  label_ar: string;
  color: string;
  terminal: boolean;
};

export type DispatchPeriod = "morning" | "evening" | "night" | "needs_manual_review";
export type LedgerPaymentStatus = "unpaid" | "partially_paid" | "paid" | "refunded";
export type TransactionType = "payment" | "refund" | "adjustment" | "waiver";
export type TransactionDirection = "credit" | "debit";

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

export type PaymentTransactionRow = {
  id: string;
  transaction_type: TransactionType;
  direction: TransactionDirection;
  amount: number;
  status: "pending" | "confirmed" | "failed" | "voided" | "refunded";
  payment_method: string | null;
  occurred_at: string;
  transaction_reference: string | null;
  receipt_document_id: string | null;
  reason: string | null;
  source: string;
  recorded_by_name: string | null;
};

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
  amount_paid: number;
  refund_amount: number;
  net_credits: number;
  balance: number;
  payment_status: LedgerPaymentStatus;
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

export async function pipelineData(session: StaffSession) {
  return withStaff(session, async (tx) => {
    const [stages, clients] = await Promise.all([
      tx`select key,position,label_en,label_ar,color,terminal from pipeline_stages order by position`,
      tx`
        select c.id,c.ref,c.full_name,c.phone,c.email,c.pipeline_stage,c.current_status,c.next_step,
               c.assigned_staff,c.created_at,c.updated_at,
               s.display_name assigned_name,s.staff_code,
               p.site_code,p.site_name,p.site_address,p.shift_code,p.shift_name,p.days shift_days,p.hours shift_hours,
               p.shift_period,p.auto_dispatched_at,p.pay_snapshot,
               b.payment_status,b.fee_amount
        from clients c
        left join staff s on s.id=c.assigned_staff
        left join lateral (
          select site_code,site_name,site_address,shift_code,shift_name,days,hours,shift_period,auto_dispatched_at,pay_snapshot
          from client_preferences p
          where p.client_id=c.id
          order by case p.rank when 'primary' then 0 else 1 end,p.preference_order
          limit 1
        ) p on true
        left join client_account_balances b on b.client_id=c.id
        where c.deleted_at is null
        order by c.updated_at desc
        limit 1000`,
    ]);
    return {
      stages: normalizeRows<PipelineStage>(stages),
      clients: normalizeRows<OperationsClient>(clients).map((c) => ({
        ...c,
        fee_amount: c.fee_amount == null ? null : Number(c.fee_amount),
      })),
    };
  });
}

export async function accountingData(session: StaffSession) {
  return withStaff(session, async (tx) => {
    const rows = await tx`
      select a.id account_id,a.client_id,c.ref,c.full_name,c.phone,c.email,c.created_at,
             p.site_code,p.site_name,
             b.fee_amount,b.amount_paid,b.refund_amount,b.net_credits,b.balance,b.payment_status,
             a.assigned_staff,owner.display_name assigned_name,owner.staff_code,
             cm.id commission_id,cm.employee_id commission_staff_id,cs.display_name commission_name,
             coalesce(cm.amount,0) commission_amount,cm.status commission_status,
             coalesce(tr.transactions,'[]'::jsonb) transactions,a.updated_at
      from client_accounts a
      join client_account_balances b on b.account_id=a.id
      join clients c on c.id=a.client_id
      left join staff owner on owner.id=a.assigned_staff
      left join commissions cm on cm.account_id=a.id and cm.trigger_event='account_paid'
      left join staff cs on cs.id=cm.employee_id
      left join lateral (
        select site_code,site_name from client_preferences p
        where p.client_id=c.id
        order by case p.rank when 'primary' then 0 else 1 end,p.preference_order
        limit 1
      ) p on true
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'id',t.id,
          'transaction_type',t.transaction_type,
          'direction',t.direction,
          'amount',t.amount,
          'status',t.status,
          'payment_method',t.payment_method,
          'occurred_at',t.occurred_at,
          'transaction_reference',t.transaction_reference,
          'receipt_document_id',t.receipt_document_id,
          'reason',t.reason,
          'source',t.source,
          'recorded_by_name',rs.display_name
        ) order by t.occurred_at desc,t.created_at desc) transactions
        from payment_transactions t
        left join staff rs on rs.id=t.recorded_by
        where t.account_id=a.id
      ) tr on true
      where c.deleted_at is null
      order by case b.payment_status when 'unpaid' then 0 when 'partially_paid' then 1 when 'paid' then 2 else 3 end,a.updated_at desc
      limit 1000`;
    return normalizeRows<AccountingRow>(rows).map((r) => ({
      ...r,
      fee_amount: Number(r.fee_amount),
      amount_paid: Number(r.amount_paid),
      refund_amount: Number(r.refund_amount),
      net_credits: Number(r.net_credits),
      balance: Number(r.balance),
      commission_amount: Number(r.commission_amount),
      transactions: Array.isArray(r.transactions)
        ? r.transactions.map((t) => ({ ...t, amount: Number(t.amount) }))
        : [],
    }));
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
