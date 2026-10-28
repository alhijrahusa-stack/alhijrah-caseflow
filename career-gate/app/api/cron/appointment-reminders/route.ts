import { timingSafeEqual } from "node:crypto";
import { queueAdvanceAppointmentReminders } from "@/lib/appointment-email";
import { processJobs } from "@/lib/jobs";
import { registry } from "@/lib/providers/config";
import { err, ok } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = registry.app().cronSecret;
  if (!secret) return err("not_configured","CRON_SECRET is required",503);
  const supplied = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))
    return err("unauthorized","Unauthorized",401);
  const reminders = await queueAdvanceAppointmentReminders();
  const jobs = await processJobs(50);
  return ok({remindersQueued:reminders,jobsProcessed:jobs.length});
}
