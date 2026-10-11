import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { ActionError } from "@/lib/service";
import { CLIENT_EDITABLE_FIELDS, type ClientEditableField } from "@/lib/client-intake-fields";
import { readIntakeLinkForClient } from "@/lib/client-intake-link";
import { SMART_IMPORT_LIMITS } from "@/lib/smart-client-import-core";
import { rowsFromImageOrPdfDetailed } from "@/lib/universal-intake";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACCEPTED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function normalized(field: ClientEditableField, value: string) {
  const trimmed = value.trim();
  if (field === "email") return trimmed.toLowerCase();
  if (field === "phone") return trimmed.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return trimmed.toLowerCase();
}

export async function POST(req: Request, context: { params: Promise<{ token: string }> }) {
  const traceId = traceIdFrom(req);
  const { token } = await context.params;
  const open = await readIntakeLinkForClient(token);
  if (!open.ok) {
    return err(open.reason === "not_found" ? "not_found" : "link_closed", "This link is not available.", open.reason === "not_found" ? 404 : 410, traceId);
  }

  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length) return err("document_required", "Add a document to import information.", 400, traceId);
    if (files.length > SMART_IMPORT_LIMITS.maxFiles) return err("too_many_files", `Maximum ${SMART_IMPORT_LIMITS.maxFiles} files`, 413, traceId);

    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > SMART_IMPORT_LIMITS.maxTotalUploadBytes) return err("upload_too_large", "Total upload exceeds the safe limit.", 413, traceId);

    const values = new Map<ClientEditableField, string[]>();
    for (const file of files) {
      if (!ACCEPTED.has(file.type)) return err("unsupported_file", "Supported files: PDF, JPG, PNG and WEBP.", 415, traceId);
      if (file.size > SMART_IMPORT_LIMITS.maxFileBytes) return err("file_too_large", "One of the files is larger than the allowed limit.", 413, traceId);
      const detailed = await rowsFromImageOrPdfDetailed(new Uint8Array(await file.arrayBuffer()), file.type);
      for (const item of detailed) {
        for (const field of CLIENT_EDITABLE_FIELDS) {
          const raw = item.row[field];
          if (typeof raw !== "string" || !raw.trim()) continue;
          const list = values.get(field) ?? [];
          list.push(raw.trim());
          values.set(field, list);
        }
      }
    }

    const fields: Partial<Record<ClientEditableField, string>> = {};
    const reviewFields: ClientEditableField[] = [];
    for (const field of CLIENT_EDITABLE_FIELDS) {
      const candidates = values.get(field) ?? [];
      if (!candidates.length) continue;
      const unique = [...new Map(candidates.map((value) => [normalized(field, value), value])).values()];
      if (unique.length === 1) fields[field] = unique[0];
      else reviewFields.push(field);
    }

    return ok({
      fields,
      imported_fields: Object.keys(fields),
      review_fields: reviewFields,
    }, 200, traceId);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    return err("extraction_failed", "We could not read this document. You can continue by entering the missing information manually.", 422, traceId);
  }
}
