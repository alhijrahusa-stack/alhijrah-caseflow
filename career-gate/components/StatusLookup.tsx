"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function StatusLookup() {
  const params = useSearchParams();
  const router = useRouter();
  const [identifier, setIdentifier] = useState(params.get("ref") ?? "");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function lookup(e: React.FormEvent) {
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
    if (!data?.ok || !data.challenge_id) {
      setError(data?.error?.message ?? `Request failed (${res.status})`);
      return;
    }
    setChallengeId(String(data.challenge_id));
    setMessage(String(data.message ?? "If a matching file was found, a verification code was sent to the contact information on file."));
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
    if (!data?.ok || !data.ref) {
      setError(data?.error?.message ?? `Verification failed (${res.status})`);
      return;
    }
    router.push(`/status/${encodeURIComponent(String(data.ref))}`);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        {!challengeId ? (
          <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={lookup}>
            <div>
              <label className="label" htmlFor="identifier">File number, phone or email</label>
              <input
                id="identifier"
                aria-label="File number, phone or email"
                required
                className="input h-11"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="off"
                placeholder="CG-2026-000001, phone or email"
              />
            </div>
            <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send verification code"}</Button>
          </form>
        ) : (
          <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={verify}>
            <div>
              <label className="label" htmlFor="status-code">Verification code</label>
              <input
                id="status-code"
                aria-label="Verification code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                className="input h-11 tracking-[.28em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
              />
            </div>
            <Button type="submit" disabled={pending || code.length !== 6}>{pending ? "Verifying…" : "Verify code"}</Button>
            <button
              type="button"
              className="text-sm font-medium text-slate-600 underline underline-offset-4 sm:col-span-2 sm:justify-self-start"
              onClick={() => { setChallengeId(null); setCode(""); setError(null); setMessage(null); }}
            >
              Use a different file number, phone or email
            </button>
          </form>
        )}
        <p className="mt-3 text-xs text-slate-500">Enter the file number, phone number, or email used on the application.</p>
        {message && <p data-testid="status-lookup-message" className="mt-3 text-sm font-medium text-slate-700">{message}</p>}
        {error && <p role="alert" className="mt-3 text-sm font-medium text-red-600">{error}</p>}
      </section>
    </div>
  );
}
