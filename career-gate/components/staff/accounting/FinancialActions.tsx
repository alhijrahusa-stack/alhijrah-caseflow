"use client";

import { useMemo, useState } from "react";
import { DOC_MAX_BYTES } from "@/lib/domain";
import type { PaymentTransactionRow } from "@/lib/accounting-ledger-read";
import {
  PAYMENT_METHODS,
  businessToday,
  formatMoney,
  formatPercent,
  methodLabel,
  parseAmount,
  previewDiscount,
  transactionLabel,
} from "@/components/staff/accounting/money";
import { postAccounting, useFinancialMutation } from "@/components/staff/accounting/useFinancialMutation";

/**
 * Every financial action, for every surface.
 *
 * The client file and the Accounting board both mount this. There is one set of
 * forms, one validation message vocabulary, one confirmation step and one
 * canonical-result confirmation, so a payment recorded from a client file and
 * one recorded from Accounting are indistinguishable afterwards — the same
 * request, the same ledger row, the same audit entry.
 *
 * Nothing here decides a financial value. The server computes the discount, the
 * balance, the commission and the resulting status; this component shows what
 * came back.
 */

export type FinancialAction = "payment" | "discount" | "refund" | "adjustment" | "waiver" | "completion";

export type AccountContext = {
  clientId: string;
  clientName: string;
  feeAmount: number;
  outstanding: number;
  transactions: readonly PaymentTransactionRow[];
};

/** Actions that move money irreversibly enough to need an explicit confirmation. */
const HIGH_RISK = new Set<FinancialAction>(["refund", "waiver"]);

type CanonicalResult = {
  transaction?: { transaction_type?: string; amount?: string | number; transaction_reference?: string | null; payment_method?: string | null; receipt_document_id?: string | null };
  balance?: { payment_status?: string; balance?: string | number; net_fee?: string | number };
  commission?: { amount?: string | number; status?: string } | null;
  commission_blocked?: string | null;
  discount_amount?: string | number;
  discount_input_type?: string | null;
  discount_input_value?: string | number | null;
  idempotent?: boolean;
  client?: { application_completed_at?: string | null };
};

function commissionNote(result: CanonicalResult) {
  if (result.commission_blocked === "APPLICATION_NOT_COMPLETED") {
    return "No commission: this application has no recorded completion, so it has no owner.";
  }
  if (result.commission_blocked === "NO_ACTIVE_COMMISSION_RULE") {
    return "No commission: the owner has no active commission rule.";
  }
  if (result.commission) return `Commission ${formatMoney(result.commission.amount ?? 0)} · ${result.commission.status ?? "—"}`;
  return null;
}

/** The server's own words about what was recorded. Never local state. */
function CanonicalConfirmation({ result }: { result: CanonicalResult }) {
  const note = commissionNote(result);
  return (
    <div className="ops-canonical" role="status" data-testid="canonical-confirmation">
      <strong>
        {result.transaction
          ? `${transactionLabel(String(result.transaction.transaction_type))} recorded · ${formatMoney(result.transaction.amount ?? 0)}`
          : result.discount_amount != null
            ? `Discount applied · ${formatMoney(result.discount_amount)}`
            : "Recorded"}
        {result.idempotent ? " (already recorded — not duplicated)" : ""}
      </strong>
      <dl>
        {result.transaction?.payment_method && (
          <><dt>Method</dt><dd>{methodLabel(String(result.transaction.payment_method))}</dd></>
        )}
        {result.transaction?.transaction_reference && (
          <><dt>Reference</dt><dd data-testid="canonical-reference">{result.transaction.transaction_reference}</dd></>
        )}
        {result.transaction && (
          <><dt>Receipt</dt><dd>{result.transaction.receipt_document_id ? "Attached" : "None"}</dd></>
        )}
        {result.discount_input_type && (
          <><dt>Entered</dt><dd data-testid="canonical-discount-input">
            {result.discount_input_type === "percentage" ? formatPercent(result.discount_input_value) : formatMoney(result.discount_input_value)}
          </dd></>
        )}
        {result.balance?.net_fee != null && (<><dt>Net fee</dt><dd>{formatMoney(result.balance.net_fee)}</dd></>)}
        {result.balance?.balance != null && (
          <><dt>Outstanding</dt><dd data-testid="canonical-balance">{formatMoney(result.balance.balance)}</dd></>
        )}
        {result.balance?.payment_status && (
          <><dt>Status</dt><dd data-testid="canonical-status">{String(result.balance.payment_status).replace(/_/g, " ")}</dd></>
        )}
        {note && (<><dt>Commission</dt><dd data-testid="canonical-commission">{note}</dd></>)}
      </dl>
    </div>
  );
}

