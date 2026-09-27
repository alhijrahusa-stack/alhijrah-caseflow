import "server-only";
import { randomUUID } from "node:crypto";
import { sha256Hex } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { assessQuality, extensionMatches, thumbnail } from "@/lib/doc-quality";
import { DOC_TYPES } from "@/lib/domain";
import { readUpload } from "@/lib/files";
import { enqueue } from "@/lib/jobs";
import { hit } from "@/lib/ratelimit";
import { logActivity, type Actor } from "@/lib/service";
import { removeObject, StorageNotConfigured, uploadObject } from "@/lib/storage";

export type SaveResult = { ok: true; id: string; status: string } | { ok: false; code: string; error: string; status: number };

/**
 * Validates (type, size, sniffed MIME, extension, full decode), stores the
 * original under a generated path in the private bucket, records its SHA-256
 * and quality, then queues extraction. The object is removed if the database
 * write fails.
 */
export async function saveDocument(args: { clientId: string; docType: string; file: File; actor: Actor }): Promise<SaveResult> {
  if (!(DOC_TYPES as readonly string[]).includes(args.docType)) return { ok: false, code: "invalid_input", error: "Unknown document type", status: 400 };
  if (!(await hit("document_upload_hour", `client:${args.clientId}`))) {
    return { ok: false, code: "rate_limited", error: "Upload limit reached for this client (10 per hour)", status: 429 };
  }
  const read = await readUpload(args.file);
  if ("error" in read) return { ok: false, code: "invalid_file", error: read.error, status: 400 };
  if (!extensionMatches(args.file.name, read.mime)) {
    return { ok: false, code: "invalid_file", error: "The file extension does not match its contents", status: 400 };
  }
  const quality = await assessQuality(read.bytes, read.mime);
  if (!quality.decoded) return { ok: false, code: "corrupt_file", error: "The file could not be decoded. Please upload a clear copy.", status: 400 };

  const hash = sha256Hex(read.bytes);
  const id = randomUUID();
  const ext = read.mime === "application/pdf" ? "pdf" : read.mime.split("/")[1];
  const path = `${args.clientId}/${id}/original.${ext}`;
  const thumbPath = read.mime.startsWith("image/") ? `${args.clientId}/${id}/thumb.webp` : null;

  try {
    await uploadObject(path, read.bytes, read.mime);
    if (thumbPath) await uploadObject(thumbPath, await thumbnail(read.bytes), "image/webp");
  } catch (e) {
    if (e instanceof StorageNotConfigured) return { ok: false, code: "NOT_CONFIGURED", error: "Document storage is NOT_CONFIGURED", status: 503 };
    console.error(e);
    await removeObject(path).catch(() => undefined);
    return { ok: false, code: "storage_error", error: "Could not store the file", status: 502 };
  }

  try {
    await sql().begin(async (tx) => {
      await tx`
        insert into documents (id, client_id, doc_type, storage_path, thumbnail_path, file_name, mime_type, size_bytes,
                               sha256, quality, page_count, width, height, uploaded_by, status)
        values (${id}, ${args.clientId}, ${args.docType}, ${path}, ${thumbPath}, ${args.file.name.slice(0, 200)}, ${read.mime},
                ${read.bytes.byteLength}, ${hash}, ${tx.json(quality as never)}, ${quality.page_count}, ${quality.width},
                ${quality.height}, ${args.actor.staffId}, 'pending')`;
      await logActivity(tx, {
        clientId: args.clientId, action: "document_uploaded", actor: args.actor, entityType: "document", entityId: id,
        newValue: { doc_type: args.docType, file_name: args.file.name, size_bytes: read.bytes.byteLength, sha256: hash, advisories: quality.advisories },
      });
      await enqueue(tx, { type: "document_extraction", entityId: id, dedupeKey: `extract:${id}:1`, traceId: args.actor.traceId, maxAttempts: 3 });
    });
    return { ok: true, id, status: "pending" };
  } catch (e) {
    console.error(e);
    await removeObject(path).catch((err) => console.error("orphan cleanup failed", path, err));
    if (thumbPath) await removeObject(thumbPath).catch(() => undefined);
    return { ok: false, code: "server_error", error: "Could not record the document", status: 500 };
  }
}
