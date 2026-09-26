import { timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";
import { saveDocument } from "@/lib/documents";
import { err, ok } from "@/lib/http";

export const runtime = "nodejs";

const UPLOAD_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_PUBLIC_DOCS = 10;

/**
 * Applicant document upload, authorized by the status token returned from
 * /api/intake. Accepted only shortly after submission.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return err("invalid_input", "Expected multipart form data");
  const ref = String(form.get("ref") ?? "");
  const token = String(form.get("token") ?? "");
  const file = form.get("file");
  if (!(file instanceof File)) return err("invalid_input", "No file provided");

  const [client] = await sql()`
    select c.id, c.status_token, c.created_at,
           (select count(*)::int from documents d where d.client_id = c.id) as doc_count
    from clients c where c.ref = ${ref} and c.source = 'public'`;
  const tokenOk =
    client &&
    token.length === client.status_token.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(client.status_token));
  if (!tokenOk) return err("not_found", "Application not found", 404);
  if (Date.now() - new Date(client.created_at).getTime() > UPLOAD_WINDOW_MS) {
    return err("upload_closed", "Online upload has closed for this application. Please contact the office.", 403);
  }
  if (client.doc_count >= MAX_PUBLIC_DOCS) return err("too_many", "Document limit reached", 429);

  const saved = await saveDocument({
    clientId: client.id, docType: String(form.get("doc_type") ?? ""), file, uploadedBy: null,
  });
  if (!saved.ok) return err("upload_failed", saved.error, saved.status);
  return ok({ id: saved.id }, 201);
}
