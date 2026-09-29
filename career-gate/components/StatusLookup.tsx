"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { PublicStatusView } from "@/components/PublicStatusView";
import { Button } from "@/components/ui/Button";
import type { PublicStatus } from "@/lib/public-status";

/** Direct public lookup by file number, phone, or email. */
export function StatusLookup() {
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState(params.get("ref") ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicStatus | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);
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
    setResult(data.status as PublicStatus);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={submit}>
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
          <Button type="submit" disabled={pending}>{pending ? "Checking…" : "Check Status"}</Button>
        </form>
        <p className="mt-3 text-xs text-slate-500">Keep your file number and contact information private. Anyone with matching information can view this status page.</p>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-red-600">{error}</p>}
      </section>
      {result && <PublicStatusView s={result} />}
    </div>
  );
}
