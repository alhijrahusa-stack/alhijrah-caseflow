import { sql } from "@/lib/db";
import { saveDocument } from "@/lib/documents";
import { err, ok, staffAllowed } from "@/lib/http";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  if (!(await staffAllowed())) return err("unauthorized", "Office access required", 401);
  const form = await req.formData().catch(() => null);
  if (!form) return err("invalid_input", "Expected multipart form data");
  const clientId = String(form.get("client_id") ?? "");
  const handledBy = String(form.get("handled_by") ?? "");
  const file = form.get("file");
  if (!UUID.test(clientId)) return err("invalid_input", "Invalid client");
  if (!UUID.test(handledBy)) return err("invalid_staff", "Select who is handling this");
  if (!(file instanceof File)) return err("invalid_input", "No file provided");

  const [row] = await sql()`
    select (select id from clients where id = ${clientId}) as client,
           (select id from staff_directory where id = ${handledBy} and active) as staff`;
  if (!row.client) return err("not_found", "Client not found", 404);
  if (!row.staff) return err("invalid_staff", "Unknown or inactive staff member");

  const saved = await saveDocument({ clientId, docType: String(form.get("doc_type") ?? ""), file, uploadedBy: handledBy });
  if (!saved.ok) return err("upload_failed", saved.error, saved.status);
  return ok({ id: saved.id }, 201);
}
