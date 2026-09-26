"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { dateTime, money } from "@/lib/format";
import type { PaymentRow } from "@/lib/types";
import { useApi } from "./useApi";

const METHODS = ["cash", "card", "zelle", "check", "other"] as const;

export function PaymentPanel({ clientId, payments }: { clientId: string; payments: PaymentRow[] }) {
  const { call, pending, error, setError } = useApi();
  const total = payments.filter((p) => p.status === "received").reduce((s, p) => s + p.amount_cents, 0);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    const dollars = Number(f.get("amount"));
    if (!Number.isFinite(dollars) || dollars <= 0) return setError("Enter an amount greater than zero");
    const ok = await call("/api/payments", "POST", {
      clientId,
      amountCents: Math.round(dollars * 100),
      method: f.get("method"),
      reference: String(f.get("reference") || "") || undefined,
    });
    if (ok) formEl.reset();
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card title={`Payments · ${money(total)} received`} className="md:col-span-2">
        {payments.length ? (
          <table className="table">
            <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Ref</th><th>Status</th><th /></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className={p.status !== "received" ? "text-slate-400 line-through" : ""}>
                  <td className="whitespace-nowrap">{dateTime(p.received_at)}</td>
                  <td>{money(p.amount_cents)}</td>
                  <td className="capitalize">{p.method}</td>
                  <td>{p.reference ?? "—"}</td>
                  <td className="capitalize">{p.status}</td>
                  <td>
                    {p.status === "received" && (
                      <Button variant="ghost" className="px-2 py-1 text-xs" disabled={pending}
                        onClick={() => confirm("Void this payment? (admin only)") && call("/api/payments", "PATCH", { id: p.id, status: "void" })}>
                        Void
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">No payments recorded.</p>
        )}
      </Card>

      <Card title="Record payment">
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="label" htmlFor="amount">Amount (USD)</label>
            <input id="amount" name="amount" inputMode="decimal" className="input" required />
          </div>
          <div>
            <label className="label" htmlFor="method">Method</label>
            <select id="method" name="method" className="input">
              {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="reference">Reference</label>
            <input id="reference" name="reference" className="input" />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={pending}>Record</Button>
        </form>
      </Card>
    </div>
  );
}
