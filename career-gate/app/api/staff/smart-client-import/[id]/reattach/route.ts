import { z } from "zod";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { ActionError } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";
import { reattachSmartImportDocuments } from "@/lib/smart-client-reattach";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return err("forbidden", "Smart client import requires manager or admin access", 403, traceId);

  try {
    const { id } = await context.params;
    const caseId = z.uuid().parse(id);
    const form = await req.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    const result = await reattachSmartImportDocuments({ session: guard.session, caseId, files });
    return ok(result, 201, traceId);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    if (error instanceof z.ZodError) return err("invalid_id", "Invalid import case ID", 400, traceId);
    return err("document_reattach_failed", error instanceof Error ? error.message : "Document reattach failed", 500, traceId);
  }
}
