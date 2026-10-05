import "server-only";
import type postgres from "postgres";
import { sql } from "@/lib/db";
import { log, newTraceId } from "@/lib/obs";

export type JobType = "document_extraction" | "semantic_embedding" | "notification_send" | "audit_scan" | "intake_analysis" | "smart_client_enrichment";
export type Job = {
  id: string;
  type: JobType;
  entity_id: string | null;
  payload: Record<string, unknown>;
  trace_id: string | null;
  attempts: number;
  max_attempts: number;
};

/** Handler outcome. Throwing counts as a retryable failure. */
export type JobOutcome = { status: "succeeded" } | { status: "not_configured"; note: string } | { status: "failed_permanent"; error: string };
type Handler = (job: Job) => Promise<JobOutcome>;

const handlers = new Map<JobType, Handler>();
export function registerHandler(type: JobType, h: Handler) {
  handlers.set(type, h);
}

export async function enqueue(
  db: postgres.Sql | postgres.TransactionSql,
  j: { type: JobType; entityId?: string | null; payload?: Record<string, unknown>; dedupeKey?: string; traceId?: string; maxAttempts?: number; runAfter?: Date },
) {
  // Via a definer function so staff (RLS-scoped) transactions can enqueue without table access.
  await db`select public.enqueue_job(${j.type}, ${j.entityId ?? null}, ${db.json((j.payload ?? {}) as never)}, ${j.dedupeKey ?? null},
             ${j.traceId ?? newTraceId()}, ${j.maxAttempts ?? 5}, ${j.runAfter ?? new Date()})`;
}

export const VISIBILITY_SECONDS = 120;
/** Exponential backoff: 30s, 60s, 120s … capped at 1h. */
export const backoffSeconds = (attempt: number) => Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));

/** Claims and runs ready jobs. Safe to call concurrently (SKIP LOCKED). */
export async function processJobs(limit = 10) {
  // Handlers register on import.
  await import("@/lib/job-handlers");
  const db = sql();
  const claimed = (await db`select * from public.claim_jobs(${limit}, ${VISIBILITY_SECONDS})`) as unknown as Job[];
  const results: { id: string; type: string; status: string }[] = [];
  for (const job of claimed) {
    const handler = handlers.get(job.type);
    const t0 = performance.now();
    let status: string;
    try {
      if (!handler) throw new Error(`No handler for ${job.type}`);
      const out = await handler(job);
      if (out.status === "succeeded") {
        status = "succeeded";
        await db`update jobs set status = 'succeeded', finished_at = now(), locked_until = null, last_error = null where id = ${job.id}`;
      } else if (out.status === "not_configured") {
        status = "not_configured";
        await db`update jobs set status = 'not_configured', finished_at = now(), locked_until = null, last_error = ${out.note} where id = ${job.id}`;
      } else {
        status = "dead";
        await db`update jobs set status = 'dead', finished_at = now(), locked_until = null, last_error = ${out.error} where id = ${job.id}`;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 500) : "error";
      if (job.attempts >= job.max_attempts) {
        status = "dead";
        await db`update jobs set status = 'dead', finished_at = now(), locked_until = null, last_error = ${message} where id = ${job.id}`;
      } else {
        status = "retry";
        await db`update jobs set status = 'queued', locked_until = null, last_error = ${message},
                   run_after = now() + make_interval(secs => ${backoffSeconds(job.attempts)}) where id = ${job.id}`;
      }
    }
    log(status === "succeeded" || status === "not_configured" ? "info" : "warn", {
      trace_id: job.trace_id, route: "jobs", operation: job.type, job_id: job.id, attempt: job.attempts,
      duration_ms: Math.round(performance.now() - t0), result: status,
    });
    results.push({ id: job.id, type: job.type, status });
  }
  return results;
}
