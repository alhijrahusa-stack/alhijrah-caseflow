import { parseCsv, parseXlsx, type IntakeRow } from "@/lib/intake-file";
import { ActionError } from "@/lib/service";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import { fetchGoogleSheet } from "@/lib/universal-intake";
import { previewImportRows, stageSheetRows } from "@/lib/smart-client-import";
import { SMART_IMPORT_LIMITS } from "@/lib/smart-client-import-core";

export const runtime = "nodejs";
export const maxDuration = 60;

const CSV_TYPES = new Set(["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"]);
const XLSX_TYPES = new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);

function extension(name: string) {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

function assertRows(value: unknown): IntakeRow[] {
  if (!Array.isArray(value) || value.length > SMART_IMPORT_LIMITS.maxRows) throw new ActionError("invalid_rows", "Invalid import rows", 400);
  return value.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new ActionError("invalid_rows", "Invalid import row", 400);
    const clean: IntakeRow = {};
    for (const [key, cell] of Object.entries(row as Record<string, unknown>)) {
      if (typeof key !== "string" || key.length > 200) continue;
      if (cell == null) clean[key] = null;
      else if (typeof cell === "string") clean[key] = cell.slice(0, SMART_IMPORT_LIMITS.maxCellLength);
      else clean[key] = String(cell).slice(0, SMART_IMPORT_LIMITS.maxCellLength);
    }
    return clean;
  });
}

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return err("forbidden", "Smart client import requires manager or admin access", 403, traceId);

  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await req.json() as {
        mode?: string;
        rows?: unknown;
        source?: string;
        selected_rows?: number[];
        idempotency_key?: string;
        metadata?: Record<string, unknown>;
      };
      if (body.mode !== "stage") return err("invalid_mode", "Expected stage mode", 400, traceId);
      const result = await stageSheetRows({
        session: guard.session,
        rows: assertRows(body.rows),
        source: String(body.source ?? ""),
        selectedRows: Array.isArray(body.selected_rows) ? body.selected_rows.filter(Number.isInteger) : undefined,
        idempotencyKey: String(body.idempotency_key ?? ""),
        metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : undefined,
      });
      return ok(result, 201, traceId);
    }

    const form = await req.formData();
    const sheetUrl = String(form.get("google_sheet_url") ?? "").trim();
    const fileValue = form.get("file");
    const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
    const legacy = String(form.get("legacy") ?? "") === "1";

    if ((sheetUrl && file) || (!sheetUrl && !file)) return err("invalid_input", "Provide one file or one Google Sheets URL", 400, traceId);

    let rows: IntakeRow[];
    let source: "csv" | "xlsx" | "google_sheets" | "legacy";
    let metadata: Record<string, unknown> = {};

    if (sheetUrl) {
      const csv = await fetchGoogleSheet(sheetUrl);
      rows = parseCsv(csv);
      source = legacy ? "legacy" : "google_sheets";
      metadata = { google_sheet: true, legacy };
    } else {
      if (!file) return err("invalid_input", "File is required", 400, traceId);
      if (file.size > SMART_IMPORT_LIMITS.maxFileBytes) return err("file_too_large", "File exceeds the 10 MB import limit", 413, traceId);
      const ext = extension(file.name);
      const mime = file.type || "application/octet-stream";
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (ext === "csv" || CSV_TYPES.has(mime)) {
        rows = parseCsv(new TextDecoder().decode(bytes));
        source = legacy ? "legacy" : "csv";
      } else if (ext === "xlsx" || XLSX_TYPES.has(mime)) {
        rows = parseXlsx(bytes);
        source = legacy ? "legacy" : "xlsx";
      } else {
        return err("unsupported_file", "Sheet intake supports CSV and XLSX. Use Smart Client Import for PDF and photos.", 415, traceId);
      }
      metadata = { filename: file.name, size_bytes: file.size, mime_type: mime, legacy };
    }

    const preview = await previewImportRows(guard.session, rows);
    return ok({
      mode: "preview",
      source,
      metadata,
      total: preview.length,
      valid: preview.filter((row) => row.result === "VALID").length,
      duplicate: preview.filter((row) => row.result === "DUPLICATE").length,
      invalid: preview.filter((row) => row.result === "INVALID").length,
      rows: preview,
    }, 200, traceId);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    return err("import_failed", error instanceof Error ? error.message : "Import failed", 422, traceId);
  }
}
