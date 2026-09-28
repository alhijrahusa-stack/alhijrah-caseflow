"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountingRow, OperationsStaff } from "@/lib/operations";

type PaymentStatus = "pending" | "paid" | "refunded";
type PaymentMethod = "zelle" | "bank_transfer" | "cash" | "card";

async function postOperation(body: Record<string, unknown>) {
  const res = await fetch("/api/staff/operations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data;
}

function AccountEditor({ row }: { row: AccountingRow }) {
  const router = useRouter();
  const [status, setStatus] = useState<PaymentStatus>(row.payment_status);
  const [method, setMethod] = useState<PaymentMethod | "">(row.payment_method ?? "");
  const [date, setDate] = useState(row.payment_date ?? "");
  const [receiptId, setReceiptId] = useState(row.receipt_document_id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    const form = new FormData();
    form.set("client_id", row.client_id);
    form.set("doc_type", "other");
    form.set("file", file);
    const res = await fetch("/api/staff/documents", { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Upload failed (${res.status})`);
    setReceiptId(String(data.id));
    setMessage("Receipt attached");
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await postOperation({
        operation: "update_payment",
        client_id: row.client_id,
        payment_status: status,
        payment_method: method || null,
        payment_date: date || null,
        receipt_document_id: receiptId || null,
      });
      setMessage("Saved");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ops-account-editor">
      <select className="ops-select" value={status} onChange={(e) => setStatus(e.target.value as PaymentStatus)}>
        <option value="pending">Pending</option>
        <option value="paid">Paid</option>
        <option value="refunded">Refunded</option>
      </select>
      <select className="ops-select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | "")}>
        <option value="">Payment method</option>
        <option value="zelle">Zelle</option>
        <option value="bank_transfer">Bank Transfer</option>
        <option value="cash">Cash</option>
        <option value="card">Card</option>
      </select>
      <input className="ops-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <label className="ops-upload">
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(null);
            try { await upload(file); } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); }
            finally { setBusy(false); }
          }}
        />
        {receiptId ? "Receipt attached" : "Attach receipt"}
      </label>
      <button type="button" className="ops-primary-button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      {message && <span className="ops-success">{message}</span>}
      {error && <span className="ops-inline-error">{error}</span>}
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
    pending: filtered.filter((r) => r.payment_status === "pending").length,
    paid: filtered.filter((r) => r.payment_status === "paid").reduce((n, r) => n + r.fee_amount, 0),
    refunded: filtered.filter((r) => r.payment_status === "refunded").reduce((n, r) => n + r.fee_amount, 0),
    commissions: filtered.filter((r) => r.payment_status === "paid").reduce((n, r) => n + r.commission_amount, 0),
  }), [filtered]);

  return (
    <div className="ops-page">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · ACCOUNTING</p>
          <h1>Accounting & Commissions</h1>
          <p>سجل مبسط مرتبط مباشرة بملف العميل وموظف المتابعة</p>
        </div>
      </header>

      <div className="ops-metric-grid">
        <div className="ops-metric"><span>Pending</span><strong>{totals.pending}</strong></div>
        <div className="ops-metric"><span>Paid</span><strong>${totals.paid.toFixed(2)}</strong></div>
        <div className="ops-metric"><span>Refunded</span><strong>${totals.refunded.toFixed(2)}</strong></div>
        <div className="ops-metric"><span>Commissions</span><strong>${totals.commissions.toFixed(2)}</strong></div>
      </div>

      <section className="ops-glass-card">
        <div className="ops-toolbar">
          <input className="ops-input ops-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email, file or site" />
          <select className="ops-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All payments</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="refunded">Refunded</option>
          </select>
          <select className="ops-select" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="all">All staff</option>
            {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.staff_code ?? "—"} · {s.display_name}</option>)}
          </select>
        </div>

        <div className="ops-account-list">
          {filtered.map((row) => (
            <article key={row.account_id} className="ops-account-row">
              <div className="ops-account-main">
                <div>
                  <Link href={`/staff/client/${row.client_id}`} className="ops-account-name">{row.full_name}</Link>
                  <code>{row.ref}</code>
                </div>
                <div><span>Phone</span><strong>{row.phone}</strong></div>
                <div><span>Branch</span><strong>{row.site_code ?? row.site_name ?? "—"}</strong></div>
                <div><span>Fee</span><strong>${row.fee_amount.toFixed(2)}</strong></div>
                <div><span>Staff</span><strong>{row.staff_code ?? "—"} · {row.assigned_name ?? "Unassigned"}</strong></div>
                <div><span>Commission</span><strong>${row.commission_amount.toFixed(2)}</strong></div>
              </div>
              <AccountEditor row={row} />
            </article>
          ))}
          {!filtered.length && <div className="ops-empty-large">No accounting records match this filter.</div>}
        </div>
      </section>
    </div>
  );
}
