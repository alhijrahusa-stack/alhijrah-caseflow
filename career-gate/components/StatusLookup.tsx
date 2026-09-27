"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

/** Direct public lookup by reference, phone or email. */
export function StatusLookup() {
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState(params.get("ref") ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const res = await fetch("/api/status/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier }),
        });
        const data = await res.json().catch(() => null);
        setPending(false);
        if (!res.ok || !data?.ok || !data?.ref) {
          setError(data?.error?.message ?? "No matching file was found.");
          return;
        }
        router.push(`/status/${encodeURIComponent(data.ref)}`);
      }}>
        <div>
          <label className="label" htmlFor="identifier">Case Number, phone or email</label>
          <input
            id="identifier"
            required
            className="input"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="off"
            placeholder="CG-2026-000001, phone or email"
          />
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={pending}>{pending ? "Checking…" : "View Status"}</Button>
        <p className="text-xs text-slate-500">Keep your case number and contact information private. Anyone with a matching identifier can view the public file status.</p>
      </form>
    </section>
  );
}
