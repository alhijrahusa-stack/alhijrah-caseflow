import { after } from "next/server";
import { saveDocument } from "@/lib/documents";
import { err, ok } from "@/lib/http";
import { processJobs } from "@/lib/jobs";
import { traceIdFrom } from "@/lib/obs";
import { authorize, staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: true });
  if (g.response) return g.response;
  const form = await req.formData().catch(() => null);
  if (!form) return err("invalid_input", "Expected multipart form data", 400, traceId);
  const clientId = String(form.get("client_id") ?? "");
  const file = form.get("file");
  if (!UUID.test(clientId)) return err("invalid_input", "Invalid client", 400, traceId);
  if (!(file instanceof File)) return err("invalid_input", "No file provided", 400, traceId);
  const authz = await authorize(req, g.session, "upload_document", { clientId }, traceId);
  if (!authz.ok) return authz.response;
  const r = await saveDocument({ clientId, docType: String(form.get("doc_type") ?? ""), file, actor: { staffId: g.session.staff.id, traceId } });
  if (!r.ok) return err(r.code, r.error, r.status, traceId);
  after(() => processJobs(5).catch((e) => console.error(e)));
  return ok({ id: r.id, status: r.status }, 201, traceId);
}
