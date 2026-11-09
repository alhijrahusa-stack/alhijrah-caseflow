import "server-only";
import { withStaff, type StaffSession, type Tx } from "@/lib/auth";
import { staffOperation } from "@/lib/staff-operation";
import { ActionError } from "@/lib/service";

const FAILURES: Record<string, [number, string]> = {
  import_review_access_required: [403, "An active staff account is required"],
  import_review_permission_required: [403, "Your account cannot submit review tasks"],
  manager_access_required: [403, "Only a manager may make this decision"],
  import_source_unavailable: [404, "This import is no longer in the active queue"],
  import_review_unavailable: [404, "The review is unavailable"],
  import_already_with_manager: [409, "This file is already with a manager"],
  duplicate_scan_stale: [409, "The records changed. Run the duplicate check again before sending"],
  import_review_changed: [409, "The record identity changed. A new verified comparison is required"],
  duplicate_target_unverified: [400, "Choose a record from the verified comparison"],
  import_reason_required: [400, "Choose a reason from the available options"],
};

export async function importReviewCommand<T>(tx: Tx, command: string, input: Record<string, unknown>): Promise<T> {
  try {
    const [row] = await tx`select career_gate_private.import_review_command(${command},${tx.json(input as never)}) result`;
    return row.result as T;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    for (const [code, [status, text]] of Object.entries(FAILURES)) if (message.includes(code)) throw new ActionError(code, text, status);
    throw cause;
  }
}

export async function readImportReview<T>(session: StaffSession, command: "queue" | "scan" | "trash", input: Record<string, unknown>) {
  return withStaff(session, tx => importReviewCommand<T>(tx, command, input));
}

export async function mutateImportReview<T>(session: StaffSession, input: Record<string, unknown> & { action: "submit" | "restore"; operation_id: string }, traceId: string) {
  return withStaff(session, tx => staffOperation(tx, session, input.operation_id, `import_review_${input.action}`, input,
    () => importReviewCommand<T>(tx, input.action, { ...input, trace_id: traceId })));
}
