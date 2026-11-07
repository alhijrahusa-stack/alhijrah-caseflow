import "server-only";
import { createHash } from "node:crypto";
import type { StaffSession, Tx } from "@/lib/auth";
import { ActionError } from "@/lib/service";

export async function staffOperation<T>(tx: Tx, session: StaffSession, operationId: string | undefined, name: string, input: unknown, work: () => Promise<T>): Promise<T> {
  if (!operationId) return work(); // Existing clients remain compatible.
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  await tx`select pg_advisory_xact_lock(hashtextextended(${`${session.staff.id}:${operationId}`},0))`;
  const [previous] = await tx`select operation_name,request_hash,result from staff_operations where staff_id=${session.staff.id} and operation_id=${operationId}`;
  if (previous) {
    if (previous.operation_name !== name || previous.request_hash !== hash) throw new ActionError("operation_conflict", "This operation key belongs to a different request", 409);
    return previous.result as T;
  }
  const result = await work();
  await tx`insert into staff_operations(staff_id,operation_id,operation_name,request_hash,result)
    values(${session.staff.id},${operationId},${name},${hash},${tx.json(result as never)})`;
  return result;
}
