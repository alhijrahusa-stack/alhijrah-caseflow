"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DOC_MAX_BYTES } from "@/lib/domain";
import type { AccountingRow, OperationsStaff, TransactionDirection, TransactionType } from "@/lib/operations";

type PaymentMethod = "zelle" | "bank_transfer" | "cash" | "card" | "other";

async function postAccounting(body: Record<string, unknown>) {
  const res = await fetch("/api/staff/accounting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

function AccountEditor({ row }: { row: AccountingRow }) {
  const router = useRouter();
  const [type, setType] = useState<TransactionType>("payment");
  const [direction, setDirection] = useState<TransactionDirection>("credit");
  const [amount, setAmount] = useState(String(Math.max(0, row.balance).toFixed(2)));
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [relatedId, setRelatedId] = useState("");
  const [receiptId, setReceiptId] = useState("");
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refundable = row.transactions.filter((t) => t.transaction_type === "payment" && t.status === "confirmed");

  async function upload(file: File) {
    if (file.size > DOC_MAX_BYTES) throw new Error("Receipt is larger than 4 MB");
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") throw new Error("Receipt must be an image or PDF");
    const form = new FormData();
    form.set("client_id", row.client_id);
    form.set("doc_type", "other");
    form.set("file", file);
    const res = await fetch("/api/staff/documents", { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Upload failed (${res.status})`);
    setReceiptId(String(data.id));
    setReceiptName(file.name);
  }

  async function handleReceipt(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try { await upload(file); } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(false); }
  }

  function changeType(next: TransactionType) {
    setType(next);
    setDirection(next === "refund" ? "debit" : "credit");
    setRelatedId(next === "refund" ? refundable[0]?.id ?? "" : "");
    if (next === "payment") setAmount(String(Math.max(0, row.balance).toFixed(2)));
    else if (next === "refund") setAmount(String((refundable[0]?.amount ?? 0).toFixed(2)));
    else setAmount("0.00");
    setMessage(null);
    setError(null);
  }

  async function record() {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) { setError("Enter an amount greater than zero"); return; }
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await postAccounting({
        operation: "record_transaction",
        client_id: row.client_id,
        transaction_type: type,
        direction: type === "adjustment" ? direction : null,
        amount: numeric,
        payment_method: method || null,
        occurred_on: date,
        transaction_reference: reference.trim() || null,
        receipt_document_id: receiptId || null,
        related_transaction_id: type === "refund" ? relatedId || null : null,
        reason: reason.trim() || null,
        idempotency_key: operationKey,
      });
      setMessage("Transaction recorded");
      setOperationKey(crypto.randomUUID());
      setReference("");
      setReason("");
      setReceiptId("");
      setReceiptName(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to record transaction");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="ops-account-editor">
        <select className="ops-select" aria-label="Transaction type" value={type} onChange={(e) => changeType(e.target.value as TransactionType)}>
          <option value="payment">Payment</option>
          <option value="refund">Refund</option>
          <option value="adjustment">Adjustment</option>
          <option value="waiver">Waiver</option>
        </select>
        {type === "adjustment" && (
          <select className="ops-select" aria-label="Adjustment direction" value={direction} onChange={(e) => setDirection(e.target.value as TransactionDirection)}>
            <option value="credit">Credit</option><option value="debit">Debit</option>
          </select>
        )}
        {type === "refund" && (
          <select className="ops-select" aria-label="Original payment" value={relatedId} onChange={(e) => { setRelatedId(e.target.value); const tx = refundable.find((x) => x.id === e.target.value); if (tx) setAmount(tx.amount.toFixed(2)); }}>
            <option value="">Original payment</option>
            {refundable.map((tx) => <option key={tx.id} value={tx.id}>{money(tx.amount)} · {new Date(tx.occurred_at).toLocaleDateString()}</option>)}
          </select>
        )}
        <input className="ops-input" aria-label="Transaction amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {type === "payment" && (
          <select className="ops-select" aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | "")}>
            <option value="">Payment method</option><option value="zelle">Zelle</option><option value="bank_transfer">Bank Transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option>
          </select>
        )}
        <input className="ops-input" aria-label="Transaction date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="ops-input" aria-label="Transaction reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction reference" />
        <input className="ops-input" aria-label="Transaction reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === "payment" ? "Note (optional)" : "Reason"} />
        <label className="ops-upload ops-receipt-drop">
          <input type="file" accept="image/*,application/pdf" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void handleReceipt(file); }} />
          <span className="ops-receipt-icon" aria-hidden="true">⇧</span>
          <span className="ops-receipt-copy"><strong>{receiptName ?? "Attach receipt"}</strong><small>Image or PDF · max 4 MB</small></span>
        </label>
        <button type="button" className="ops-primary-button" onClick={record} disabled={busy}>{busy ? "Recording…" : `Record ${type}`}</button>
      </div>
      {message && <span className="ops-success" role="status">{message}</span>}
      {error && <span className="ops-inline-error" role="alert">{error}</span>}
    </div>
  );
}

function CommissionControl({ row }: { row: AccountingRow }) {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!row.commission_id || !row.commission_status) return <span className="text-xs text-slate-500">No commission generated</span>;

  async function change(status: "approved" | "paid" | "cancelled" | "reversed") {
    setBusy(true); setError(null);
    try {
      await postAccounting({ operation: "update_commission", commission_id: row.commission_id, status, payment_reference: reference.trim() || null, reason: reason.trim() || null });
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update commission"); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase text-slate-300">{row.commission_status}</span>
      <strong className="text-sm">{money(row.commission_amount)}</strong>
      {row.commission_status === "eligible" && <button className="ops-primary-button" disabled={busy} onClick={() => void change("approved")}>Approve</button>}
      {row.commission_status === "approved" && <><input className="ops-input" aria-label="Commission payment reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Payment reference" /><button className="ops-primary-button" disabled={busy} onClick={() => void change("paid")}>Mark paid</button></>}
      {(row.commission_status === "eligible" || row.commission_status === "approved") && <><input className="ops-input" aria-label="Commission cancellation reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cancellation reason" /><button className="ops-secondary-button" disabled={busy} onClick={() => void change("cancelled")}>Cancel</button></>}
      {row.commission_status === "paid" && <><input className="ops-input" aria-label="Commission reversal reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reversal reason" /><button className="ops-secondary-button" disabled={busy} onClick={() => void change("reversed")}>Reverse</button></>}
      {error && <span className="ops-inline-error" role="alert">{error}</span>}
    </div>
  );
}

export function AccountingBoard({ rows, staff }: { rows: AccountingRow[]; staff: OperationsStaff[] }) {
  const [status, setStatus] = useState("all");
  const [staffId, setStaffId] = useState("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== "all" && row.payment_status !== status) return false;
      if (staffId !== "all" && row.assigned_staff !== staffId && row.commission_staff_id !== staffId) return false;
      if (!term) return true;
      return [row.full_name, row.ref, row.phone, row.email ?? "", row.site_code ?? "", row.site_name ?? ""]
        .some((value) => value.toLowerCase().includes(term));
    });
  }, [rows, status, staffId, q]);

  const totals = useMemo(() => ({
    outstanding: filtered.reduce((n, r) => n + Math.max(0, r.balance), 0),
    paid: filtered.reduce((n, r) => n + r.amount_paid, 0),
    refunded: filtered.reduce((n, r) => n + r.refund_amount, 0),
    commissions: filtered.filter((r) => r.commission_status && !["cancelled", "reversed"].includes(r.commission_status)).reduce((n, r) => n + r.commission_amount, 0),
  }), [filtered]);

  return (
    <div className="ops-page">
      <header className="ops-hero"><div><p className="ops-kicker">CAREER GATE · ACCOUNTS</p><h1>Accounts & Commissions</h1><p>Immutable transaction ledger, derived balances, and auditable commissions.</p></div></header>
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
        </div>

        <div className="ops-account-list">
          {filtered.map((row) => (
            <article key={row.account_id} className="ops-account-row" data-testid="account-row">
              <div className="ops-account-main">
                <div><Link href={`/staff/client/${row.client_id}`} className="ops-account-name">{row.full_name}</Link><code>{row.ref}</code></div>
                <div><span>Status</span><strong className="capitalize">{row.payment_status.replace("_", " ")}</strong></div>
                <div><span>Fee</span><strong>{money(row.fee_amount)}</strong></div>
                <div><span>Paid</span><strong>{money(row.amount_paid)}</strong></div>
                <div><span>Refunded</span><strong>{money(row.refund_amount)}</strong></div>
                <div><span>Balance</span><strong>{money(row.balance)}</strong></div>
                <div><span>Staff</span><strong>{row.staff_code ?? "—"} · {row.assigned_name ?? "Unassigned"}</strong></div>
              </div>
              <AccountEditor row={row} />
              <div className="mt-3 border-t border-white/5 pt-3"><p className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">Commission</p><CommissionControl row={row} /></div>
              <details className="mt-3 border-t border-white/5 pt-3">
                <summary className="cursor-pointer text-xs text-slate-400">Ledger · {row.transactions.length} transaction{row.transactions.length === 1 ? "" : "s"}</summary>
                <div className="mt-2 space-y-2">
                  {row.transactions.map((tx) => <div key={tx.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-white/[.02] px-3 py-2 text-xs" data-testid="ledger-transaction"><strong className="capitalize">{tx.transaction_type}</strong><span>{tx.direction === "credit" ? "+" : "−"}{money(tx.amount)}</span><span>{tx.status}</span><span className="text-slate-500">{new Date(tx.occurred_at).toLocaleDateString()}</span>{tx.transaction_reference && <code>{tx.transaction_reference}</code>}{tx.recorded_by_name && <span className="text-slate-500">by {tx.recorded_by_name}</span>}</div>)}
                  {!row.transactions.length && <p className="text-xs text-slate-500">No transactions recorded.</p>}
                </div>
              </details>
            </article>
          ))}
          {!filtered.length && <div className="ops-empty-large">No accounts match this filter.</div>}
        </div>
      </section>
    </div>
  );
}
