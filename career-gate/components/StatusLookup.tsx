"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { PublicStatusView } from "@/components/PublicStatusView";
import type { PublicStatus } from "@/lib/public-status";

export function StatusLookup() {
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState(params.get("ref") ?? "");
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setStatus(null);
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
    setStatus(data.status as PublicStatus);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
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
          <Button type="submit" disabled={pending}>{pending ? "Checking…" : "Check Status"}</Button>
        </form>
        <p className="mt-3 text-xs text-slate-500">Enter the file number, phone number, or email used on the application.</p>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-red-600">{error}</p>}
      </section>
      {status && <PublicStatusView s={status} />}
    </div>
  );
}
