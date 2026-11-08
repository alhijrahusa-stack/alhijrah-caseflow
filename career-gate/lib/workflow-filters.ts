import type { Tx } from "@/lib/auth";
import type { ClientStageFilter } from "@/lib/client-lifecycle-filters";

export function workflowFilter(tx: Tx, stage: ClientStageFilter) {
  if (stage === "urgent") return tx`c.is_urgent and c.deleted_at is null and c.current_status not in ('completed','cancelled')`;
  // This generated column is the same exclusive location used by transfers,
  // manager holds and live counters. Evidence remains in the underlying stage.
  return tx`c.operational_location=${stage}`;
}
