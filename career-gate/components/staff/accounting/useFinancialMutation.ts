"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drives one financial mutation safely.
 *
 * A financial write is not a render concern: it must happen once, its result
 * must come from the server, and a slow earlier response must never overwrite a
 * newer one. This hook owns those three rules so no surface reimplements them.
 *
 * When the outcome of a request is unknown — a timeout, an aborted connection, a
 * response that never arrived — it does NOT offer a retry. It asks the caller to
 * read the authoritative state first, because the write may already have
 * committed and a blind retry is how a payment gets recorded twice.
 */

export type MutationOutcome<T> =
  | { state: "idle" }
  | { state: "busy" }
  | { state: "done"; result: T }
  | { state: "failed"; message: string }
  | { state: "unknown"; message: string };

export function useFinancialMutation<T>() {
  const [outcome, setOutcome] = useState<MutationOutcome<T>>({ state: "idle" });
  // Only the newest request may publish a result.
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const run = useCallback(async (request: () => Promise<T>) => {
    // A second click, or a re-render that re-invokes the handler, is ignored
    // rather than queued: the server is idempotent, but a duplicate request
    // still costs a round trip and can confuse the operator.
    if (inFlight.current) return null;
    inFlight.current = true;
    const ticket = ++sequence.current;
    setOutcome({ state: "busy" });
    try {
      const result = await request();
      if (!mounted.current || ticket !== sequence.current) return null;
      setOutcome({ state: "done", result });
      return result;
    } catch (error) {
      if (!mounted.current || ticket !== sequence.current) return null;
      const message = error instanceof Error ? error.message : "The operation failed";
      // A transport failure leaves the outcome genuinely unknown: the request
      // may have been applied. Anything the server answered is a real failure.
      const indeterminate = error instanceof TypeError || /network|timed? ?out|aborted|fetch/i.test(message);
      setOutcome(indeterminate
        ? { state: "unknown", message: "The result of this operation is unknown. Reload the account before trying again." }
        : { state: "failed", message });
      return null;
    } finally {
      inFlight.current = false;
    }
  }, []);

  const reset = useCallback(() => setOutcome({ state: "idle" }), []);

  return { outcome, run, reset, busy: outcome.state === "busy" };
}

/** POSTs one accounting operation and returns the canonical server result. */
export async function postAccounting<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/staff/accounting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data as T;
}
