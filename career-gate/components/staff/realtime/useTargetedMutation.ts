"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback } from "react";
import { publishMutation } from "@/components/staff/realtime/update-bus";

/**
 * The replacement for `router.refresh()` at a mutation call site.
 *
 * Publishes the resources the mutation invalidated, scoped to one client, and
 * falls back to a route refresh only when the targeted path could not be taken
 * -- an unmapped mutation, or no mounted surface that renders those resources.
 */
export function useTargetedMutation() {
  const router = useRouter();
  return useCallback(
    (action: string, clientId: string | null) => {
      if (publishMutation(action, clientId) !== null) {
        startTransition(() => { router.refresh(); });
      }
    },
    [router],
  );
}

/**
 * The same contract for a mutation that touches several clients at once.
 *
 * Each client is published on its own scope, so a surface showing one of them
 * updates that one and nothing else. The fallback runs at most once, and only
 * if some client had no mounted owner.
 */
export function useTargetedMutationBatch() {
  const router = useRouter();
  return useCallback(
    (action: string, clientIds: readonly string[]) => {
      let missed = clientIds.length === 0;
      for (const clientId of clientIds) if (publishMutation(action, clientId) !== null) missed = true;
      if (missed) startTransition(() => { router.refresh(); });
    },
    [router],
  );
}
