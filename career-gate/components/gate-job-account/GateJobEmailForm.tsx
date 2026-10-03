"use client";

import { useState, type FormEvent } from "react";

export function GateJobEmailForm({ endpoint = "/api/staff/gate-job-account/emails", onSuccess, submitLabel = "SAVE ✦" }: {
  endpoint?: string;
  onSuccess: (record: { id: string; email: string; status: string }) => void;
  submitLabel?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, pin }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? "Unable to add Gate Job email");
      onSuccess(data.email);
      setEmail(""); setPassword(""); setPin("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add Gate Job email");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <label className="block text-xs text-slate-300">Email
        <input className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-amber-300/40" type="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block text-xs text-slate-300">Password
        <input className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-amber-300/40" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className="block text-xs text-slate-300">PIN
        <input className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-amber-300/40" type="password" inputMode="numeric" pattern="\d{4,12}" autoComplete="off" required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))} />
      </label>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-xl border border-amber-200/30 bg-gradient-to-r from-amber-500/90 to-yellow-300/85 px-4 py-2.5 text-sm font-bold text-[#171006] shadow-[0_0_22px_rgba(251,191,36,.12)] transition hover:-translate-y-px active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? "SAVING…" : submitLabel}
      </button>
    </form>
  );
}
