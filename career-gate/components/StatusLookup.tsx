"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

/** Reference / phone / email → one-time code → secure session. */
export function StatusLookup() {
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState(params.get("ref") ?? "");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(url: string, body: unknown) {
    setPending(true);
    setError(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    setPending(false);
    if (!data?.ok) {
      setError(data?.error?.message ?? `Request failed (${res.status})`);
      return null;
    }
    return data;
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
      {!challenge ? (
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const d = await post("/api/status/lookup", { identifier });
          if (d) { setChallenge(d.challenge_id); setMessage(d.message); }
        }}>
          <div>
            <label className="label" htmlFor="identifier">Reference (CG-…), phone or email</label>
            <input id="identifier" required className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="off" />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send me a code"}</Button>
        </form>
      ) : (
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const d = await post("/api/status/verify", { challenge_id: challenge, code });
          if (d) router.push(`/status/${d.ref}`);
        }}>
          <p className="text-sm text-slate-600" data-testid="lookup-message">{message}</p>
          <div>
            <label className="label" htmlFor="otp">6-digit code</label>
            <input id="otp" inputMode="numeric" pattern="\d{6}" maxLength={6} required className="input tracking-widest" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>{pending ? "Checking…" : "View status"}</Button>
            <Button variant="ghost" onClick={() => { setChallenge(null); setCode(""); setError(null); }}>Start over</Button>
          </div>
          <p className="text-xs text-slate-500">Codes expire after 5 minutes. After 3 wrong codes, wait 15 minutes. No code? Contact the office.</p>
        </form>
      )}
    </section>
  );
}
