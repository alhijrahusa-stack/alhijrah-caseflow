import "server-only";
import { sql } from "@/lib/db";
import { log } from "@/lib/obs";

/**
 * Seal and verification of the tamper-evident chain over activity_log
 * (migration 046). Runs on the server's own database connection: the chain
 * functions are granted to service_role only and are never exposed to a staff
 * or portal JWT.
 *
 * Until migration 046 is applied the functions do not exist; every call then
 * reports `schema_pending` instead of failing the caller, so the application
 * can ship ahead of the schema change.
 */

export type SealResult = { status: "sealed"; sealed: number } | { status: "schema_pending" };

export type VerifyResult =
  | { status: "verified" | "invalid"; checked: number; lastSeq: number; firstInvalidSeq: number | null; reason: string | null; unsealed: number }
  | { status: "schema_pending" };

const SCHEMA_PENDING_CODES = new Set(["42883", "42P01"]); // undefined_function, undefined_table

function schemaPending(e: unknown) {
  return SCHEMA_PENDING_CODES.has(String((e as { code?: string })?.code ?? ""));
}

/**
 * Seals unsealed activity rows in batches. `full` also finds rows committed
 * after a higher id was sealed; frequent callers leave it false.
 */
export async function sealAuditChain(opts: { batch?: number; maxBatches?: number; full?: boolean; traceId: string }): Promise<SealResult> {
  const batch = opts.batch ?? 500;
  const maxBatches = opts.maxBatches ?? 20;
  const db = sql();
  let total = 0;
  try {
    for (let i = 0; i < maxBatches; i++) {
      const [row] = await db`select public.cg_audit_seal(${batch}, ${opts.full ?? false}) as n`;
      const n = Number(row?.n ?? 0);
      total += n;
      if (n < batch) break;
    }
  } catch (e) {
    if (schemaPending(e)) {
      log("warn", { event: "audit_chain_schema_pending", trace_id: opts.traceId });
      return { status: "schema_pending" };
    }
    throw e;
  }
  return { status: "sealed", sealed: total };
}

/** Recomputes the whole chain. A broken link is logged as an error with its sequence and reason. */
export async function verifyAuditChain(traceId: string): Promise<VerifyResult> {
  const db = sql();
  try {
    const [row] = await db`select * from public.cg_audit_verify(1)`;
    const result: VerifyResult = {
      status: row?.reason ? "invalid" : "verified",
      checked: Number(row?.checked ?? 0),
      lastSeq: Number(row?.last_seq ?? 0),
      firstInvalidSeq: row?.first_invalid_seq == null ? null : Number(row.first_invalid_seq),
      reason: (row?.reason as string | null) ?? null,
      unsealed: Number(row?.unsealed ?? 0),
    };
    log(result.status === "verified" ? "info" : "error", { event: "audit_chain_verified", trace_id: traceId, ...result });
    return result;
  } catch (e) {
    if (schemaPending(e)) return { status: "schema_pending" };
    throw e;
  }
}
