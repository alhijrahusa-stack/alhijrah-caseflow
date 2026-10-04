import { after } from "next/server";
import { ActionError } from "@/lib/service";
import { err, ok } from "@/lib/http";
import { processJobs } from "@/lib/jobs";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import { stageMobileImportV2 } from "@/lib/smart-client-mobile";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return err("forbidden", "Smart client import requires manager or admin access", 403, traceId);
  try {
    const form = await req.formData();
    const notes = String(form.get("notes") ?? "");
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    const idempotencyKey = req.headers.get("idempotency-key") ?? String(form.get("idempotency_key") ?? "");
    const result = await stageMobileImportV2({ session: guard.session, notes, files, idempotencyKey });
    if (files.length && !result.idempotent) {
      after(async () => {
        await processJobs(10);
      });
    }
    return ok({ ...result, enrichment_url: `/api/staff/smart-client-import/${result.case_id}/retry` }, 202, traceId);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    return err("mobile_import_failed", error instanceof Error ? error.message : "Mobile import failed", 500, traceId);
  }
}
