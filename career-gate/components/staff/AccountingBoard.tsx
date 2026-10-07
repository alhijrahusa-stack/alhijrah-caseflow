"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FinancialActionForm, type FinancialAction } from "@/components/staff/accounting/FinancialActions";
import { formatMoney, formatPercent } from "@/components/staff/accounting/money";
import { TransactionHistory } from "@/components/staff/accounting/TransactionHistory";
import { postAccounting, useFinancialMutation } from "@/components/staff/accounting/useFinancialMutation";
import type { AccountingRow, OperationsStaff } from "@/lib/operations";

/**
 * Accounts & Commissions.
 *
 * Each row reads as a statement of the account, with its actions behind compact
 * surfaces that open on demand. A full transaction editor is no longer mounted
 * inside every row: a board of fifty accounts used to render fifty live forms,
 * which buried the figures the page exists to show.
 *
 * The forms themselves are the shared ones the client file uses, so there is one
 * payment flow, one refund flow and one discount flow in the product.
 */

const money = formatMoney;

const ACTION_TITLE: Record<FinancialAction, string> = {
  payment: "Record payment",
  discount: "Apply discount",
  refund: "Record refund",
  adjustment: "Record adjustment",
  waiver: "Record waiver",
  completion: "Record application completion",
};

type CommissionChange = "approved" | "paid" | "cancelled" | "reversed";

/** Changes that pay out or undo money and so need an explicit confirmation. */
const HIGH_RISK_COMMISSION = new Set<CommissionChange>(["paid", "cancelled", "reversed"]);

