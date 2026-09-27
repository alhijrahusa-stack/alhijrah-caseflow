"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";

type Ok = { ok: true; [k: string]: unknown };
type Fail = { ok: false; error: { code: string; message: string } };

/**
 * Posts to /api/staff/action. Success is shown only after the server
 * confirms; failures keep a persistent inline error and raise a toast.
 */
export function useAction(opts: { successMessage?: string | null } = {}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(payload: Record<string, unknown>, success = opts.successMessage): Promise<Ok | null> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as Ok | Fail | null;
      if (!data) throw new Error(`Request failed (${res.status})`);
      if (!data.ok) throw new Error(data.error.message);
      if (success !== null) toast("success", success ?? "Saved");
      router.refresh();
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg);
      toast("error", msg);
      return null;
    } finally {
      setPending(false);
    }
  }

  return { run, pending, error, setError };
}
