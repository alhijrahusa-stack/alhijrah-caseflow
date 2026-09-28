import { parseCsv, parseXlsx } from "@/lib/intake-file";
import { fetchGoogleSheetCsv } from "@/lib/google-sheets";
import { ActionError } from "@/lib/service";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import { importRows, rowsFromImageOrPdf } from "@/lib/universal-intake";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CSV_TYPES = new Set(["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"]);
const XLSX_TYPES = new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
const OCR_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function extension(name: string) {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m?.[1] ?? "";
}

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return err("forbidden", "Universal intake requires manager or admin access", 403, traceId);

  try {
    const form = await req.formData();
    const sheetUrl = String(form.get("google_sheet_url") ?? "").trim();
    const fileValue = form.get("file");
    const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;

    if ((sheetUrl && file) || (!sheetUrl && !file)) {
      return err("invalid_input", "Provide one file or one Google Sheets URL", 400, traceId);
    }

    let rows;
    let source: string;

    if (sheetUrl) {
      const csv = await fetchGoogleSheetCsv(sheetUrl);
      rows = parseCsv(csv);
      source = "google_sheets_api";
    } else {
      if (!file) return err("invalid_input", "File is required", 400, traceId);
      if (file.size > MAX_FILE_BYTES) return err("file_too_large", "File exceeds the 10 MB import limit", 413, traceId);
      const ext = extension(file.name);
      const mime = file.type || "application/octet-stream";
      const bytes = new Uint8Array(await file.arrayBuffer());

      if (ext === "csv" || CSV_TYPES.has(mime)) {
        rows = parseCsv(new TextDecoder().decode(bytes));
        source = "csv";
      } else if (ext === "xlsx" || XLSX_TYPES.has(mime)) {
        rows = parseXlsx(bytes);
        source = "xlsx";
      } else if (OCR_TYPES.has(mime) || ["pdf", "jpg", "jpeg", "png", "webp"].includes(ext)) {
        const normalizedMime = mime === "application/octet-stream"
          ? ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"
          : mime;
        rows = await rowsFromImageOrPdf(bytes, normalizedMime);
        source = normalizedMime === "application/pdf" ? "pdf_ocr" : "image_ocr";
      } else {
        return err("unsupported_file", "Supported imports: CSV, XLSX, PDF, JPG, PNG and WebP", 415, traceId);
      }
    }

    const result = await importRows(guard.session, rows, source, traceId);
    return ok({ source, ...result }, result.created > 0 ? 201 : 200, traceId);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    const message = error instanceof Error ? error.message : "Import failed";
    return err("import_failed", message, 422, traceId);
  }
}