async function uploadReceipt(clientId: string, file: File) {
  if (file.size > DOC_MAX_BYTES) throw new Error("Receipt is larger than 4 MB");
  if (!file.type.startsWith("image/") && file.type !== "application/pdf") throw new Error("Receipt must be an image or PDF");
  const form = new FormData();
  form.set("client_id", clientId);
  form.set("doc_type", "other");
  form.set("file", file);
  const res = await fetch("/api/staff/documents", { method: "POST", body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Upload failed (${res.status})`);
  return { id: String(data.id), name: file.name };
}

export function FinancialActionForm({
  action,
  account,
  staffOptions,
  selfStaffId,
  canChooseCompleter,
  onDone,
  onClose,
}: {
  action: FinancialAction;
  account: AccountContext;
  staffOptions?: readonly { id: string; display_name: string }[];
  selfStaffId?: string;
  canChooseCompleter?: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const { outcome, run, reset, busy } = useFinancialMutation<CanonicalResult>();

  const [amount, setAmount] = useState(() =>
    action === "payment" ? String(Math.max(0, account.outstanding).toFixed(2)) : "");
  const [method, setMethod] = useState<string>("zelle");
  const [occurredOn, setOccurredOn] = useState(businessToday);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [discountType, setDiscountType] = useState<"amount" | "percentage">("amount");
  const [discountValue, setDiscountValue] = useState("");
  const [relatedId, setRelatedId] = useState("");
  const [receipt, setReceipt] = useState<{ id: string; name: string } | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [completedBy, setCompletedBy] = useState(selfStaffId ?? "");
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  // One idempotency key per attempt, kept across a retry of the same attempt so
  // the server recognises the repeat instead of recording a second transaction.
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());

  const refundable = useMemo(
    () => account.transactions.filter((t) => t.transaction_type === "payment" && t.status === "confirmed" && (t.refundable_remaining ?? 0) > 0),
    [account.transactions],
  );
  const selectedPayment = refundable.find((t) => t.id === relatedId) ?? refundable[0];
  const maxRefund = selectedPayment?.refundable_remaining ?? 0;

  const numericAmount = parseAmount(amount);
  const numericDiscount = parseAmount(discountValue);
  const discountPreview = numericDiscount == null ? null : previewDiscount(discountType, numericDiscount, account.feeAmount);

  function validate(): string | null {
    if (action === "completion") return completedBy ? null : "Select who completed the application.";
    if (action === "discount") {
      if (numericDiscount == null || numericDiscount < 0) return "Enter a discount value of zero or more.";
      if (discountType === "percentage" && numericDiscount > 100) return "A percentage discount cannot exceed 100%.";
      if (discountPreview != null && discountPreview > account.feeAmount) return "The discount cannot exceed the contracted fee.";
      if ((discountPreview ?? 0) > 0 && !reason.trim()) return "A reason is required for a discount.";
      return null;
    }
    if (numericAmount == null || numericAmount <= 0) return "Enter an amount greater than zero.";
    if (action === "payment" && !method) return "Choose a payment method.";
    if (action === "refund") {
      if (!selectedPayment) return "There is no payment left to refund against.";
      if (numericAmount > maxRefund) return `That is more than the ${formatMoney(maxRefund)} still refundable on this payment.`;
    }
    if ((action === "refund" || action === "adjustment" || action === "waiver") && !reason.trim()) {
      return "A reason is required.";
    }
    return null;
  }

  function body(): Record<string, unknown> {
    if (action === "completion") {
      return { operation: "record_application_completion", client_id: account.clientId, completed_by: completedBy, completed_on: occurredOn };
    }
    if (action === "discount") {
      return { operation: "apply_discount", client_id: account.clientId, discount_type: discountType, discount_value: numericDiscount, reason: reason.trim() || null };
    }
    return {
      operation: "record_transaction",
      client_id: account.clientId,
      transaction_type: action,
      direction: action === "adjustment" ? direction : null,
      amount: numericAmount,
      payment_method: action === "payment" ? method : null,
      occurred_on: occurredOn,
      // Never derived from intake text, notes or any document: only what the
      // operator typed for this payment, or nothing at all.
      transaction_reference: reference.trim() || null,
      receipt_document_id: receipt?.id ?? null,
      related_transaction_id: action === "refund" ? selectedPayment?.id ?? null : null,
      reason: reason.trim() || null,
      idempotency_key: operationKey,
    };
  }

  async function submit() {
    const problem = validate();
    if (problem) { setLocalError(problem); return; }
    setLocalError(null);
    if (HIGH_RISK.has(action) && !confirming) { setConfirming(true); return; }
    setConfirming(false);
    const result = await run(() => postAccounting<CanonicalResult>(body()));
    if (result) {
      setOperationKey(crypto.randomUUID());
      onDone();
    }
  }

  async function handleReceipt(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setReceiptError(null);
    try {
      setReceipt(await uploadReceipt(account.clientId, file));
    } catch (error) {
      // A receipt is separate from the payment: failing to attach one must not
      // be reported as a failed payment, and must not block recording it.
      setReceiptError(error instanceof Error ? error.message : "Receipt upload failed. The payment can still be recorded without it.");
    } finally {
      setUploading(false);
    }
  }

  if (outcome.state === "done") {
    return (
      <div className="ops-action-body" data-testid={`result-${action}`}>
        <CanonicalConfirmation result={outcome.result} />
        <div className="ops-action-bar">
          <button type="button" className="ops-primary-button" onClick={() => { reset(); onClose(); }}>Close</button>
        </div>
      </div>
    );
  }

  if (outcome.state === "unknown") {
    return (
      <div className="ops-action-body" data-testid="unknown-outcome">
        <p className="ops-inline-error" role="alert">{outcome.message}</p>
        <p className="ops-note">
          This operation may already have been applied. Reload the account and check the ledger before recording it again.
        </p>
        <div className="ops-action-bar">
          <button type="button" className="ops-primary-button" onClick={() => { reset(); onDone(); onClose(); }}>Reload the account</button>
        </div>
      </div>
    );
  }

  const confirmation = confirming && (
    <div className="ops-confirm" data-testid="high-risk-confirmation">
      <strong>Confirm {transactionLabel(action)}</strong>
      <dl>
        <dt>Client</dt><dd>{account.clientName}</dd>
        <dt>Amount</dt><dd>{formatMoney(numericAmount ?? 0)}</dd>
        {action === "refund" && selectedPayment && (
          <>
            <dt>Against payment</dt>
            <dd>{formatMoney(selectedPayment.amount)} on {selectedPayment.occurred_on}{selectedPayment.transaction_reference ? ` · ${selectedPayment.transaction_reference}` : ""}</dd>
          </>
        )}
        <dt>Effect</dt>
        <dd>
          {action === "refund"
            ? "Returns money against that payment and increases the outstanding balance. The original payment is kept."
            : "Reduces the amount owed without recording money received."}
        </dd>
      </dl>
    </div>
  );

  return (
    <div className="ops-action-body">
      {action === "completion" && (
        <>
          <p className="ops-note">
            The commission for this account belongs to whoever is recorded here. It does not follow reassignment,
            the staff member who records the payment, or who uploads the receipt.
          </p>
          <label className="ops-field">
            <span>Completed by</span>
            <select className="ops-select" value={completedBy} disabled={!canChooseCompleter} onChange={(e) => setCompletedBy(e.target.value)} data-testid="completion-staff">
              <option value="">— Select —</option>
              {(staffOptions ?? []).map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
            </select>
          </label>
          <label className="ops-field">
            <span>Completed on</span>
            <input className="ops-input" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} data-testid="completion-date" />
          </label>
        </>
      )}

      {action === "discount" && (
        <>
          <p className="ops-note">The contracted fee stays {formatMoney(account.feeAmount)}; the discount is recorded beside it.</p>
          <label className="ops-field">
            <span>Discount type</span>
            <select className="ops-select" value={discountType} onChange={(e) => setDiscountType(e.target.value as "amount" | "percentage")} data-testid="discount-type">
              <option value="amount">Amount</option>
              <option value="percentage">Percentage</option>
            </select>
          </label>
          <label className="ops-field">
            <span>{discountType === "percentage" ? "Percentage" : "Amount"}</span>
            <input className="ops-input" inputMode="decimal" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} data-testid="discount-value" />
          </label>
          <label className="ops-field">
            <span>Reason</span>
            <input className="ops-input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="discount-reason" />
          </label>
          {discountPreview != null && (
            <p className="ops-note" data-testid="discount-preview">
              Preview: {formatMoney(discountPreview)} off, net fee {formatMoney(Math.max(0, account.feeAmount - discountPreview))}.
              The server recalculates this from the recorded fee before saving.
            </p>
          )}
        </>
      )}

      {action !== "completion" && action !== "discount" && (
        <>
          {action === "refund" && (
            <label className="ops-field">
              <span>Original payment</span>
              <select
                className="ops-select"
                value={selectedPayment?.id ?? ""}
                onChange={(e) => { setRelatedId(e.target.value); setConfirming(false); }}
                data-testid="refund-original"
              >
                {refundable.length === 0 && <option value="">No refundable payment</option>}
                {refundable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {formatMoney(t.amount)} · {t.occurred_on} · {methodLabel(t.payment_method)} · {formatMoney(t.refundable_remaining ?? 0)} refundable
                  </option>
                ))}
              </select>
            </label>
          )}
          {action === "adjustment" && (
            <label className="ops-field">
              <span>Direction</span>
              <select className="ops-select" value={direction} onChange={(e) => setDirection(e.target.value as "credit" | "debit")} data-testid="adjustment-direction">
                <option value="credit">Credit — reduces what is owed</option>
                <option value="debit">Debit — increases what is owed</option>
              </select>
            </label>
          )}
          <label className="ops-field">
            <span>Amount</span>
            <input className="ops-input" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setConfirming(false); }} data-testid={`${action}-amount`} />
          </label>
          {action === "refund" && selectedPayment && (
            <p className="ops-note">{formatMoney(maxRefund)} of this payment is still refundable.</p>
          )}
          {action === "payment" && (
            <label className="ops-field">
              <span>Payment method</span>
              <select className="ops-select" value={method} onChange={(e) => setMethod(e.target.value)} data-testid="payment-method">
                {PAYMENT_METHODS.map((value) => <option key={value} value={value}>{methodLabel(value)}</option>)}
              </select>
            </label>
          )}
          <label className="ops-field">
            <span>{action === "payment" ? "Received on" : "Recorded on"}</span>
            <input className="ops-input" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} data-testid={`${action}-date`} />
          </label>
          {action === "payment" && (
            <label className="ops-field">
              <span>Payment reference</span>
              <input
                className="ops-input"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="From the payment itself — leave empty if there is none"
                data-testid="payment-reference"
              />
            </label>
          )}
          <label className="ops-field">
            <span>{action === "payment" ? "Note" : "Reason"}</span>
            <input className="ops-input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`${action}-reason`} />
          </label>
          {action === "payment" && (
            <>
              <label className="ops-upload ops-receipt-drop">
                <input type="file" accept="image/*,application/pdf" disabled={uploading || busy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void handleReceipt(file); }} />
                <span className="ops-receipt-icon" aria-hidden="true">⇧</span>
                <span className="ops-receipt-copy"><strong>{receipt?.name ?? (uploading ? "Uploading…" : "Attach receipt")}</strong><small>Image or PDF · max 4 MB</small></span>
              </label>
              {receiptError && <p className="ops-inline-error" role="alert" data-testid="receipt-error">{receiptError}</p>}
            </>
          )}
        </>
      )}

      {confirmation}
      {localError && <p className="ops-inline-error" role="alert" data-testid="action-error">{localError}</p>}
      {outcome.state === "failed" && <p className="ops-inline-error" role="alert" data-testid="server-error">{outcome.message}</p>}

      <div className="ops-action-bar">
        <button type="button" className="ops-primary-button" onClick={() => void submit()} disabled={busy || uploading} data-testid={`submit-${action}`}>
          {busy ? "Recording…" : confirming ? `Confirm ${transactionLabel(action)}` : action === "completion" ? "Record completion" : action === "discount" ? "Apply discount" : `Record ${transactionLabel(action)}`}
        </button>
        <button type="button" className="ops-secondary-button" onClick={() => { setConfirming(false); onClose(); }} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
