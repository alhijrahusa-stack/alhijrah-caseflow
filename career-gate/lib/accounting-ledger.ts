import "server-only";
import { withStaff } from "@/lib/auth";
import { commissionAmount, resolveCommissionOwner, type CommissionBlockReason } from "@/lib/accounting-commission";

/**
 * The authoritative financial write path.
 *
 * Every Career Gate surface that moves money — the Accounting board, the client
 * file's account panel, and the application-completion record that establishes
 * ownership — calls these functions inside one transaction, so the ledger, the
 * projected status, the audit row and the commission are produced identically
 * whatever triggered them.
 */

export type Tx = Parameters<Parameters<typeof withStaff>[1]>[0];

export type AccountRow = { id: string; client_id: string; fee_amount: string | number; discount_amount: string | number };
export type CommissionRow = { id: string; employee_id: string; amount: string | number; status: string };

/**
 * The single authoritative settlement path. Every financial operation ends here,
 * so the projected payment status and the commission are derived the same way
 * whatever triggered them — a payment, a refund, a discount, or the application
 * completion that first establishes an owner.
 */
export async function reconcileAccount(tx: Tx, args: {
  account: AccountRow;
  staffId: string;
  traceId: string;
  eligibilityDate: string;
  refundRecorded?: boolean;
  triggerTransactionId?: string | null;
  paymentMethod?: string | null;
  paymentDate?: string | null;
  receiptDocumentId?: string | null;
}) {
  const { account } = args;
  let [balance] = await tx`select * from client_account_balances where account_id=${account.id}`;
  if (!balance) throw new Error("BALANCE_NOT_FOUND");

  const projectedStatus = Number(balance.balance) <= 0
    ? "paid"
    : args.refundRecorded && Number(balance.net_credits) <= 0
      ? "refunded"
      : "pending";

  // client_accounts is now compatibility projection only. The DB guard rejects
  // financial writes unless the canonical ledger command enables this local flag.
  await tx`select set_config('cg.finance_projection_sync','1',true)`;
  await tx`
    update client_accounts
    set payment_status=${projectedStatus},
        payment_method=coalesce(${args.paymentMethod ?? null},payment_method),
        payment_date=coalesce(${args.paymentDate ?? null}::date,payment_date),
        receipt_document_id=coalesce(${args.receiptDocumentId ?? null},receipt_document_id),
        commission_amount=0,
        commission_staff_id=null,
        paid_at=case when ${projectedStatus}='paid' then coalesce(paid_at,now()) else null end,
        updated_by=${args.staffId}
    where id=${account.id}`;

  [balance] = await tx`select * from client_account_balances where account_id=${account.id}`;

  let commission: CommissionRow | null = null;
  let commissionBlocked: CommissionBlockReason | null = null;

  if (balance?.payment_status === "paid") {
    const [client] = await tx`
      select application_completed_by from clients where id=${account.client_id}`;
    // LOCKED RULE: the owner is the recorded application completer, never the
    // current assignment, the recorder, the uploader or the session.
    const owner = resolveCommissionOwner(client as { application_completed_by?: string | null } | undefined);
    if (owner.employeeId === null) {
      commissionBlocked = owner.reason;
    } else {
      const employeeId = owner.employeeId;
      const [rule] = await tx`
        select id,version,commission_type,commission_value
        from commission_rules where employee_id=${employeeId} and active
        order by version desc limit 1`;
      if (!rule) {
        commissionBlocked = "NO_ACTIVE_COMMISSION_RULE";
      } else {
        const netFee = Number(balance.net_fee);
        const amount = commissionAmount(rule as { commission_type: string; commission_value: unknown }, netFee);
        const inserted = await tx`
          insert into commissions(
            employee_id,client_id,account_id,trigger_event,trigger_transaction_id,rule_id,rule_version,
            calculation_basis,commission_type,rate_value,amount,eligibility_date,status
          ) values (
            ${employeeId},${account.client_id},${account.id},'account_paid',${args.triggerTransactionId ?? null},${rule.id},${rule.version},
            ${netFee},${rule.commission_type},${rule.commission_value},${amount},${args.eligibilityDate}::date,'eligible'
          )
          on conflict(account_id,trigger_event) do nothing
          returning id,employee_id,amount,status`;
        commission = (inserted[0] as CommissionRow | undefined) ?? null;
        if (commission) {
          await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
                   values(${account.client_id},'commission_created',${args.staffId},'commission',${commission.id},
                          ${tx.json({ employee_id: employeeId, amount, status: "eligible", rule_version: rule.version, owner_source: "application_completed_by" })},${args.traceId})`;
        } else {
          const existing = await tx`select id,employee_id,amount,status from commissions where account_id=${account.id} and trigger_event='account_paid'`;
          commission = (existing[0] as CommissionRow | undefined) ?? null;
        }
      }
    }
  } else {
    const reversed = await tx`
      update commissions set status='reversed',cancel_reason='Account no longer fully paid',updated_at=now()
      where account_id=${account.id} and trigger_event='account_paid' and status not in ('cancelled','reversed')
      returning id,employee_id,amount,status`;
    for (const row of reversed) {
      await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
               values(${account.client_id},'commission_updated',${args.staffId},'commission',${row.id},
                      ${tx.json({ status: "reversed", reason: "Account no longer fully paid" })},${args.traceId})`;
    }
  }

  return { balance, commission, commission_blocked: commissionBlocked };
}

export async function lockAccount(tx: Tx, clientId: string) {
  const [account] = await tx`
    select a.id,a.client_id,a.fee_amount,a.discount_amount
    from client_accounts a join clients c on c.id=a.client_id
    where a.client_id=${clientId} and c.deleted_at is null
    for update of a`;
  if (!account) throw new Error("ACCOUNT_NOT_FOUND");
  return account as unknown as AccountRow;
}

/**
 * Records who completed a client's application. This is the only fact the
 * commission owner is derived from, so it is written on its own, audited, and
 * then settled — an application completed after the money arrived establishes
 * the owner retroactively and the commission is created now rather than lost.
 */
export async function recordApplicationCompletion(tx: Tx, args: {
  clientId: string;
  completedBy: string;
  completedOn: string;
  staffId: string;
  traceId: string;
}) {
  const [staffRow] = await tx`select id,active from staff where id=${args.completedBy}`;
  if (!staffRow || staffRow.active !== true) throw new Error("COMPLETION_STAFF_NOT_FOUND");

  const [client] = await tx`
    select id,application_status,application_completed_by
    from clients where id=${args.clientId} and deleted_at is null for update`;
  if (!client) throw new Error("CLIENT_NOT_FOUND");

  const [updated] = await tx`
    update clients
    set application_status='completed',
        application_completed_by=${args.completedBy},
        application_completed_at=${args.completedOn}::date::timestamptz,
        updated_at=now()
    where id=${args.clientId}
    returning id,application_status,application_completed_by,application_completed_at`;

  if (client.application_completed_by !== args.completedBy) {
    await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
             values(${args.clientId},'application_completed',${args.staffId},'client',${args.clientId},
                    ${tx.json({ application_completed_by: client.application_completed_by ?? null })},
                    ${tx.json({ application_completed_by: args.completedBy, completed_on: args.completedOn })},${args.traceId})`;
  }

  const existing = await tx`select id from client_accounts where client_id=${args.clientId}`;
  const settled = existing.length
    ? await reconcileAccount(tx, {
        account: await lockAccount(tx, args.clientId),
        staffId: args.staffId,
        traceId: args.traceId,
        eligibilityDate: args.completedOn,
      })
    : { balance: null, commission: null, commission_blocked: null };

  return { client: updated, ...settled };
}

/**
 * Sets the client discount. The contracted fee is left intact and the reduction
 * is stored beside it, so the concession stays visible in the record. The net
 * fee changes, so the account is settled again through the same path.
 */
export async function applyAccountDiscount(tx: Tx, args: {
  clientId: string;
  discountAmount: number;
  reason: string | null;
  staffId: string;
  traceId: string;
}) {
  const account = await lockAccount(tx, args.clientId);
  const reason = (args.reason ?? "").trim();
  if (args.discountAmount > 0 && !reason) throw new Error("DISCOUNT_REASON_REQUIRED");
  if (args.discountAmount > Number(account.fee_amount)) throw new Error("DISCOUNT_EXCEEDS_FEE");

  await tx`select set_config('cg.finance_projection_sync','1',true)`;
  await tx`
    update client_accounts
    set discount_amount=${args.discountAmount},
        discount_reason=${args.discountAmount > 0 ? reason : null},
        discount_updated_by=${args.discountAmount > 0 ? args.staffId : null},
        discount_updated_at=${args.discountAmount > 0 ? new Date().toISOString() : null},
        updated_by=${args.staffId}
    where id=${account.id}`;

  await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,old_value,new_value,trace_id)
           values(${args.clientId},'client_discount_updated',${args.staffId},'client_account',${account.id},
                  ${tx.json({ discount_amount: Number(account.discount_amount) })},
                  ${tx.json({ discount_amount: args.discountAmount, reason: reason || null })},${args.traceId})`;

  const settled = await reconcileAccount(tx, {
    account: { ...account, discount_amount: args.discountAmount },
    staffId: args.staffId,
    traceId: args.traceId,
    eligibilityDate: new Date().toISOString().slice(0, 10),
  });

  return { account_id: account.id, discount_amount: args.discountAmount, ...settled };
}
