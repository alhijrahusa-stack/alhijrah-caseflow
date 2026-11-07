import type { Tx } from "@/lib/auth";
import type { ClientStageFilter } from "@/lib/client-lifecycle-filters";

export function workflowFilter(tx: Tx, stage: ClientStageFilter) {
  // This generated column is the same exclusive location used by transfers,
  // manager holds and live counters. Evidence remains in the underlying stage.
  return tx`c.operational_location=${stage}`;
}
