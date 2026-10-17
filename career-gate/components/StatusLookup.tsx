"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

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
    try { const res = await fetch("/api/status/lookup", {
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
    } catch { setPending(false); setError("Unable to connect. Please try again shortly. / تعذر الاتصال، يرجى المحاولة مجددًا."); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setPending(true);
    setError(null);
    try { const res = await fetch("/api/status/verify", {
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
    const action=params.get("appointment_action");
    const suffix=action&&["confirm","reschedule","cancel"].includes(action)?`?appointment_action=${action}`:"";
    router.push(`/status/${encodeURIComponent(String(data.ref))}${suffix}`);
    router.refresh();
    } catch { setPending(false); setError("Verification service is temporarily unavailable. / خدمة التحقق غير متاحة مؤقتًا."); }
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
      <section className="overflow-hidden rounded-[26px] border border-[#C5A059]/35 bg-white/[.10] p-5 shadow-[0_24px_60px_rgba(0,0,0,.26)] backdrop-blur-xl sm:p-8">
        <form className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={start}>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-100" htmlFor="identifier">File number, phone or email</label>
            <input
              id="identifier"
              required
              className="h-14 w-full min-w-0 rounded-xl border border-white/30 bg-[#06162c]/80 px-4 text-base text-white outline-none placeholder:text-slate-400 focus:border-[#E6C585] focus:ring-2 focus:ring-[#C5A059]/30"
              value={identifier}
              onChange={(e) => changeIdentifier(e.target.value)}
              autoComplete="off"
              placeholder="CG-2026-000001, phone or email"
            />
          </div>
          <button type="submit" disabled={pending} className="min-h-14 w-full rounded-xl border border-[#E8C987]/40 bg-gradient-to-r from-[#C5A059] to-[#F0D18E] px-6 py-3 text-sm font-extrabold text-[#07152b] shadow-lg transition hover:brightness-110 disabled:opacity-60 sm:w-auto">{pending && !challengeId ? "Sending…" : challengeId ? "Send New Code" : "Check Status"}</button>
        </form>
        <p className="mt-4 text-sm leading-6 text-slate-300">For your privacy, we send a one-time verification code to the contact information registered with your file.</p>
        {message && <p className="mt-4 rounded-xl border border-sky-300/25 bg-sky-300/10 p-3 text-sm font-medium text-sky-100" role="status">{message}</p>}
        {error && <p role="alert" className="mt-4 rounded-xl border border-rose-300/35 bg-rose-900/35 p-3 text-sm font-semibold text-rose-100">{error}</p>}

        {challengeId && (
          <form className="mt-6 border-t border-white/20 pt-5" onSubmit={verify}>
            <label className="label" htmlFor="status-code">Verification code</label>
            <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                id="status-code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                className="h-14 w-full min-w-0 rounded-xl border border-white/30 bg-[#06162c]/80 px-4 text-center text-lg tracking-[.25em] text-white outline-none focus:border-[#E6C585]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
              />
              <button type="submit" disabled={pending || code.length !== 6} className="min-h-14 rounded-xl bg-gradient-to-r from-[#C5A059] to-[#F0D18E] px-5 py-3 font-bold text-[#07152b] disabled:opacity-60">{pending ? "Verifying…" : "Verify & View Status"}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
