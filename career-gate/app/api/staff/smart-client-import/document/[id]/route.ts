import { z } from "zod";
import { ActionError } from "@/lib/service";
import { err } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import { getImportDocument } from "@/lib/smart-client-import";
import { signedUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return err("forbidden", "Smart client import requires manager or admin access", 403, traceId);
  try {
    const { id } = await context.params;
    const document = await getImportDocument(guard.session, z.uuid().parse(id));
    const signed = await signedUrl(document.storage_reference, document.original_filename);
    return Response.redirect(signed.url, 302);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    if (error instanceof z.ZodError) return err("invalid_id", "Invalid document ID", 400, traceId);
    return err("document_open_failed", "Unable to open document", 500, traceId);
  }
}
