"use client";

import { useRouter } from "next/navigation";
import { startTransition, useRef, useState } from "react";
import { publishMutation } from "@/components/staff/realtime/update-bus";
import { useToast } from "@/components/ui/Toast";

type Ok = { ok: true; client_id?: string | null; [k: string]: unknown };
type Fail = { ok: false; error: { code: string; message: string } };

/**
 * Posts to /api/staff/action. Success is shown only after the server
 * confirms; failures keep a persistent inline error and raise a toast.
 *
 * On success the affected resources are published on the targeted update path,
 * scoped to the client the server resolved. `router.refresh()` runs only as
 * the recovery fallback, when no mounted surface owns those resources or the
 * mutation is not in the resource graph.
 */
export function useAction(opts: { successMessage?: string | null } = {}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flight = useRef<{ signature: string; promise: Promise<Ok | null> } | null>(null);
  const retry = useRef<{ signature: string; operationId: string } | null>(null);

  function run(payload: Record<string, unknown>, success = opts.successMessage): Promise<Ok | null> {
    const signature = JSON.stringify(payload);
    if (flight.current) return flight.current.signature === signature ? flight.current.promise : Promise.resolve(null);
    if (retry.current?.signature !== signature) retry.current = { signature, operationId: typeof payload.operation_id === "string" ? payload.operation_id : crypto.randomUUID() };
    const promise = execute({ ...payload, operation_id: retry.current.operationId }, success);
    flight.current = { signature, promise };
    void promise.finally(() => { if (flight.current?.promise === promise) flight.current = null; });
    return promise;
  }

  async function execute(payload: Record<string, unknown>, success = opts.successMessage): Promise<Ok | null> {
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
      retry.current = null;
      if (success !== null) toast("success", success ?? "Saved");
      const clientId = typeof data.client_id === "string"
        ? data.client_id
        : typeof payload.client_id === "string"
          ? payload.client_id
          : null;
      if (publishMutation(String(payload.action ?? ""), clientId) !== null) {
        startTransition(() => { router.refresh(); });
      }
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
