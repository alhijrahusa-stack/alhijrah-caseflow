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
export type DispatchMode = "auto" | "manual";

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
  shift_period: DispatchPeriod | null;
  dispatch_mode: DispatchMode | null;
  auto_dispatched_at: string | null;
  manual_dispatch_at: string | null;
  manual_dispatch_by: string | null;
  pay_snapshot: string | null;
  payment_status: string | null;
  fee_amount: number | null;
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
  payment_status: "pending" | "paid" | "refunded";
  payment_method: "zelle" | "bank_transfer" | "cash" | "card" | null;
  payment_date: string | null;
  receipt_document_id: string | null;
  assigned_staff: string | null;
  assigned_name: string | null;
  staff_code: string | null;
  commission_staff_id: string | null;
  commission_name: string | null;
  commission_amount: number;
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

function normalizeClient(row: OperationsClient): OperationsClient {
  return { ...row, fee_amount: row.fee_amount == null ? null : Number(row.fee_amount) };
}

export async function operationsClient(session: StaffSession, clientId: string) {
  return withStaff(session, async (tx) => {
    const [row] = await tx`
      select *
      from career_gate_operations_clients
      where id=${clientId}
      limit 1`;
    return row ? normalizeClient(row as unknown as OperationsClient) : null;
  });
}

export async function pipelineData(session: StaffSession) {
  return withStaff(session, async (tx) => {
    const [stages, clients] = await Promise.all([
      tx`select key,position,label_en,label_ar,color,terminal from pipeline_stages order by position`,
      tx`
        select *
        from career_gate_operations_clients
        order by updated_at desc
        limit 1000`,
    ]);
    return {
      stages: normalizeRows<PipelineStage>(stages),
      clients: normalizeRows<OperationsClient>(clients).map(normalizeClient),
    };
  });
}

export async function accountingData(session: StaffSession) {
  return withStaff(session, async (tx) => {
    const rows = await tx`
      select a.id account_id,a.client_id,c.ref,c.full_name,c.phone,c.email,c.created_at,
             p.site_code,p.site_name,
             a.fee_amount,a.payment_status,a.payment_method,a.payment_date,a.receipt_document_id,
             a.assigned_staff,owner.display_name assigned_name,owner.staff_code,
             a.commission_staff_id,cs.display_name commission_name,a.commission_amount,a.updated_at
      from client_accounts a
      join clients c on c.id=a.client_id
      left join staff owner on owner.id=a.assigned_staff
      left join staff cs on cs.id=a.commission_staff_id
      left join lateral (
        select site_code,site_name from client_preferences p
        where p.client_id=c.id
        order by case p.rank when 'primary' then 0 else 1 end,p.preference_order
        limit 1
      ) p on true
      where c.deleted_at is null
      order by case a.payment_status when 'pending' then 0 when 'paid' then 1 else 2 end,a.updated_at desc
      limit 1000`;
    return normalizeRows<AccountingRow>(rows).map((r) => ({
      ...r,
      fee_amount: Number(r.fee_amount),
      commission_amount: Number(r.commission_amount),
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
