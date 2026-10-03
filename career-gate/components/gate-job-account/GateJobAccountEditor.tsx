"use client";

import { useState, type FormEvent } from "react";

export function GateJobAccountEditor({ account, onDone, onCancel }: {
  account: { id: string; email_snapshot: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState(account.email_snapshot);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(null);
    try {
      const body: Record<string, string> = { account_id: account.id, email };
      if (password) body.password = password;
      if (pin) body.pin = pin;
      const response = await fetch("/api/staff/gate-job-account/accounts/update", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? "Unable to update Gate Job account");
      setPassword(""); setPin(""); onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update Gate Job account");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-xs text-slate-300">Email Account
        <input className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-amber-300/40" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block text-xs text-slate-300">New Password <span className="text-slate-600">(leave blank to keep current)</span>
        <input className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-amber-300/40" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className="block text-xs text-slate-300">New PIN <span className="text-slate-600">(leave blank to keep current)</span>
        <input className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-amber-300/40" type="password" inputMode="numeric" pattern="\d{4,12}" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))} />
      </label>
      {error && <p className="text-xs text-red-300" role="alert">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={pending} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300">Cancel</button>
        <button type="submit" disabled={pending} className="rounded-xl border border-amber-200/30 bg-gradient-to-r from-amber-500/90 to-yellow-300/85 px-4 py-2 text-xs font-bold text-[#171006] disabled:opacity-50">{pending ? "UPDATING…" : "UPDATE ACCOUNT ✦"}</button>
      </div>
    </form>
  );
}
