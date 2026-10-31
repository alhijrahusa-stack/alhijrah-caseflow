import type { Tx } from "@/lib/auth";
import { G3_STAGES } from "@/lib/g3-stages";
import type { ClientStageFilter } from "@/lib/client-lifecycle-filters";

export function workflowFilter(tx: Tx, stage: ClientStageFilter) {
  if (stage === "payment_required") return tx`c.current_status=any(${[...G3_STAGES[4].statuses]})
    and not exists(select 1 from client_account_balances b where b.client_id=c.id and b.payment_status='paid')`;
  if (stage === "paperwork_pending") return tx`c.current_status=any(${[...G3_STAGES[4].statuses]})`;
  const statuses = stage === "new_intake" ? G3_STAGES[0].statuses
    : stage === "account_setup" ? G3_STAGES[1].statuses
    : stage === "job_ready" ? G3_STAGES[2].statuses
    : stage === "appointments" ? G3_STAGES[3].statuses : ["completed"];
  return tx`c.current_status=any(${[...statuses]})`;
}
