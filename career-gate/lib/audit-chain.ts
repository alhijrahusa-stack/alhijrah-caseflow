import "server-only";
import { sql } from "@/lib/db";
import { log } from "@/lib/obs";

/**
 * Seal and verification of the tamper-evident chain over activity_log
 * (migration 046). Runs on the server's own database connection: the chain
 * functions are granted to service_role only and are never exposed to a staff
 * or portal JWT.
 *
 * Neither function throws. Until migration 046 is applied the functions do not
 * exist and every call reports `schema_pending`, so the application can ship
 * ahead of the schema change; any other database failure is logged at error
 * level and reported as `error` with its SQLSTATE.
 *
 * Every result that reaches the chain logs its head (seq and row_hash). Those
 * log lines are the record outside the database that `anchor` is checked
 * against: without one, a session that owns the tables could rewrite a row and
 * recompute every later seal undetected.
 */

export type ChainHead = { seq: number; hash: string };

export type SealResult =
  | { status: "sealed"; sealed: number; late: number; head: ChainHead | null }
  | { status: "busy" }
  | { status: "schema_pending" }
  | { status: "error"; code: string };

export type VerifyResult =
  | {
      status: "verified" | "partial" | "invalid" | "unsealed";
      checked: number;
      lastSeq: number;
      maxSeq: number;
      firstInvalidSeq: number | null;
      reason: string | null;
      unsealed: number;
      head: ChainHead | null;
    }
  | { status: "busy" }
  | { status: "schema_pending" }
  | { status: "error"; code: string };

const SCHEMA_PENDING_CODES = new Set(["42883", "42P01"]); // undefined_function, undefined_table
const BUSY_RETRIES = 3;
const BUSY_DELAY_MS = 200;
export const VERIFY_LIMIT = 250_000;

let schemaPendingLogged = false;

function failure(e: unknown, event: string, traceId: string, critical: boolean): { status: "schema_pending" } | { status: "error"; code: string } {
  const code = String((e as { code?: string })?.code ?? "unknown");
  if (SCHEMA_PENDING_CODES.has(code)) {
    // Once per instance on request paths; every time where the caller depends on it.
    if (critical || !schemaPendingLogged) log(critical ? "error" : "warn", { event: "audit_chain_schema_pending", trace_id: traceId, code });
    schemaPendingLogged = true;
    return { status: "schema_pending" };
  }
  log("error", { event, trace_id: traceId, code, error_message: e instanceof Error ? e.message.slice(0, 300) : "unknown" });
  return { status: "error", code };
}

const head = (seq: unknown, hash: unknown): ChainHead | null =>
  seq == null || hash == null ? null : { seq: Number(seq), hash: String(hash) };

/**
 * Seals unsealed activity rows in batches. `full` also finds rows committed
 * after a higher id was sealed; frequent callers leave it false. Only one
 * sealer runs at a time: a full seal that finds it running retries briefly; a
 * fast seal reports `busy` at once. Either leaves the rows to the next run.
 */
export async function sealAuditChain(opts: { batch?: number; maxBatches?: number; full?: boolean; traceId: string; critical?: boolean }): Promise<SealResult> {
  const batch = opts.batch ?? 500;
  const maxBatches = opts.maxBatches ?? 20;
  const db = sql();
  let sealed = 0;
  let late = 0;
  let last: ChainHead | null = null;
  const retries = opts.full ? BUSY_RETRIES : 0;
  try {
    for (let i = 0, busy = 0; i < maxBatches; ) {
      const [row] = await db.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '20s'");
        return tx`select * from public.cg_audit_seal(${batch}, ${opts.full ?? false})`;
      });
      if (row?.busy) {
        if (++busy > retries) {
          if (sealed === 0) return { status: "busy" };
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, BUSY_DELAY_MS));
        continue;
      }
      const n = Number(row?.sealed ?? 0);
      sealed += n;
      late += Number(row?.late ?? 0);
      last = head(row?.head_seq, row?.head_hash) ?? last;
      i++;
      if (n < batch) break;
    }
  } catch (e) {
    return failure(e, "audit_chain_seal_failed", opts.traceId, opts.critical ?? false);
  }
  if (late > 0) log("warn", { event: "audit_chain_late_rows", trace_id: opts.traceId, late });
  if (sealed > 0 || opts.full) log("info", { event: "audit_chain_head", trace_id: opts.traceId, sealed, head_seq: last?.seq ?? null, head_hash: last?.hash ?? null });
  return { status: "sealed", sealed, late, head: last };
}

/**
 * Recomputes the chain, up to `limit` links, and reports the first broken link.
 * `anchor` is a head recorded earlier outside the database: the chain must still
 * contain it unchanged. One verification runs at a time; a second caller gets
 * `busy` instead of stacking another full scan.
 */
export async function verifyAuditChain(opts: { traceId: string; anchor?: ChainHead | null; limit?: number; critical?: boolean }): Promise<VerifyResult> {
  const limit = opts.limit ?? VERIFY_LIMIT;
  const anchorSeq = opts.anchor?.seq ?? null;
  const anchorHash = opts.anchor?.hash ?? null;
  try {
    const row = await sql().begin(async (tx) => {
      await tx.unsafe("set local statement_timeout = '25s'");
      const [lock] = await tx`select pg_try_advisory_xact_lock(hashtextextended('cg-audit-verify', 0)) as ok`;
      if (!lock.ok) return null;
      const [r] = await tx`select * from public.cg_audit_verify(1, ${limit}, ${anchorSeq}, ${anchorHash})`;
      return r;
    });
    if (!row) return { status: "busy" };
    const lastSeq = Number(row.last_seq ?? 0);
    const maxSeq = Number(row.max_seq ?? 0);
    const unsealed = Number(row.unsealed ?? 0);
    const reason = (row.reason as string | null) ?? null;
    const status = reason ? "invalid" : lastSeq < maxSeq ? "partial" : maxSeq === 0 && unsealed > 0 ? "unsealed" : "verified";
    const result: VerifyResult = {
      status,
      checked: Number(row.checked ?? 0),
      lastSeq,
      maxSeq,
      firstInvalidSeq: row.first_invalid_seq == null ? null : Number(row.first_invalid_seq),
      reason,
      unsealed,
      head: head(row.head_hash == null ? null : lastSeq, row.head_hash),
    };
    log(status === "invalid" ? "error" : status === "verified" ? "info" : "warn", {
      event: "audit_chain_verified", trace_id: opts.traceId, ...result, head: undefined,
      head_seq: result.head?.seq ?? null, head_hash: result.head?.hash ?? null, anchor_seq: anchorSeq,
    });
    return result;
  } catch (e) {
    return failure(e, "audit_chain_verify_failed", opts.traceId, opts.critical ?? false);
  }
}
