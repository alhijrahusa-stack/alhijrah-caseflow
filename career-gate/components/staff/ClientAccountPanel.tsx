"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FinancialActionForm, type FinancialAction } from "@/components/staff/accounting/FinancialActions";
import { formatMoney, formatPercent } from "@/components/staff/accounting/money";
import { TransactionHistory } from "@/components/staff/accounting/TransactionHistory";
import { useStaff } from "@/components/staff/StaffContext";
import type { ClientAccountSummary } from "@/lib/client-account";

/**
 * The client file's financial surface.
 *
 * It reads first: the account's state is visible at a glance and no financial
 * form is open until an action is chosen. Every action it offers posts to
 * `/api/staff/accounting` through the same shared forms the Accounting board
 * uses, so a payment recorded here and one recorded there are the same
 * operation, with the same ledger row and the same audit entry.
 *
 * No figure here is computed in the browser. The fee, discount, net fee, paid,
 * refunded, outstanding, status and commission all come from
 * `client_account_balances` and the ledger.
 */

const STATUS_CLASS: Record<string, string> = {
  paid: "border-emerald-400/25 bg-emerald-400/[.08] text-emerald-300",
  refunded: "border-red-400/25 bg-red-400/[.08] text-red-300",
  partially_paid: "border-amber-400/25 bg-amber-400/[.08] text-amber-300",
  unpaid: "border-amber-400/25 bg-amber-400/[.08] text-amber-300",
};

const ACTION_TITLE: Record<FinancialAction, string> = {
  payment: "Record payment",
  discount: "Apply discount",
  refund: "Record refund",
  adjustment: "Record adjustment",
  waiver: "Record waiver",
  completion: "Record application completion",
};

function Figure({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong data-testid={testId}>{value}</strong>
    </div>
  );
}

export function ClientAccountPanel({ clientId, account }: { clientId: string; account: ClientAccountSummary }) {
  const { me, isManager, activeStaff } = useStaff();
  const router = useRouter();
  const [action, setAction] = useState<FinancialAction | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  if (!account) return null;

  const completion = account.application_status === "completed" && account.application_completed_name
    ? `${account.application_completed_name}${account.application_completed_at ? ` · ${account.application_completed_at}` : ""}`
    : null;

  const discountEntered = account.discount_input_type === "percentage"
    ? formatPercent(account.discount_input_value)
    : account.discount_input_type === "amount"
      ? formatMoney(account.discount_input_value)
      : null;

  const open = (next: FinancialAction) => () => {
    setMoreOpen(false);
    setAction((current) => (current === next ? null : next));
  };

  return (
    <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3" data-testid="client-account-panel">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[.14em] text-slate-600">Account</p>
        {isManager && (
          <Link
            href={`/staff/accounting?client=${encodeURIComponent(clientId)}`}
            className="text-[9px] text-cyan-300 hover:text-cyan-200"
            data-testid="open-accounting"
          >
            Open accounting
          </Link>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2 py-1 text-[9px] font-semibold capitalize ${STATUS_CLASS[account.payment_status] ?? STATUS_CLASS.unpaid}`}
          data-testid="account-payment-status"
        >
          {account.payment_status.replace(/_/g, " ")}
        </span>
        <strong className="text-sm text-slate-200" data-testid="account-net-fee">{formatMoney(account.net_fee)}</strong>
        {account.payment_date && <span className="text-[9px] text-slate-500" data-testid="account-last-payment">Last payment {account.payment_date}</span>}
      </div>

      <div className="ops-account-main-wide mt-3">
        <Figure label="Application" value={completion ?? "Not recorded"} testId="account-application" />
        <Figure label="Original fee" value={formatMoney(account.fee_amount)} testId="account-fee" />
        <Figure
          label="Discount"
          value={account.discount_amount > 0 ? `${formatMoney(account.discount_amount)}${discountEntered ? ` (${discountEntered})` : ""}` : "—"}
          testId="account-discount"
        />
        <Figure label="Net fee" value={formatMoney(account.net_fee)} testId="account-net-fee-figure" />
        {account.amount_paid_visible && (
          <>
            <Figure label="Paid" value={formatMoney(account.amount_paid)} testId="account-amount-paid" />
            <Figure label="Refunded" value={formatMoney(account.refund_amount)} testId="account-refunded" />
            <Figure label="Outstanding" value={formatMoney(account.balance)} testId="account-balance" />
          </>
        )}
        <Figure label="Receipt" value={account.transactions.some((t) => t.receipt_document_id) ? "Attached" : "None"} testId="account-receipt-status" />
        {account.amount_paid_visible && (
          <Figure
            label="Commission"
            value={account.commission_status
              ? `${formatMoney(account.commission_amount)} · ${account.staff_name ?? "—"} · ${account.commission_status}`
              : "—"}
            testId="account-commission"
          />
        )}
      </div>

      {account.discount_reason && (
        <p className="mt-2 text-[9px] text-slate-500" data-testid="account-discount-reason">Discount reason: {account.discount_reason}</p>
      )}

      <div className="ops-action-bar">
        {isManager && (
          <button type="button" className="ops-primary-button" data-testid="action-record-payment" onClick={open("payment")}>
            Record Payment
          </button>
        )}
        <button type="button" className="ops-secondary-button" data-testid="action-record-completion" onClick={open("completion")}>
          Record Application Completion
        </button>
        {isManager && (
          <button type="button" className="ops-secondary-button" data-testid="action-apply-discount" onClick={open("discount")}>
            Apply Discount
          </button>
        )}
        {isManager && (
          <span className="ops-more">
            <button type="button" className="ops-secondary-button" aria-expanded={moreOpen} data-testid="action-more" onClick={() => setMoreOpen((v) => !v)}>
              More
            </button>
            {moreOpen && (
              <span className="ops-more-menu" role="menu">
                <button type="button" role="menuitem" data-testid="action-refund" onClick={open("refund")}>Refund</button>
                <button type="button" role="menuitem" data-testid="action-adjustment" onClick={open("adjustment")}>Adjustment</button>
                <button type="button" role="menuitem" data-testid="action-waiver" onClick={open("waiver")}>Waiver</button>
              </span>
            )}
          </span>
        )}
      </div>

      {action && (
        <div className="ops-action-surface" data-testid={`action-surface-${action}`}>
          <p className="ops-action-title">{ACTION_TITLE[action]}</p>
          <FinancialActionForm
            action={action}
            account={{
              clientId,
              clientName: account.application_completed_name ?? "this client",
              feeAmount: account.fee_amount,
              outstanding: account.balance,
              transactions: account.transactions,
            }}
            staffOptions={isManager ? activeStaff : activeStaff.filter((s) => s.id === me.id)}
            selfStaffId={me.id}
            canChooseCompleter={isManager}
            onDone={() => router.refresh()}
            onClose={() => setAction(null)}
          />
        </div>
      )}

      {account.amount_paid_visible && account.transactions.length > 0 && (
        <div className="ops-action-surface">
          <TransactionHistory clientId={clientId} transactions={account.transactions} />
        </div>
      )}
    </div>
  );
}
