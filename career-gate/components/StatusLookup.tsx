"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function StatusLookup() {
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState(params.get("ref") ?? "");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const secondsLeft = expiresAt === null ? 0 : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const remaining = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;

  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    // Keep any still-valid challenge visible until a replacement succeeds.
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
    setExpiresAt(Date.now() + 300_000);
    setNow(Date.now());
    setCode("");
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
    setExpiresAt(null);
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
            <label className="mb-2 block text-sm font-semibold text-[#F0D18E]" htmlFor="status-code">Verification code</label>\n            <p className="mb-2 text-xs text-slate-300">Enter the 6-digit code sent to your registered contact / أدخل رمز التحقق المرسل إليك</p>
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
              <button type="submit" disabled={pending || code.length !== 6 || secondsLeft === 0} className="min-h-14 rounded-xl bg-gradient-to-r from-[#C5A059] to-[#F0D18E] px-5 py-3 font-bold text-[#07152b] disabled:opacity-60">{pending ? "Verifying…" : "Verify & View Status"}</button>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#C5A059]/30 bg-[#06162c]/55 px-4 py-3" role="timer" aria-live="off">
              <span className="text-sm text-slate-200">Code validity / صلاحية الرمز</span>
              <span className={`font-mono text-lg font-bold tabular-nums ${secondsLeft > 60 ? "text-[#F0D18E]" : "text-rose-200"}`}>{remaining}</span>
            </div>
            {secondsLeft === 0 && <p className="mt-2 text-sm text-amber-200" role="status">Code expired. Select Send New Code above. / انتهت صلاحية الرمز، اطلب رمزًا جديدًا من الأعلى.</p>}
          </form>
        )}
      </section>
    </div>
  );
}
