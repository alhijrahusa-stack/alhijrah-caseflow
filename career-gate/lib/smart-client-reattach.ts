import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { ActionError } from "@/lib/service";
import { SMART_IMPORT_LIMITS } from "@/lib/smart-client-import-core";
import { removeObject, uploadObject } from "@/lib/storage";

const SUPPORTED_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function assertManager(session: StaffSession) {
  if (session.staff.role === "staff") throw new ActionError("forbidden", "Smart client import requires manager or admin access", 403);
}

function safeFilename(value: string) {
  const name = value.replace(/[\\/\0\r\n]/g, "_").replace(/[^\p{L}\p{N}._ -]/gu, "_").trim();
  return (name || "upload").slice(0, 180);
}

function conservativeDocumentType(name: string) {
  const normalized = name.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\b(passport|drivers? license|driver license|photo id|state id)\b/.test(normalized)) return "photo_id";
  if (/\b(work authorization|employment authorization|ead)\b/.test(normalized)) return "work_authorization";
  if (/\b(social security|ss card)\b/.test(normalized)) return "social_security_card";
  if (/\b(resume|curriculum vitae|cv)\b/.test(normalized)) return "resume";
  return "other";
}

type PreparedFile = {
  bytes: Uint8Array;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  storagePath: string;
  detectedDocumentType: string;
};

export async function reattachSmartImportDocuments(args: {
  session: StaffSession;
  caseId: string;
  files: File[];
}) {
  assertManager(args.session);
  if (!args.files.length) throw new ActionError("empty_upload", "Attach at least one document", 400);
  if (args.files.length > SMART_IMPORT_LIMITS.maxFiles) throw new ActionError("too_many_files", `Maximum ${SMART_IMPORT_LIMITS.maxFiles} files`, 413);

  const totalBytes = args.files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > SMART_IMPORT_LIMITS.maxTotalUploadBytes) throw new ActionError("upload_too_large", "Total upload exceeds the safe limit", 413);

  const [existing] = await sql()`select id,status from client_import_cases where id=${args.caseId}`;
  if (!existing) throw new ActionError("not_found", "Import case not found", 404);
  if (existing.status === "APPROVED_FILE") throw new ActionError("already_approved", "Approved imports cannot receive additional source documents", 409);

  const prepared: PreparedFile[] = [];
  for (const file of args.files) {
    const mime = file.type || "application/octet-stream";
    if (!file.size || file.size > SMART_IMPORT_LIMITS.maxFileBytes) throw new ActionError("file_too_large", `${file.name || "File"} exceeds the safe file limit`, 413);
    if (!SUPPORTED_MIME.has(mime)) throw new ActionError("unsupported_file", "Smart client import supports PDF, JPG, PNG and WebP", 415);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const filename = safeFilename(file.name || "upload");
    prepared.push({
      bytes,
      filename,
      mime,
      size: file.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      storagePath: `smart-import/${args.caseId}/${randomUUID()}-${filename}`,
      detectedDocumentType: conservativeDocumentType(filename),
    });
  }

  const uploaded: string[] = [];
  try {
    for (const file of prepared) {
      await uploadObject(file.storagePath, file.bytes, file.mime);
      uploaded.push(file.storagePath);
    }

    const result = await sql().begin(async (tx) => {
      const [lockedCase] = await tx`select id,status from client_import_cases where id=${args.caseId} for update`;
      if (!lockedCase) throw new ActionError("not_found", "Import case not found", 404);
      if (lockedCase.status === "APPROVED_FILE") throw new ActionError("already_approved", "Approved imports cannot receive additional source documents", 409);

      const documents: Array<Record<string, unknown>> = [];
      for (const file of prepared) {
        const [doc] = await tx`
          insert into client_import_documents(
            import_case_id,storage_reference,original_filename,mime_type,size_bytes,sha256,
            detected_document_type,extraction_metadata,uploaded_by
          ) values(
            ${args.caseId},${file.storagePath},${file.filename},${file.mime},${file.size},${file.sha256},
            ${file.detectedDocumentType},${tx.json({ extracted_rows: 0, extraction_error: null, processing_state: "PENDING" } as never)},${args.session.staff.id}
          )
          returning id,original_filename,mime_type,size_bytes,sha256,detected_document_type,created_at`;
        documents.push(doc);
      }

      const [countRow] = await tx`select count(*)::int as count from client_import_documents where import_case_id=${args.caseId}`;
      const documentCount = Number(countRow?.count ?? documents.length);
      await tx`
        update client_import_cases
        set verification_result=coalesce(verification_result,'{}'::jsonb) || ${tx.json({ ai_state: "PENDING", document_count: documentCount } as never)},
            updated_at=now()
        where id=${args.caseId}`;

      return { documents, documentCount };
    });

    return {
      case_id: args.caseId,
      uploaded_by: args.session.staff.id,
      uploaded_by_name: args.session.staff.display_name,
      document_count: result.documentCount,
      documents: result.documents,
      retry_url: `/api/staff/smart-client-import/${args.caseId}/retry`,
    };
  } catch (error) {
    for (const path of uploaded) await removeObject(path).catch(() => undefined);
    throw error;
  }
}
