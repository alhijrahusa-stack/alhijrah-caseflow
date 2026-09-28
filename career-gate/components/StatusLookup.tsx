"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function StatusLookup() {
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState(params.get("ref") ?? "");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/status/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });
    const data = await res.json().catch(() => null);
    setPending(false);
    if (!data?.ok) {
      setError(data?.error?.message ?? `Request failed (${res.status})`);
      return;
    }
    setChallengeId(data.challenge_id as string);
    setMessage(data.message as string);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setPending(true);
    setError(null);
    const res = await fetch("/api/status/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge_id: challengeId, code }),
    });
    const data = await res.json().catch(() => null);
    setPending(false);
    if (!data?.ok) {
      setError(data?.error?.message ?? `Verification failed (${res.status})`);
      return;
    }
    window.location.assign(`/status/${encodeURIComponent(data.ref as string)}`);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        {!challengeId ? (
          <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={requestCode}>
            <div>
              <label className="label" htmlFor="identifier">File number, phone or email</label>
              <input
                id="identifier"
                required
                className="input h-11"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="off"
                placeholder="CG-2026-000001, phone or email"
              />
            </div>
            <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send Verification Code"}</Button>
          </form>
        ) : (
          <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={verify}>
            <div>
              <label className="label" htmlFor="status_code">6-digit verification code</label>
              <input
                id="status_code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                className="input h-11 tracking-[.35em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
              />
            </div>
            <Button type="submit" disabled={pending || code.length !== 6}>{pending ? "Verifying…" : "Verify & View Status"}</Button>
            <button
              type="button"
              className="text-left text-xs font-medium text-brand-700 underline sm:col-span-2"
              onClick={() => { setChallengeId(null); setCode(""); setError(null); setMessage(null); }}
            >
              Use different information
            </button>
          </form>
        )}
        <p className="mt-3 text-xs text-slate-500">For your privacy, status details are available only after verification using the contact information already on file.</p>
        {message && <p className="mt-3 text-sm text-slate-700" data-testid="status-lookup-message">{message}</p>}
        {error && <p role="alert" className="mt-3 text-sm font-medium text-red-600">{error}</p>}
      </section>
    </div>
  );
}