function CommissionControl({ row, onDone }: { row: AccountingRow; onDone: () => void }) {
  const { outcome, run, reset, busy } = useFinancialMutation<{ commission?: { status?: string } }>();
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<CommissionChange | null>(null);

  if (!row.commission_id || !row.commission_status) {
    // The commission owner is the recorded application completer and nobody
    // else, so an unrecorded completion is the reason, not an error.
    return (
      <span className="ops-note" data-testid="commission-absent">
        {row.application_status === "completed"
          ? row.payment_status === "paid"
            ? "No commission generated; the owner has no active commission rule."
            : "No commission yet; the account is not fully paid."
          : "No commission: this application has no recorded completion, so it has no owner."}
      </span>
    );
  }

  const commissionId = row.commission_id;

  async function change(status: CommissionChange) {
    if (status === "paid" && !reference.trim()) { setPending(null); return; }
    const ok = await run(() => postAccounting({
      operation: "update_commission",
      commission_id: commissionId,
      status,
      payment_reference: status === "paid" ? reference.trim() : null,
      reason: status === "cancelled" || status === "reversed" ? reason.trim() || null : null,
    }));
    setPending(null);
    if (ok) { reset(); onDone(); }
  }

  function request(status: CommissionChange) {
    if (HIGH_RISK_COMMISSION.has(status)) { setPending(status); return; }
    void change(status);
  }

  return (
    <div className="ops-action-body">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase text-slate-300" data-testid="commission-status">{row.commission_status}</span>
        <strong className="text-sm" data-testid="commission-amount">{money(row.commission_amount)}</strong>
        <span className="ops-note">Owner: {row.commission_name ?? "—"}</span>
      </div>

      {row.commission_status === "approved" && (
        <label className="ops-field">
          <span>Payment reference</span>
          <input className="ops-input" value={reference} onChange={(e) => setReference(e.target.value)} data-testid="commission-reference" />
        </label>
      )}
      {(row.commission_status === "eligible" || row.commission_status === "approved" || row.commission_status === "paid") && (
        <label className="ops-field">
          <span>{row.commission_status === "paid" ? "Reversal reason" : "Cancellation reason"}</span>
          <input className="ops-input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="commission-reason" />
        </label>
      )}

      {pending && (
        <div className="ops-confirm" data-testid="commission-confirmation">
          <strong>Confirm {pending === "paid" ? "commission payment" : pending}</strong>
          <dl>
            <dt>Client</dt><dd>{row.full_name}</dd>
            <dt>Owner</dt><dd>{row.commission_name ?? "—"}</dd>
            <dt>Amount</dt><dd>{money(row.commission_amount)}</dd>
            <dt>Effect</dt>
            <dd>
              {pending === "paid"
                ? "Marks this commission as paid to the owner. Reversal is the only way back."
                : pending === "cancelled"
                  ? "Cancels the commission. It will not be paid."
                  : "Reverses a paid commission."}
            </dd>
          </dl>
          <div className="ops-action-bar">
            <button type="button" className="ops-primary-button" disabled={busy} onClick={() => void change(pending)} data-testid="commission-confirm">
              {busy ? "Working…" : `Confirm ${pending}`}
            </button>
            <button type="button" className="ops-secondary-button" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}

      {!pending && (
        <div className="ops-action-bar">
          {row.commission_status === "eligible" && (
            <button type="button" className="ops-primary-button" disabled={busy} onClick={() => request("approved")} data-testid="commission-approve">Approve</button>
          )}
          {row.commission_status === "approved" && (
            <button type="button" className="ops-primary-button" disabled={busy || !reference.trim()} onClick={() => request("paid")} data-testid="commission-pay">Mark paid</button>
          )}
          {(row.commission_status === "eligible" || row.commission_status === "approved") && (
            <button type="button" className="ops-secondary-button" disabled={busy || !reason.trim()} onClick={() => request("cancelled")} data-testid="commission-cancel">Cancel</button>
          )}
          {row.commission_status === "paid" && (
            <button type="button" className="ops-secondary-button" disabled={busy || !reason.trim()} onClick={() => request("reversed")} data-testid="commission-reverse">Reverse</button>
          )}
        </div>
      )}

      {outcome.state === "failed" && <p className="ops-inline-error" role="alert">{outcome.message}</p>}
      {outcome.state === "unknown" && (
        <p className="ops-inline-error" role="alert" data-testid="commission-unknown">
          {outcome.message} <button type="button" className="ops-secondary-button" onClick={() => { reset(); onDone(); }}>Reload</button>
        </p>
      )}
    </div>
  );
}

type Panel = { kind: "action"; action: FinancialAction } | { kind: "commission" } | { kind: "ledger" };

function AccountRow({ row, onDone }: { row: AccountingRow; onDone: () => void }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const discountEntered = row.discount_input_type === "percentage"
    ? formatPercent(row.discount_input_value)
    : row.discount_input_type === "amount"
      ? money(row.discount_input_value ?? 0)
      : null;

  const openAction = (action: FinancialAction) => () => {
    setMoreOpen(false);
    setPanel((current) => (current?.kind === "action" && current.action === action ? null : { kind: "action", action }));
  };
  const toggle = (next: Panel) => () => {
    setMoreOpen(false);
    setPanel((current) => (current?.kind === next.kind && next.kind !== "action" ? null : next));
  };

  return (
    <article className="ops-account-row" data-testid="account-row">
      <div className="ops-account-main-wide">
        <div>
          <span>Client</span>
          <strong><Link href={`/staff/client/${row.client_id}`} className="ops-account-name">{row.full_name}</Link></strong>
          <code>{row.ref}</code>
        </div>
        <div><span>Status</span><strong className="capitalize" data-testid="row-status">{row.payment_status.replace(/_/g, " ")}</strong></div>
        <div><span>Application completed by</span><strong data-testid="row-completed-by">{row.application_completed_name ?? "Not recorded"}</strong></div>
        <div><span>Original fee</span><strong data-testid="row-fee">{money(row.fee_amount)}</strong></div>
        <div><span>Discount</span><strong data-testid="row-discount">{row.discount_amount > 0 ? `${money(row.discount_amount)}${discountEntered ? ` (${discountEntered})` : ""}` : "—"}</strong></div>
        <div><span>Net fee</span><strong data-testid="row-net-fee">{money(row.net_fee)}</strong></div>
        <div><span>Paid</span><strong data-testid="row-paid">{money(row.amount_paid)}</strong></div>
        <div><span>Refunded</span><strong data-testid="row-refunded">{money(row.refund_amount)}</strong></div>
        <div><span>Outstanding</span><strong data-testid="row-outstanding">{money(row.balance)}</strong></div>
        <div><span>Commission staff</span><strong data-testid="row-commission-staff">{row.commission_name ?? "—"}</strong></div>
        <div><span>Commission</span><strong data-testid="row-commission-amount">{row.commission_status ? money(row.commission_amount) : "—"}</strong></div>
        <div><span>Commission status</span><strong data-testid="row-commission-status">{row.commission_status ?? "—"}</strong></div>
      </div>

      <div className="ops-action-bar">
        <button type="button" className="ops-primary-button" onClick={openAction("payment")} data-testid="row-record-payment">Record Payment</button>
        <Link href={`/staff/client/${row.client_id}`} className="ops-secondary-button" data-testid="row-view-client">View Client</Link>
        <span className="ops-more">
          <button type="button" className="ops-secondary-button" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)} data-testid="row-more">More</button>
          {moreOpen && (
            <span className="ops-more-menu" role="menu">
              <button type="button" role="menuitem" onClick={openAction("discount")} data-testid="row-discount-action">Apply Discount</button>
              <button type="button" role="menuitem" onClick={openAction("refund")} data-testid="row-refund">Refund</button>
              <button type="button" role="menuitem" onClick={openAction("adjustment")} data-testid="row-adjustment">Adjustment</button>
              <button type="button" role="menuitem" onClick={openAction("waiver")} data-testid="row-waiver">Waiver</button>
              <button type="button" role="menuitem" onClick={toggle({ kind: "commission" })} data-testid="row-commission">Commission</button>
              <button type="button" role="menuitem" onClick={toggle({ kind: "ledger" })} data-testid="row-ledger">Ledger · {row.transactions.length}</button>
            </span>
          )}
        </span>
      </div>

      {panel?.kind === "action" && (
        <div className="ops-action-surface" data-testid={`action-surface-${panel.action}`}>
          <p className="ops-action-title">{ACTION_TITLE[panel.action]}</p>
          <FinancialActionForm
            action={panel.action}
            account={{
              clientId: row.client_id,
              clientName: row.full_name,
              feeAmount: row.fee_amount,
              outstanding: row.balance,
              transactions: row.transactions,
            }}
            onDone={onDone}
            onClose={() => setPanel(null)}
          />
        </div>
      )}

      {panel?.kind === "commission" && (
        <div className="ops-action-surface" data-testid="commission-surface">
          <p className="ops-action-title">Commission</p>
          <CommissionControl row={row} onDone={onDone} />
        </div>
      )}

      {panel?.kind === "ledger" && (
        <div className="ops-action-surface" data-testid="ledger-surface">
          <TransactionHistory clientId={row.client_id} transactions={row.transactions} />
        </div>
      )}
    </article>
  );
}

