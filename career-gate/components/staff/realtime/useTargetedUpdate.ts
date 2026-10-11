"use client";

import { useEffect, useState } from "react";
import { requestRecovery, subscribeResources } from "@/components/staff/realtime/update-bus";
import { payloadsForResources, type Resource } from "@/lib/realtime-resources";

/**
 * Subscribes a surface to the resources it renders and refetches only the
 * payloads those resources need.
 *
 * `initial` is the server-rendered value and stays authoritative for first
 * paint; a new server render discards anything the targeted path has patched.
 * A failed or impossible targeted fetch raises the recovery signal rather than
 * leaving the surface silently stale.
 *
 * `initial` and `apply` must both be referentially stable across renders: a
 * fresh object literal each render would re-seed on every pass. Declare `apply`
 * at module scope and memoise a composite `initial` on the server props it is
 * built from.
 */
export function useTargetedPayloads<T>(opts: {
  resources: readonly Resource[];
  clientId: string | null;
  initial: T;
  apply: (current: T, payloads: Record<string, unknown>) => T;
}): T {
  const { resources, clientId, initial, apply } = opts;
  const [patched, setPatched] = useState<T | null>(null);
  const [seed, setSeed] = useState(initial);

  if (seed !== initial) {
    // The server re-rendered. Its value supersedes every local patch.
    setSeed(initial);
    setPatched(null);
  }

  const key = resources.join(",");

  useEffect(() => {
    if (!clientId) return;
    const rendered = key.split(",").filter(Boolean) as Resource[];
    if (rendered.length === 0) return;
    let cancelled = false;

    const off = subscribeResources({
      resources: rendered,
      clientId,
      onUpdate: ({ resources: changed }) => {
        const payloads = payloadsForResources(changed);
        if (payloads.length === 0) {
          // No scoped payload exists for this resource, so nothing targeted
          // can be fetched; recovery is the only correct path.
          requestRecovery("unowned_resource");
          return;
        }
        void (async () => {
          const url = `/api/staff/client-resource?client_id=${encodeURIComponent(clientId)}&payloads=${payloads.join(",")}`;
          const res = await fetch(url).catch(() => null);
          const body = (await res?.json().catch(() => null)) as { ok?: boolean; payloads?: Record<string, unknown> } | null;
          if (cancelled) return;
          if (!body?.ok || !body.payloads) {
            requestRecovery("targeted_fetch_failed");
            return;
          }
          const next = body.payloads;
          setPatched((current) => apply(current ?? seed, next));
        })();
      },
    });

    return () => {
      cancelled = true;
      off();
    };
  }, [clientId, key, apply, seed]);

  return patched ?? initial;
}
