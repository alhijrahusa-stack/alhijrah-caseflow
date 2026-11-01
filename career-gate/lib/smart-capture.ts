import "server-only";
import { ActionError, type Tx } from "@/lib/service";

export async function assertCaptureLease(tx: Tx, caseId: string, generation: string) {
  const [row] = await tx`select id,verification_result from client_import_cases where id=${caseId} for update`;
  const result = row?.verification_result;
  if (!row || result?.processing_state !== "CAPTURING" || result?.capture_generation !== generation) {
    throw new ActionError("capture_superseded", "This source capture was interrupted; reopen the import to continue", 409);
  }
}