export function AccountingBoard({ rows, staff, initialClient = null }: { rows: AccountingRow[]; staff: OperationsStaff[]; initialClient?: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState("all");
  const [staffId, setStaffId] = useState("all");
  const [q, setQ] = useState("");
  // Opening Accounting from a client file lands on that client's account.
  const [clientFocus, setClientFocus] = useState(initialClient);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((row) => {
      if (clientFocus && row.client_id !== clientFocus) return false;
      if (status !== "all" && row.payment_status !== status) return false;
      if (staffId !== "all" && row.assigned_staff !== staffId && row.commission_staff_id !== staffId && row.application_completed_by !== staffId) return false;
      if (!term) return true;
      return [row.full_name, row.ref, row.phone, row.email ?? "", row.site_code ?? "", row.site_name ?? ""]
        .some((value) => value.toLowerCase().includes(term));
    });
  }, [rows, status, staffId, q, clientFocus]);

  const totals = useMemo(() => ({
    outstanding: filtered.reduce((n, r) => n + Math.max(0, r.balance), 0),
    paid: filtered.reduce((n, r) => n + r.amount_paid, 0),
    refunded: filtered.reduce((n, r) => n + r.refund_amount, 0),
    commissions: filtered.filter((r) => r.commission_status && !["cancelled", "reversed"].includes(r.commission_status)).reduce((n, r) => n + r.commission_amount, 0),
  }), [filtered]);

  return (
    <div className="ops-page">
      <header className="ops-hero"><div><p className="ops-kicker">CAREER GATE · ACCOUNTS</p><h1>Accounts &amp; Commissions</h1><p>Immutable transaction ledger, derived balances, and auditable commissions.</p></div></header>
      <div className="ops-metric-grid">
        <div className="ops-metric"><span>Outstanding</span><strong>{money(totals.outstanding)}</strong></div>
        <div className="ops-metric"><span>Payments</span><strong>{money(totals.paid)}</strong></div>
        <div className="ops-metric"><span>Refunds</span><strong>{money(totals.refunded)}</strong></div>
        <div className="ops-metric"><span>Commissions</span><strong>{money(totals.commissions)}</strong></div>
      </div>

      <section className="ops-glass-card">
        <div className="ops-toolbar">
          <input className="ops-input ops-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email, file or site" />
          <select className="ops-select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All accounts</option><option value="unpaid">Unpaid</option><option value="partially_paid">Partially paid</option><option value="paid">Paid</option><option value="refunded">Refunded</option></select>
          <select className="ops-select" value={staffId} onChange={(e) => setStaffId(e.target.value)}><option value="all">All staff</option>{staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.staff_code ?? "—"} · {s.display_name}</option>)}</select>
          {clientFocus && (
            <button type="button" className="ops-secondary-button" data-testid="clear-client-focus" onClick={() => setClientFocus(null)}>
              Showing one client · show all
            </button>
          )}
        </div>

        <div className="ops-account-list">
          {filtered.map((row) => <AccountRow key={row.account_id} row={row} onDone={() => router.refresh()} />)}
          {!filtered.length && <div className="ops-empty-large">No accounts match this filter.</div>}
        </div>
      </section>
    </div>
  );
}
