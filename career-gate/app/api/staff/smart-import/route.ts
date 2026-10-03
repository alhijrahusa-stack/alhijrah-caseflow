import { withStaff } from "@/lib/auth";
import { ActionError } from "@/lib/service";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import { importQueue, mutateImportCase } from "@/lib/smart-client-import";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return err("forbidden", "Smart Career Collect Client requires manager or admin access", 403, traceId);
  const url = new URL(req.url);
  const caseId = url.searchParams.get("case_id");
  try {
    const data = await importQueue(guard.session, url.searchParams.get("status"), url.searchParams.get("q"), caseId);
    const documents = caseId ? await withStaff(guard.session, async (tx) => tx`
      select id,original_filename,mime_type,size_bytes,detected_document_type,created_at
      from client_import_documents
      where import_case_id=${caseId}
      order by created_at,id
    `) : [];
    return ok({ ...data, documents }, 200, traceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load import queue";
    return err("load_failed", message, 500, traceId);
  }
}

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return err("forbidden", "Smart Career Collect Client requires manager or admin access", 403, traceId);
  try {
    const body = await req.json();
    const data = await mutateImportCase(guard.session, body, traceId);
    return ok(data, 200, traceId);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    const message = error instanceof Error ? error.message : "Import action failed";
    return err("import_action_failed", message, 500, traceId);
  }
}
