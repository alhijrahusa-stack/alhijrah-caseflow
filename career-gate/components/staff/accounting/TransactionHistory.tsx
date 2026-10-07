"use client";

import { useState } from "react";
import type { PaymentTransactionRow } from "@/lib/accounting-ledger-read";
import { formatMoney, methodLabel, transactionLabel } from "@/components/staff/accounting/money";

/**
 * The authoritative ledger, rendered.
 *
 * Both financial surfaces mount this, over the same rows from
 * `payment_transactions`. It computes no total, no balance and no refundable
 * amount of its own: every figure shown, including what remains refundable and
 * the credits standing after a transaction, was produced by the database.
 *
 * Recent activity is shown by default and the rest loads on demand, so an
 * account with a long history does not pay for it on first render.
 */

const PREVIEW_COUNT = 4;

function ReceiptLink({ clientId, documentId }: { clientId: string; documentId: string }) {
  // The same canonical document record both surfaces resolve, through the
  // existing private document route — never a public URL.
  return (
    <a className="ops-receipt-link" href={`/staff/client/${clientId}?tab=documents&document=${documentId}`} data-testid="receipt-link">
      Receipt
    </a>
  );
}

function TransactionDetail({ clientId, row, related }: { clientId: string; row: PaymentTransactionRow; related: PaymentTransactionRow | undefined }) {
  return (
    <dl className="ops-ledger-detail" data-testid="transaction-detail">
      <dt>Type</dt><dd>{transactionLabel(row.transaction_type)}{row.direction === "debit" ? " · debit" : " · credit"}</dd>
      <dt>Amount</dt><dd>{formatMoney(row.amount)}</dd>
      <dt>Date</dt><dd>{row.occurred_on}</dd>
      <dt>Status</dt><dd>{row.status}</dd>
      <dt>Method</dt><dd>{methodLabel(row.payment_method)}</dd>
      <dt>Reference</dt><dd data-testid="detail-reference">{row.transaction_reference ?? "None recorded"}</dd>
      <dt>Recorded by</dt><dd>{row.recorded_by_name ?? "—"}</dd>
      <dt>Credits after</dt><dd data-testid="detail-credits-after">{formatMoney(row.credits_after)}</dd>
      {row.refundable_remaining != null && (
        <><dt>Still refundable</dt><dd data-testid="detail-refundable">{formatMoney(row.refundable_remaining)}</dd></>
      )}
      {related && (
        <>
          <dt>Against payment</dt>
          <dd>{formatMoney(related.amount)} on {related.occurred_on}{related.transaction_reference ? ` · ${related.transaction_reference}` : ""}</dd>
        </>
      )}
      {row.reason && (<><dt>Reason</dt><dd>{row.reason}</dd></>)}
      <dt>Receipt</dt>
      <dd>{row.receipt_document_id ? <ReceiptLink clientId={clientId} documentId={row.receipt_document_id} /> : "None"}</dd>
    </dl>
  );
}

export function TransactionHistory({
  clientId,
  transactions,
  label = "Ledger",
}: {
  clientId: string;
  transactions: readonly PaymentTransactionRow[];
  label?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  if (transactions.length === 0) {
    return <p className="ops-note" data-testid="ledger-empty">No transactions recorded.</p>;
  }

  const visible = showAll ? transactions : transactions.slice(0, PREVIEW_COUNT);
  const byId = new Map(transactions.map((t) => [t.id, t]));

  return (
    <div className="ops-ledger" data-testid="transaction-history">
      <p className="ops-ledger-head">
        {label} · {transactions.length} transaction{transactions.length === 1 ? "" : "s"}
      </p>
      <ul className="ops-ledger-list">
        {visible.map((row) => {
          const open = openId === row.id;
          return (
            <li key={row.id} className="ops-ledger-item" data-testid="ledger-transaction">
              <button
                type="button"
                className="ops-ledger-row"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : row.id)}
                data-testid="ledger-row"
              >
                <span className="ops-ledger-date">{row.occurred_on}</span>
                <span className="ops-ledger-type">{transactionLabel(row.transaction_type)}</span>
                <span className="ops-ledger-amount">{row.direction === "credit" ? "+" : "−"}{formatMoney(row.amount)}</span>
                <span className="ops-ledger-method">{methodLabel(row.payment_method)}</span>
                <span className="ops-ledger-ref">{row.transaction_reference ?? "—"}</span>
                <span className="ops-ledger-receipt">{row.receipt_document_id ? "Receipt" : "—"}</span>
                <span className="ops-ledger-by">{row.recorded_by_name ?? "—"}</span>
              </button>
              {open && <TransactionDetail clientId={clientId} row={row} related={row.related_transaction_id ? byId.get(row.related_transaction_id) : undefined} />}
            </li>
          );
        })}
      </ul>
      {transactions.length > PREVIEW_COUNT && (
        <button type="button" className="ops-secondary-button" onClick={() => setShowAll((v) => !v)} data-testid="ledger-toggle">
          {showAll ? "Show recent only" : `Show all ${transactions.length}`}
        </button>
      )}
    </div>
  );
}
