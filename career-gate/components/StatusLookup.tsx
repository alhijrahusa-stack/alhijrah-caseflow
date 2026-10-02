"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function StatusLookup() {
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState(params.get("ref") ?? "");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    setChallengeId(null);
    setCode("");
    const res = await fetch("/api/status/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });
    const data = await res.json().catch(() => null);
    setPending(false);
    if (!data?.ok || !data?.challenge_id) {
      setError(data?.error?.message ?? `Request failed (${res.status})`);
      return;
    }
    setChallengeId(String(data.challenge_id));
    setMessage(String(data.message ?? "If the information matches a file, a verification code has been sent."));
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
    if (!data?.ok || !data?.ref) {
      setError(data?.error?.message ?? `Verification failed (${res.status})`);
      return;
    }
    router.push(`/status/${encodeURIComponent(String(data.ref))}`);
    router.refresh();
  }

  function changeIdentifier(value: string) {
    setIdentifier(value);
    setChallengeId(null);
    setCode("");
    setMessage(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={start}>
          <div>
            <label className="label" htmlFor="identifier">File number, phone or email</label>
            <input
              id="identifier"
              required
              className="input h-11"
              value={identifier}
              onChange={(e) => changeIdentifier(e.target.value)}
              autoComplete="off"
              placeholder="CG-2026-000001, phone or email"
            />
          </div>
          <Button type="submit" disabled={pending}>{pending && !challengeId ? "Sending…" : challengeId ? "Send New Code" : "Check Status"}</Button>
        </form>
        <p className="mt-3 text-xs text-slate-500">Status details require a one-time verification code sent to the contact information already on file.</p>
        {message && <p className="mt-3 text-sm font-medium text-slate-700" role="status">{message}</p>}
        {error && <p role="alert" className="mt-3 text-sm font-medium text-red-600">{error}</p>}

        {challengeId && (
          <form className="mt-5 border-t border-slate-200 pt-5" onSubmit={verify}>
            <label className="label" htmlFor="status-code">Verification code</label>
            <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                id="status-code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                className="input h-11 tracking-[0.25em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
              />
              <Button type="submit" disabled={pending || code.length !== 6}>{pending ? "Verifying…" : "Verify & View Status"}</Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
