import { sha256Hex } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { saveDocument } from "@/lib/documents";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";

export const runtime = "nodejs";

/** Applicant upload, authorized by the short-lived upload grant from public intake/application submission. */
export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const form = await req.formData().catch(() => null);
  if (!form) return err("invalid_input", "Expected multipart form data", 400, traceId);

  const token = String(form.get("upload_token") ?? "");
  const requestedUploadId = String(form.get("upload_id") ?? "").trim();
  const file = form.get("file");
  if (!(file instanceof File)) return err("invalid_input", "No file provided", 400, traceId);
  if (!/^[\w-]{40,60}$/.test(token)) return err("not_found", "Upload not permitted", 404, traceId);
  if (requestedUploadId && !/^[\w-]{16,200}$/.test(requestedUploadId)) {
    return err("invalid_input", "A valid upload_id is required", 400, traceId);
  }

  const [grant] = await sql()`
    select client_id
    from upload_grants
    where token_hash = ${sha256Hex(`upload:${token}`)} and expires_at > now()`;
  if (!grant) return err("not_found", "Upload not permitted or expired. Retry the application submission to renew access.", 404, traceId);

  // The current public HTML predates explicit upload_id fields. Preserve one
  // deterministic idempotency key per client/document content for that path,
  // while modern clients keep their caller-generated upload id.
  const uploadId = requestedUploadId || `legacy-${sha256Hex(new Uint8Array(await file.arrayBuffer()))}`;

  const result = await saveDocument({
    clientId: grant.client_id,
    docType: String(form.get("doc_type") ?? ""),
    file,
    uploadKey: uploadId,
    actor: { staffId: null, traceId },
  });
  if (!result.ok) return err(result.code, result.error, result.status, traceId);
  return ok({ id: result.id, status: result.status, replayed: result.replayed }, result.replayed ? 200 : 201, traceId);
}
