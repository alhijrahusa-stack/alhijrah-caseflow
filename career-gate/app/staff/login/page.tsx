"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/Button";
import { OFFICE } from "@/lib/office";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
    <main className="mx-auto max-w-sm px-4 py-16">
      <p className="text-sm font-semibold text-brand-700">{OFFICE.product}</p>
      <h1 className="mb-6 text-xl font-semibold">Staff sign in</h1>
      {step === "email" ? (
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          const d = await post("/api/staff/auth/login", { email });
          if (d) { setInfo(d.message); setStep("code"); }
        }}>
          <div>
            <label className="label" htmlFor="email">Work email</label>
            <input id="email" type="email" required className="input" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={pending} className="w-full">{pending ? "Sending…" : "Send sign-in code"}</Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          const d = await post("/api/staff/auth/verify", { email, code });
          if (d) {
            const next = params.get("next");
            window.location.href = next && next.startsWith("/staff") && !next.startsWith("//") ? next : "/staff";
          }
        }}>
          {info && <p className="text-sm text-slate-600">{info}</p>}
          <div>
            <label className="label" htmlFor="code">6-digit code</label>
            <input id="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required className="input tracking-widest" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={pending} className="w-full">{pending ? "Checking…" : "Sign in"}</Button>
          <button type="button" className="text-sm text-slate-500 hover:underline" onClick={() => { setStep("email"); setCode(""); }}>Use a different email</button>
        </form>
      )}
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
