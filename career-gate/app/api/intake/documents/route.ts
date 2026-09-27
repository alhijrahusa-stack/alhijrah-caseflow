import { sha256Hex } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { saveDocument } from "@/lib/documents";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";

export const runtime = "nodejs";

/** Applicant upload, authorized by the short-lived upload grant from /api/intake. */
export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const form = await req.formData().catch(() => null);
  if (!form) return err("invalid_input", "Expected multipart form data", 400, traceId);
  const token = String(form.get("upload_token") ?? "");
  const file = form.get("file");
  if (!(file instanceof File)) return err("invalid_input", "No file provided", 400, traceId);
  if (!/^[\w-]{40,60}$/.test(token)) return err("not_found", "Upload not permitted", 404, traceId);
  const [grant] = await sql()`select client_id from upload_grants where token_hash = ${sha256Hex(`upload:${token}`)} and expires_at > now()`;
  if (!grant) return err("not_found", "Upload not permitted or expired. Please contact the office.", 404, traceId);
  const r = await saveDocument({ clientId: grant.client_id, docType: String(form.get("doc_type") ?? ""), file, actor: { staffId: null, traceId } });
  if (!r.ok) return err(r.code, r.error, r.status, traceId);
  return ok({ id: r.id, status: r.status }, 201, traceId);
}
