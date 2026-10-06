"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStaff } from "@/components/staff/StaffContext";
import type { ClientAccountSummary } from "@/lib/client-account";

/**
 * The client file's financial surface.
 *
 * Every action here posts to `/api/staff/accounting`, the same authoritative
 * write path the Accounting screen uses, so a payment or a discount recorded
 * from the client file and one recorded from Accounting are the same operation
 * with the same ledger entry, the same audit row and the same commission rule.
 * Nothing financial is computed in the browser: the figures shown are the ones
 * `client_account_balances` returned.
 */

type Action = "payment" | "discount" | "completion";

async function post(body: unknown) {
  const res = await fetch("/api/staff/accounting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data;
}

const money = (value: number) => `$${value.toFixed(2)}`;
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_CLASS: Record<string, string> = {
  paid: "border-emerald-400/25 bg-emerald-400/[.08] text-emerald-300",
  refunded: "border-red-400/25 bg-red-400/[.08] text-red-300",
  partially_paid: "border-amber-400/25 bg-amber-400/[.08] text-amber-300",
  unpaid: "border-amber-400/25 bg-amber-400/[.08] text-amber-300",
};

export function ClientAccountPanel({ clientId, account }: { clientId: string; account: ClientAccountSummary }) {
  const { me, isManager, activeStaff } = useStaff();
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("zelle");
  const [occurredOn, setOccurredOn] = useState(today);
  const [reference, setReference] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [completedBy, setCompletedBy] = useState(me.id);
  const [completedOn, setCompletedOn] = useState(today);

  if (!account) return null;

  // Only management may record money. Recording who completed an application is
  // ordinary case work, so any staff member may record their own.
  const canRecordOwnCompletion = isManager || completedBy === me.id;

  async function run(body: unknown, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await post(body);
      const blocked = data?.commission_blocked;
      setNotice(
        blocked === "APPLICATION_NOT_COMPLETED"
          ? `${message} No commission was created: the application has no recorded completion, so it has no owner.`
          : blocked === "NO_ACTIVE_COMMISSION_RULE"
            ? `${message} No commission was created: the owner has no active commission rule.`
            : message,
      );
      setAction(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }

  const completion = account.application_status === "completed" && account.application_completed_name
    ? `${account.application_completed_name}${account.application_completed_at ? ` · ${account.application_completed_at}` : ""}`
    : null;

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
        <strong className="text-sm text-slate-200" data-testid="account-net-fee">{money(account.net_fee)}</strong>
        {account.discount_amount > 0 && (
          <span className="text-[9px] text-slate-500" data-testid="account-discount">
            {money(account.fee_amount)} less {money(account.discount_amount)} discount
          </span>
        )}
        {account.payment_date && <span className="text-[9px] text-slate-500">{account.payment_date}</span>}
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
        {account.amount_paid_visible && (
          <>
            <dt className="text-slate-600">Paid</dt>
            <dd className="text-right font-mono text-slate-300" data-testid="account-amount-paid">{money(account.amount_paid)}</dd>
            <dt className="text-slate-600">Balance</dt>
            <dd className="text-right font-mono text-slate-300" data-testid="account-balance">{money(account.balance)}</dd>
          </>
        )}
        <dt className="text-slate-600">Application</dt>
        <dd className="text-right text-slate-300" data-testid="account-application">
          {completion ?? <span className="text-amber-300">Not recorded</span>}
        </dd>
        {account.amount_paid_visible && (
          <>
            <dt className="text-slate-600">Commission</dt>
            <dd className="text-right text-slate-300" data-testid="account-commission">
              {account.commission_status
                ? `${money(account.commission_amount)} · ${account.staff_name ?? "—"} · ${account.commission_status}`
                : "—"}
            </dd>
          </>
        )}
      </dl>

      {account.discount_reason && (
        <p className="mt-1 text-[9px] text-slate-500" data-testid="account-discount-reason">Discount reason: {account.discount_reason}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {isManager && (
          <>
            <button type="button" className="staff-chip" data-testid="action-record-payment" onClick={() => setAction(action === "payment" ? null : "payment")}>
              Record Payment
            </button>
            <button type="button" className="staff-chip" data-testid="action-apply-discount" onClick={() => setAction(action === "discount" ? null : "discount")}>
              Apply Discount
            </button>
          </>
        )}
        <button type="button" className="staff-chip" data-testid="action-record-completion" onClick={() => setAction(action === "completion" ? null : "completion")}>
          Record Application Completion
        </button>
      </div>

      {action === "payment" && (
        <form
          className="mt-3 space-y-2"
          data-testid="payment-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              {
                operation: "record_transaction",
                client_id: clientId,
                transaction_type: "payment",
                amount: Number(amount),
                payment_method: method,
                occurred_on: occurredOn,
                transaction_reference: reference.trim() || null,
                idempotency_key: crypto.randomUUID(),
              },
              "Payment recorded.",
            );
          }}
        >
          <label className="block text-[10px] text-slate-500">
            Amount
            <input className="staff-input mt-1 w-full" type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="payment-amount" />
          </label>
          <label className="block text-[10px] text-slate-500">
            Method
            <select className="staff-input mt-1 w-full" value={method} onChange={(e) => setMethod(e.target.value)} data-testid="payment-method">
              {["zelle", "bank_transfer", "cash", "card", "other"].map((value) => (
                <option key={value} value={value}>{value.replace(/_/g, " ")}</option>
              ))}
            </select>
          </label>
          <label className="block text-[10px] text-slate-500">
            Received on
            <input className="staff-input mt-1 w-full" type="date" required value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} data-testid="payment-date" />
          </label>
          <label className="block text-[10px] text-slate-500">
            Reference
            <input className="staff-input mt-1 w-full" value={reference} onChange={(e) => setReference(e.target.value)} data-testid="payment-reference" />
          </label>
          <button type="submit" className="staff-chip" disabled={busy} data-testid="payment-submit">{busy ? "Recording…" : "Record payment"}</button>
        </form>
      )}

      {action === "discount" && (
        <form
          className="mt-3 space-y-2"
          data-testid="discount-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              { operation: "apply_discount", client_id: clientId, discount_amount: Number(discount), reason: discountReason.trim() || null },
              "Discount applied.",
            );
          }}
        >
          <p className="text-[9px] text-slate-500">The contracted fee stays {money(account.fee_amount)}; the discount is recorded beside it.</p>
          <label className="block text-[10px] text-slate-500">
            Discount amount
            <input className="staff-input mt-1 w-full" type="number" step="0.01" min="0" max={account.fee_amount} required value={discount} onChange={(e) => setDiscount(e.target.value)} data-testid="discount-amount" />
          </label>
          <label className="block text-[10px] text-slate-500">
            Reason
            <input className="staff-input mt-1 w-full" required={Number(discount) > 0} value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} data-testid="discount-reason" />
          </label>
          <button type="submit" className="staff-chip" disabled={busy} data-testid="discount-submit">{busy ? "Applying…" : "Apply discount"}</button>
        </form>
      )}

      {action === "completion" && (
        <form
          className="mt-3 space-y-2"
          data-testid="completion-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              { operation: "record_application_completion", client_id: clientId, completed_by: completedBy, completed_on: completedOn },
              "Application completion recorded.",
            );
          }}
        >
          <p className="text-[9px] text-slate-500">
            The commission for this account belongs to whoever is recorded here. It does not follow reassignment,
            the staff member who records the payment, or who uploads the receipt.
          </p>
          <label className="block text-[10px] text-slate-500">
            Completed by
            <select className="staff-input mt-1 w-full" value={completedBy} onChange={(e) => setCompletedBy(e.target.value)} disabled={!isManager} data-testid="completion-staff">
              {(isManager ? activeStaff : activeStaff.filter((s) => s.id === me.id)).map((member) => (
                <option key={member.id} value={member.id}>{member.display_name}</option>
              ))}
            </select>
          </label>
          <label className="block text-[10px] text-slate-500">
            Completed on
            <input className="staff-input mt-1 w-full" type="date" required value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} data-testid="completion-date" />
          </label>
          <button type="submit" className="staff-chip" disabled={busy || !canRecordOwnCompletion} data-testid="completion-submit">
            {busy ? "Recording…" : "Record completion"}
          </button>
        </form>
      )}

      {error && <p className="mt-2 text-[10px] text-red-300" role="alert" data-testid="account-error">{error}</p>}
      {notice && <p className="mt-2 text-[10px] text-emerald-300" role="status" data-testid="account-notice">{notice}</p>}
    </div>
  );
}
