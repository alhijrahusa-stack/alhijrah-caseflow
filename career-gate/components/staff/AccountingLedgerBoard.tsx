"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountLedgerRow, LedgerEntry } from "@/lib/finance";
import { DOC_MAX_BYTES } from "@/lib/domain";

type Mode = "payment" | "refund" | "adjustment" | "waiver";
type Method = "zelle" | "bank_transfer" | "cash" | "card" | "other";

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function statusClass(status: AccountLedgerRow["payment_status"]) {
  if (status === "paid") return "border-emerald-400/25 bg-emerald-400/[.08] text-emerald-300";
  if (status === "refunded") return "border-cyan-400/25 bg-cyan-400/[.08] text-cyan-300";
  if (status === "overdue") return "border-red-400/25 bg-red-400/[.08] text-red-300";
  return "border-amber-400/25 bg-amber-400/[.08] text-amber-300";
}

function LedgerActions({ row }: { row: AccountLedgerRow }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("payment");
  const [amount, setAmount] = useState(row.balance > 0 ? row.balance.toFixed(2) : "");
  const [method, setMethod] = useState<Method>("zelle");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [direction, setDirection] = useState<"debit" | "credit">("credit");
  const [relatedId, setRelatedId] = useState("");
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  const resetKey = () => setRequestKey(crypto.randomUUID());
  const payments = (entries ?? []).filter((e) => e.transaction_type === "payment");

  async function loadHistory() {
    setError(null);
    const res = await fetch(`/api/staff/finance?client_id=${encodeURIComponent(row.client_id)}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Unable to load ledger (${res.status})`);
    setEntries(data.entries ?? data.data?.entries ?? []);
  }

  async function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next && !entries) {
      try { await loadHistory(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load ledger"); }
    }
  }

  async function chooseMode(next: Mode) {
    setMode(next);
    setMessage(null);
    setError(null);
    setRelatedId("");
    resetKey();
    if (next === "refund" && !entries) {
      try { await loadHistory(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load ledger"); }
    }
  }

  async function uploadReceipt(file?: File) {
    if (!file) return;
    if (file.size > DOC_MAX_BYTES) { setError("Receipt is larger than 4 MB"); return; }
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") { setError("Receipt must be an image or PDF"); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      const form = new FormData();
      form.set("client_id", row.client_id);
      form.set("doc_type", "other");
      form.set("file", file);
      const res = await fetch("/api/staff/documents", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Upload failed (${res.status})`);
      setReceiptId(String(data.id));
      setReceiptName(file.name);
      resetKey();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Receipt upload failed");
    } finally { setBusy(false); }
  }

  async function submit() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { setError("Enter an amount greater than zero"); return; }
    if ((mode === "refund" || mode === "adjustment" || mode === "waiver") && !note.trim()) {
      setError("A reason is required for this transaction"); return;
    }
    if (mode === "refund" && !relatedId) { setError("Select the payment being refunded"); return; }

    setBusy(true); setError(null); setMessage(null);
    try {
      const occurred_at = new Date().toISOString();
      const body = mode === "payment"
        ? { operation: "record_payment", client_id: row.client_id, amount: n, payment_method: method, transaction_reference: reference || null, receipt_document_id: receiptId, occurred_at, note: note || null }
        : mode === "refund"
          ? { operation: "record_refund", client_id: row.client_id, amount: n, related_transaction_id: relatedId, transaction_reference: reference || null, occurred_at, note }
          : mode === "adjustment"
            ? { operation: "record_adjustment", client_id: row.client_id, direction, amount: n, occurred_at, note }
            : { operation: "record_waiver", client_id: row.client_id, amount: n, occurred_at, note };
      const res = await fetch("/api/staff/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Financial operation failed (${res.status})`);
      setMessage(data.idempotent ? "Already recorded — no duplicate created" : "Recorded in ledger");
      setEntries(null);
      setRequestKey(crypto.randomUUID());
      setReceiptId(null); setReceiptName(null); setReference(""); setNote(""); setRelatedId("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Financial operation failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 border-t border-white/[.06] pt-3">
      <div className="flex flex-wrap gap-2">
        {(["payment", "refund", "adjustment", "waiver"] as Mode[]).map((m) => (
          <button key={m} type="button" onClick={() => void chooseMode(m)}
            className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold capitalize ${mode === m ? "border-cyan-400/40 bg-cyan-400/[.09] text-cyan-200" : "border-white/10 text-slate-400"}`}>
            {m}
          </button>
        ))}
        <button type="button" onClick={() => void toggleHistory()} className="ml-auto rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] text-slate-400">
          {showHistory ? "Hide Ledger" : "View Ledger"}
        </button>
      </div>

      <div className="grid gap-2 lg:grid-cols-4">
        <input className="ops-input" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); resetKey(); }} placeholder="Amount" />
        {mode === "payment" && (
          <select className="ops-select" value={method} onChange={(e) => { setMethod(e.target.value as Method); resetKey(); }}>
            <option value="zelle">Zelle</option><option value="bank_transfer">Bank Transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option>
          </select>
        )}
        {mode === "adjustment" && (
          <select className="ops-select" value={direction} onChange={(e) => { setDirection(e.target.value as "debit" | "credit"); resetKey(); }}>
            <option value="credit">Credit</option><option value="debit">Debit</option>
          </select>
        )}
        {mode === "refund" && (
          <select className="ops-select" value={relatedId} onChange={(e) => { setRelatedId(e.target.value); resetKey(); }}>
            <option value="">Payment to refund</option>
            {payments.map((p) => <option key={p.id} value={p.id}>{money(p.amount)} · {new Date(p.occurred_at).toLocaleDateString()}</option>)}
          </select>
        )}
        {(mode === "payment" || mode === "refund") && <input className="ops-input" value={reference} onChange={(e) => { setReference(e.target.value); resetKey(); }} placeholder="Transaction reference" />}
        <input className="ops-input" value={note} onChange={(e) => { setNote(e.target.value); resetKey(); }} placeholder={mode === "payment" ? "Note (optional)" : "Reason / note"} />
      </div>

      {mode === "payment" && (
        <label className="ops-upload ops-receipt-drop">
          <input type="file" accept="image/*,application/pdf" disabled={busy} onChange={(e) => { const f=e.target.files?.[0]; e.target.value=""; void uploadReceipt(f); }} />
          <span className="ops-receipt-icon" aria-hidden="true">⇧</span>
          <span className="ops-receipt-copy"><strong>{receiptName ?? "Attach receipt (optional)"}</strong><small>Image or PDF · max 4 MB</small></span>
        </label>
      )}

      <div className="flex items-center gap-3">
        <button type="button" className="ops-primary-button" disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : `Record ${mode}`}</button>
        {message && <span className="ops-success">{message}</span>}
        {error && <span className="ops-inline-error">{error}</span>}
      </div>

      {showHistory && (
        <div className="overflow-x-auto rounded-xl border border-white/[.06] bg-black/10">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="text-slate-500"><tr><th className="p-2">Date</th><th>Type</th><th>Amount</th><th>Method</th><th>Reference</th><th>Recorded By</th><th>Note</th></tr></thead>
            <tbody>
              {(entries ?? []).map((e) => <tr key={e.id} className="border-t border-white/[.05]"><td className="p-2">{new Date(e.occurred_at).toLocaleString()}</td><td className="capitalize">{e.transaction_type.replace(/_/g," ")}</td><td>{money(e.amount)}</td><td>{e.payment_method ?? "—"}</td><td>{e.transaction_reference ?? "—"}</td><td>{e.recorded_by_name ?? e.source}</td><td>{e.note ?? "—"}</td></tr>)}
              {entries?.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-500">No ledger entries.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AccountingLedgerBoard({ rows }: { rows: AccountLedgerRow[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => (status === "all" || r.payment_status === status) && (!term || [r.full_name,r.ref,r.phone,r.email ?? "",r.site_code ?? "",r.site_name ?? ""].some((v) => v.toLowerCase().includes(term))));
  }, [rows,q,status]);
  const totals = useMemo(() => ({
    charged: filtered.reduce((n,r) => n+r.total_charged,0),
    paid: filtered.reduce((n,r) => n+r.total_paid,0),
    refunded: filtered.reduce((n,r) => n+r.total_refunded,0),
    balance: filtered.reduce((n,r) => n+r.balance,0),
  }), [filtered]);

  return (
    <div className="ops-page">
      <header className="ops-hero"><div><p className="ops-kicker">CAREER GATE · ACCOUNTS</p><h1>Accounts & Payment Ledger</h1><p>Immutable transactions, derived balances, refunds and adjustments.</p></div></header>
      <div className="ops-metric-grid">
        <div className="ops-metric"><span>Charged</span><strong>{money(totals.charged)}</strong></div>
        <div className="ops-metric"><span>Received</span><strong>{money(totals.paid)}</strong></div>
        <div className="ops-metric"><span>Refunded</span><strong>{money(totals.refunded)}</strong></div>
        <div className="ops-metric"><span>Outstanding</span><strong>{money(totals.balance)}</strong></div>
      </div>
      <section className="ops-glass-card">
        <div className="ops-toolbar">
          <input className="ops-input ops-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email, file or site" />
          <select className="ops-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All accounts</option><option value="unpaid">Unpaid</option><option value="partially_paid">Partially Paid</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="refunded">Refunded</option>
          </select>
        </div>
        <div className="ops-account-list">
          {filtered.map((row) => (
            <article key={row.account_id} className="ops-account-row">
              <div className="ops-account-main">
                <div><Link href={`/staff/client/${row.client_id}`} className="ops-account-name">{row.full_name}</Link><code>{row.ref}</code></div>
                <div><span>Status</span><strong className={`rounded-full border px-2 py-1 text-[9px] capitalize ${statusClass(row.payment_status)}`}>{row.payment_status.replace(/_/g," ")}</strong></div>
                <div><span>Charged</span><strong>{money(row.total_charged)}</strong></div>
                <div><span>Paid</span><strong>{money(row.total_paid)}</strong></div>
                <div><span>Balance</span><strong>{money(row.balance)}</strong></div>
                <div><span>Staff</span><strong>{row.staff_code ?? "—"} · {row.assigned_name ?? "Unassigned"}</strong></div>
              </div>
              <LedgerActions row={row} />
            </article>
          ))}
          {!filtered.length && <div className="ops-empty-large">No accounts match this filter.</div>}
        </div>
      </section>
    </div>
  );
}
