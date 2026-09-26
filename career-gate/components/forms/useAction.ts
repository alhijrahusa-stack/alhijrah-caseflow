"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Result = { ok: true; [k: string]: unknown } | { ok: false; error: { code: string; message: string } };

/** Posts to /api/staff/action; refreshes server data on success. */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(payload: Record<string, unknown>): Promise<Extract<Result, { ok: true }> | null> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as Result | null;
      if (!data) throw new Error(`Request failed (${res.status})`);
      if (!data.ok) throw new Error(data.error.message);
      router.refresh();
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return null;
    } finally {
      setPending(false);
    }
  }

  return { run, pending, error, setError };
}
