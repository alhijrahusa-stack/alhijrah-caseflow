import { ActionError } from "@/lib/service";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import { stageMobileImport } from "@/lib/smart-client-import";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const form = await req.formData();
    const notes = String(form.get("notes") ?? "");
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    const result = await stageMobileImport(guard.session, notes, files, traceId);
    return ok(result, 201, traceId);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    const message = error instanceof Error ? error.message : "Smart import failed";
    return err("smart_import_failed", message, 500, traceId);
  }
}
