import { ActionError } from "@/lib/service";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import type { DocumentExtraction } from "@/lib/universal-intake";

async function extractViaPrivateOcr(bytes: Uint8Array, mimeType: string, filename: string): Promise<DocumentExtraction[]> {
  const origin = process.env.PRIVATE_OCR_SERVICE_URL?.trim();
  const token = process.env.PRIVATE_OCR_SERVICE_TOKEN?.trim();
  if (!origin || !token) throw new ActionError("ocr_not_configured", "Private OCR service is not configured", 503);
  const target = new URL("/extract", origin);
  if (target.protocol !== "https:") throw new ActionError("ocr_transport_invalid", "OCR service must use HTTPS", 503);
  const form = new FormData();
  form.set("file", new File([bytes], filename, { type: mimeType }));
  let response: Response;
  try {
    response = await fetch(target, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new ActionError("ocr_unavailable", "Private OCR service is unavailable. Retry after a moment.", 503);
  }
  if (!response.ok) throw new ActionError("ocr_failed", "Private OCR could not process this document", 502);
  const result = await response.json().catch(() => null);
  if (!result?.ok || typeof result?.row !== "object" || result.row === null || Array.isArray(result.row)) {
    throw new ActionError("ocr_invalid_result", "OCR response format is invalid", 502);
  }
  const allowedFields = ["full_name", "phone", "email", "date_of_birth", "street", "city", "state", "zip", "preferred_language", "site_code", "shift_code", "shift_days", "shift_start_time", "shift_end_time"];
  const row: Record<string, string | null> = {};
  const confidence: Record<string, number> = {};
  for (const key of allowedFields) {
    const value = result.row[key];
    if (typeof value === "string" && value.trim() && value.length <= 200) {
      row[key] = value.trim();
      const score = result.confidence?.[key];
      if (typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1) confidence[key] = score;
    }
  }
  return [{ row: row as DocumentExtraction["row"], confidence: confidence as DocumentExtraction["confidence"] }];
}

export const runtime = "nodejs";
export const maxDuration = 60;

const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
function fileSignatureValid(data: Uint8Array, type: string) {
  if (type === "application/pdf") return data.length >= 5 && String.fromCharCode(...data.slice(0, 5)) === "%PDF-";
  if (type === "image/jpeg") return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (type === "image/png") return data.length >= 8 && [137,80,78,71,13,10,26,10].every((n,i) => data[i] === n);
  if (type === "image/webp") return data.length >= 12 && String.fromCharCode(...data.slice(0,4)) === "RIFF" && String.fromCharCode(...data.slice(8,12)) === "WEBP";
  return false;
}

/** Authenticated, stateless, pre-submit extraction. Never creates a client or a case. */
export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return err("forbidden", "Manager or admin access required", 403, traceId);
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length || files.length > 10) throw new ActionError("invalid_files", "Select 1–10 documents", 400);
    if (files.reduce((n, f) => n + f.size, 0) > 25 * 1024 * 1024) throw new ActionError("files_too_large", "Total upload exceeds 25 MB", 413);
    const extracted = [];
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024 || !allowed.has(file.type)) throw new ActionError("unsupported_file", "Unsupported document type or size", 415);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!fileSignatureValid(bytes, file.type)) throw new ActionError("invalid_file", "Document content does not match its type", 415);
      const results = await extractViaPrivateOcr(bytes, file.type, file.name);
      extracted.push({ filename: file.name, candidates: results });
    }
    return ok({ documents: extracted }, 200, traceId);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    return err("extraction_failed", "Document extraction unavailable. Your selected file remains ready for retry.", 502, traceId);
  }
}
