import { rowsFromImageOrPdfDetailed } from "@/lib/universal-intake";
import { ActionError } from "@/lib/service";
import { err, ipHash, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { hit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = new Set(["driver_license", "state_id", "green_card", "us_passport", "ead"]);
const MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function signatureMatches(b: Uint8Array, mime: string): boolean {
  if (mime === "application/pdf") return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
  if (mime === "image/jpeg") return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === "image/png") return b.length > 8 && [137,80,78,71,13,10,26,10].every((v,i) => b[i] === v);
  if (mime === "image/webp") return b.length > 12 && String.fromCharCode(...b.subarray(0,4)) === "RIFF" && String.fromCharCode(...b.subarray(8,12)) === "WEBP";
  return false;
}

const EDITABLE = ["full_name", "date_of_birth", "phone", "email", "street", "city", "state", "zip", "preferred_language"] as const;

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  try {
    if (!(await hit("document_upload_hour", ipHash(req)))) return err("rate_limited", "Document extraction limit reached. Try again later.", 429, traceId);
    const form = await req.formData();
    if (form.get("ocr_consent") !== "yes") return err("consent_required", "Consent to assisted document reading is required.", 403, traceId);
    const documentType = String(form.get("document_type") ?? "");
    if (!TYPES.has(documentType)) return err("invalid_document_type", "Select the document type.", 400, traceId);
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1) return err("file_required", "Select one identity document.", 400, traceId);
    if (file.size > MAX_BYTES) return err("file_too_large", "Maximum file size is 4 MB.", 413, traceId);
    if (!MIME.has(file.type)) return err("unsupported_document", "Supported formats: PDF, JPEG, PNG and WEBP.", 415, traceId);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!signatureMatches(bytes, file.type)) return err("invalid_file_content", "File content does not match its declared format.", 415, traceId);
    const results = await rowsFromImageOrPdfDetailed(bytes, file.type);
    if (results.length !== 1) return err("ambiguous_document", "The document did not identify exactly one applicant. Enter your details manually.", 422, traceId);

    const fields: Record<string, string> = {};
    const confidence: Record<string, number> = {};
    for (const field of EDITABLE) {
      const raw = results[0].row[field];
      if (typeof raw !== "string" || !raw.trim() || raw.length > 200) continue;
      const value = raw.trim();
      if (field === "date_of_birth" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
      if (field === "zip" && !/^\d{5}(?:-\d{4})?$/.test(value)) continue;
      if (field === "state" && !/^[A-Za-z]{2}$/.test(value)) continue;
      if (field === "preferred_language" && !["ar", "en", "es"].includes(value.toLowerCase())) continue;
      fields[field] = value;
      confidence[field] = Math.round((results[0].confidence[field] ?? 0) * 100);
    }
    return ok({ document_type: documentType, fields, confidence, status: "needs_customer_review", verified: false }, 200, traceId);
  } catch (e) {
    if (e instanceof ActionError) return err(e.code, e.message, e.status, traceId);
    console.error("public_document_extraction_failed", { traceId, errorCode: (e as { code?: string })?.code ?? "unknown" });
    return err("extraction_unavailable", "Automatic extraction is unavailable. You can enter the fields manually.", 503, traceId);
  }
}
