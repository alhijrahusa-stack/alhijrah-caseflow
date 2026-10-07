import "server-only";

/**
 * The one canonical shape every surface reads the ledger in.
 *
 * The client file and the Accounting board both render transaction history and
 * transaction detail. They read it through this fragment, so there is one SQL
 * definition of a ledger row, one definition of what remains refundable on a
 * payment, and one definition of the credits standing after a transaction —
 * all computed by the database, never recomputed in a browser.
 */

export type TransactionType = "payment" | "refund" | "adjustment" | "waiver";
export type TransactionDirection = "credit" | "debit";

export type PaymentTransactionRow = {
  id: string;
  transaction_type: TransactionType;
  direction: TransactionDirection;
  amount: number;
  status: "pending" | "confirmed" | "failed" | "voided" | "refunded";
  payment_method: string | null;
  occurred_at: string;
  /** The business-timezone calendar date this transaction is recorded against. */
  occurred_on: string;
  transaction_reference: string | null;
  receipt_document_id: string | null;
  related_transaction_id: string | null;
  reason: string | null;
  source: string;
  recorded_by_name: string | null;
  /**
   * For a confirmed payment: what may still be refunded against it, after the
   * refunds already linked to it. Null for every other row — only a payment is
   * refundable. Computed by the database so no caller derives it.
   */
  refundable_remaining: number | null;
  /** Confirmed net credits standing after this transaction, in ledger order. */
  credits_after: number;
};

/**
 * The authoritative business timezone for staff-facing financial dates.
 *
 * A transaction's date is a calendar date the operator entered, stored as
 * midnight in the database session's own timezone (`occurred_on::date::timestamptz`).
 * It is therefore read back with a plain `::date`, in that same frame, so the
 * date that comes out is the date that went in. Converting such a timestamp to a
 * display timezone moves it: midnight UTC on the 2nd is 8pm Detroit on the 1st,
 * which is how a payment recorded today could be shown as yesterday's.
 */
export const BUSINESS_TIMEZONE = "America/Detroit";

/**
 * A lateral that aggregates one account's ledger into a single jsonb array,
 * newest first. `accountAlias` must name a `client_accounts` row in scope.
 */
export const LEDGER_JSON = (accountAlias: string) => `
  select jsonb_agg(jsonb_build_object(
    'id',l.id,
    'transaction_type',l.transaction_type,
    'direction',l.direction,
    'amount',l.amount,
    'status',l.status,
    'payment_method',l.payment_method,
    'occurred_at',l.occurred_at,
    'occurred_on',l.occurred_at::date::text,
    'transaction_reference',l.transaction_reference,
    'receipt_document_id',l.receipt_document_id,
    'related_transaction_id',l.related_transaction_id,
    'reason',l.reason,
    'source',l.source,
    'recorded_by_name',l.recorded_by_name,
    'refundable_remaining',l.refundable_remaining,
    'credits_after',l.credits_after
  ) order by l.occurred_at desc,l.created_at desc) transactions
  from (
    select t.id,t.transaction_type,t.direction,t.amount,t.status,t.payment_method,
           t.occurred_at,t.created_at,t.transaction_reference,t.receipt_document_id,
           t.related_transaction_id,t.reason,t.source,rs.display_name recorded_by_name,
           case
             when t.transaction_type='payment' and t.status='confirmed'
             then greatest(
               0,
               t.amount - coalesce((
                 select sum(r.amount) from public.payment_transactions r
                 where r.related_transaction_id=t.id
                   and r.transaction_type='refund' and r.status='confirmed'
               ),0)
             )::numeric(10,2)
           end refundable_remaining,
           sum(case when t.status='confirmed' and t.direction='credit' then t.amount
                    when t.status='confirmed' and t.direction='debit' then -t.amount
                    else 0 end)
             over (order by t.occurred_at,t.created_at
                   rows between unbounded preceding and current row)::numeric(10,2) credits_after
    from public.payment_transactions t
    left join public.staff rs on rs.id=t.recorded_by
    where t.account_id=${accountAlias}.id
  ) l`;

/** Normalizes the numeric fields the driver returns as strings. */
export function normalizeLedger(rows: unknown): PaymentTransactionRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const t = row as PaymentTransactionRow;
    return {
      ...t,
      amount: Number(t.amount),
      refundable_remaining: t.refundable_remaining == null ? null : Number(t.refundable_remaining),
      credits_after: Number(t.credits_after),
    };
  });
}
