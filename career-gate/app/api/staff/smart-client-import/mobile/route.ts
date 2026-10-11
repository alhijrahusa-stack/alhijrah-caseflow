import { ActionError } from "@/lib/service";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import { enrichMobileImportCase, stageMobileImportV2 } from "@/lib/smart-client-mobile";

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
    if (!files.length) return ok({ ...result, enrichment_url: null }, 201, traceId);
    try {
      const enriched = await enrichMobileImportCase(guard.session, result.case_id);
      return ok({ ...result, ...enriched, enrichment_url: null }, 201, traceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Document enrichment failed";
      return ok({
        ...result,
        enrichment_url: `/api/staff/smart-client-import/${result.case_id}/retry`,
        enrichment_error: message,
        verification_result: {
          ...(result.verification_result ?? {}),
          processing_state: "REVIEW_REQUIRED",
          ai_state: "FAILED",
          extraction_errors: [{ code: "AUTO_ENRICH_FAILED", message }],
        },
      }, 202, traceId);
    }
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    return err("mobile_import_failed", error instanceof Error ? error.message : "Mobile import failed", 500, traceId);
  }
}
