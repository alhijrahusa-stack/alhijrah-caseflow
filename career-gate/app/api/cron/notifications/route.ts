import { timingSafeEqual } from "node:crypto";
import { err, ok } from "@/lib/http";
import { processJobs } from "@/lib/jobs";
import { traceIdFrom } from "@/lib/obs";
import { registry } from "@/lib/providers/config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const secret = registry.app().cronSecret;
  if (!secret) return err("NOT_CONFIGURED", "CRON_SECRET is not configured", 503, traceId);
  const expected = `Bearer ${secret}`;
  const supplied = req.headers.get("authorization") ?? "";
  if (supplied.length !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))) {
    return err("unauthorized", "Unauthorized", 401, traceId);
  }
  const jobs = await processJobs(50);
  return ok({ processed: jobs.length, outcomes: jobs.map(job => ({ type: job.type, status: job.status })) },200,traceId);
}
