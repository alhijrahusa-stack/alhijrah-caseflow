import "server-only";
import type { Tx } from "@/lib/auth";

export type IdemOutcome =
  | { kind: "new" }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "conflict" };

/**
 * Claims (operation, key) inside the caller's transaction. A concurrent
 * request with the same key blocks on the unique index until this
 * transaction ends, then sees the stored response (or proceeds if we
 * rolled back). Same key + different fingerprint is a conflict.
 */
export async function claimKey(tx: Tx, operation: string, key: string, fp: string): Promise<IdemOutcome> {
  const inserted = await tx`
    insert into idempotency_keys (key, operation, request_fingerprint, state)
    values (${key}, ${operation}, ${fp}, 'in_progress')
    on conflict (operation, key) do nothing
    returning key`;
  if (inserted.length) return { kind: "new" };
  const [row] = await tx`
    select request_fingerprint, state, response_body, status_code from idempotency_keys
    where operation = ${operation} and key = ${key}`;
  if (!row || row.request_fingerprint !== fp) return { kind: "conflict" };
  if (row.state !== "completed") return { kind: "conflict" };
  return { kind: "replay", status: row.status_code as number, body: row.response_body };
}

export async function completeKey(tx: Tx, operation: string, key: string, status: number, body: unknown) {
  await tx`
    update idempotency_keys set state = 'completed', status_code = ${status}, response_body = ${tx.json(body as never)}
    where operation = ${operation} and key = ${key}`;
}
