import { timingSafeEqual } from "node:crypto";
import { runAudit } from "@/lib/audit";
import { sql } from "@/lib/db";
import { ensurePostmarkWebhook, processEmailOutbox } from "@/lib/email/postmark";
import { err, ok } from "@/lib/http";
import { processJobs } from "@/lib/jobs";
import { traceIdFrom } from "@/lib/obs";
import { registry } from "@/lib/providers/config";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Vercel Cron: drains jobs, retries confirmation email outbox, runs audits and removes expired rows. */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const secret = registry.app().cronSecret;
  if (!secret) return err("NOT_CONFIGURED", "CRON_SECRET is NOT_CONFIGURED", 503, traceId);
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return err("unauthorized", "Unauthorized", 401, traceId);
  }
  const db = sql();
  const jobs = await processJobs(50);
  let email = { configured: false, processed: 0, sent: 0, failed: 0 };
  try {
    if (process.env.POSTMARK_SERVER_TOKEN && process.env.CAREER_GATE_FROM_EMAIL && process.env.CAREER_GATE_PUBLIC_URL) {
      const results = await Promise.allSettled([ensurePostmarkWebhook(), processEmailOutbox(20)]);
      const delivery = results[1];
      if (delivery.status === "fulfilled") email = delivery.value;
      if (results[0].status === "rejected") console.error("Career Gate Postmark webhook provisioning failed", results[0].reason);
      if (delivery.status === "rejected") console.error("Career Gate email maintenance delivery failed", delivery.reason);
    }
  } catch (error) {
    console.error("Career Gate email maintenance failed", error);
  }
  const audit = await runAudit(null, traceId);
  const cleanup = {
    idempotency_keys: (await db`delete from idempotency_keys where expires_at < now()`).count,
    rate_limits: (await db`delete from rate_limits where window_start < now() - interval '1 day'`).count,
    otp_requests: (await db`delete from otp_requests where created_at < now() - interval '1 day'`).count,
    status_sessions: (await db`delete from status_sessions where expires_at < now() - interval '1 day'`).count,
    upload_grants: (await db`delete from upload_grants where expires_at < now()`).count,
  };
  return ok({ jobs: jobs.length, email, audit, cleanup }, 200, traceId);
}
