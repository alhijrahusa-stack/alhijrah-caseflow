"use client";

import { useCallback } from "react";
import { publishMutationWithGrace, requestRecovery } from "@/components/staff/realtime/update-bus";

/**
 * Publishes the resources a mutation invalidated to the matching mounted
 * surface. A short grace retry covers the hydration/effect-registration race;
 * only a confirmed miss requests the centralized recovery refresh.
 */
export function useTargetedMutation() {
  return useCallback(
    (action: string, clientId: string | null) => {
      publishMutationWithGrace(action, clientId);
    },
    [],
  );
}

/**
 * Same contract for a mutation that touches several clients. Each client is
 * kept in its own scope; an empty target set has no targeted destination and
 * therefore enters recovery.
 */
export function useTargetedMutationBatch() {
  return useCallback(
    (action: string, clientIds: readonly string[]) => {
      if (clientIds.length === 0) {
        requestRecovery("unowned_resource");
        return;
      }
      for (const clientId of clientIds) publishMutationWithGrace(action, clientId);
    },
    [],
  );
}
