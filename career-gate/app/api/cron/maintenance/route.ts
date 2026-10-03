import { timingSafeEqual } from "node:crypto";
import { expireAmazonReservations } from "@/lib/amazon/service";
import { runAudit } from "@/lib/audit";
import { sql } from "@/lib/db";
import { err, ok } from "@/lib/http";
import { processJobs } from "@/lib/jobs";
import { traceIdFrom } from "@/lib/obs";
import { registry } from "@/lib/providers/config";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Vercel Cron: drains jobs, runs the full audit scan and removes expired rows. */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const secret = registry.app().cronSecret;
  if (!secret) return err("NOT_CONFIGURED", "CRON_SECRET is NOT_CONFIGURED", 503, traceId);
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return err("unauthorized", "Unauthorized", 401, traceId);
  const db = sql();
  const jobs = await processJobs(50);
  const audit = await runAudit(null, traceId);
  const amazonReservations = await expireAmazonReservations(traceId);
  const cleanup = {
    idempotency_keys: (await db`delete from idempotency_keys where expires_at < now()`).count,
    rate_limits: (await db`delete from rate_limits where window_start < now() - interval '1 day'`).count,
    otp_requests: (await db`delete from otp_requests where created_at < now() - interval '1 day'`).count,
    status_sessions: (await db`delete from status_sessions where expires_at < now() - interval '1 day'`).count,
    upload_grants: (await db`delete from upload_grants where expires_at < now()`).count,
    amazon_reservations: amazonReservations,
  };
  return ok({ jobs: jobs.length, audit, cleanup }, 200, traceId);
}
