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
import { downloadObject, removeObject, StorageNotConfigured, uploadObject } from "@/lib/storage";

export type SaveResult =
  | { ok: true; id: string; status: string; replayed: boolean }
  | { ok: false; code: string; error: string; status: number };

type ExistingUpload = {
  id: string;
  doc_type: string;
  sha256: string | null;
  storage_path: string;
  status: string;
  upload_confirmed_at: string | null;
};

/**
 * Validates (type, size, sniffed MIME, extension, full decode), stores the
 * original under a generated path in the private bucket, verifies that the
 * stored object can be read back, records its SHA-256 and quality, then queues
 * extraction. uploadKey makes retries idempotent per client. The original file
 * name is display metadata only and is never used as an object identifier.
 */
export async function saveDocument(args: {
  clientId: string;
  docType: string;
  file: File;
  actor: Actor;
  uploadKey?: string | null;
}): Promise<SaveResult> {
  if (!(DOC_TYPES as readonly string[]).includes(args.docType)) {
    return { ok: false, code: "invalid_input", error: "Unknown document type", status: 400 };
  }
  if (args.uploadKey && !/^[\w-]{16,200}$/.test(args.uploadKey)) {
    return { ok: false, code: "invalid_input", error: "Invalid upload id", status: 400 };
  }

  const read = await readUpload(args.file);
  if ("error" in read) return { ok: false, code: "invalid_file", error: read.error, status: 400 };
  if (!extensionMatches(args.file.name, read.mime)) {
    return { ok: false, code: "invalid_file", error: "The file extension does not match its contents", status: 400 };
  }
  const quality = await assessQuality(read.bytes, read.mime);
  if (!quality.decoded) {
    return { ok: false, code: "corrupt_file", error: "The file could not be decoded. Please upload a clear copy.", status: 400 };
  }

  const hash = sha256Hex(read.bytes);
  if (args.uploadKey) {
    const [existing] = await sql()`
      select id,doc_type,sha256,storage_path,status,upload_confirmed_at
      from documents
      where client_id=${args.clientId} and upload_key=${args.uploadKey}
      limit 1` as unknown as ExistingUpload[];
    if (existing) {
      if (existing.doc_type !== args.docType || existing.sha256 !== hash) {
        return { ok: false, code: "idempotency_conflict", error: "This upload id was already used for a different document", status: 409 };
      }
      if (!existing.upload_confirmed_at) {
        return { ok: false, code: "upload_incomplete", error: "The previous upload did not finish. Retry the upload.", status: 409 };
      }
      try {
        const stored = await downloadObject(existing.storage_path);
        if (sha256Hex(stored) !== hash) throw new Error("Stored object hash mismatch");
      } catch (error) {
        console.error(error);
        return { ok: false, code: "storage_error", error: "The stored document could not be verified. Retry the upload.", status: 502 };
      }
      return { ok: true, id: existing.id, status: existing.status, replayed: true };
    }
  }

  if (!(await hit("document_upload_hour", `client:${args.clientId}`))) {
    return { ok: false, code: "rate_limited", error: "Upload limit reached for this client (10 per hour)", status: 429 };
  }

  const id = randomUUID();
  const ext = read.mime === "application/pdf" ? "pdf" : read.mime.split("/")[1];
  const path = `${args.clientId}/${id}/original.${ext}`;
  const thumbPath = read.mime.startsWith("image/") ? `${args.clientId}/${id}/thumb.webp` : null;

  try {
    await uploadObject(path, read.bytes, read.mime);
    const stored = await downloadObject(path);
    if (sha256Hex(stored) !== hash) throw new Error("Stored object verification failed");
    if (thumbPath) await uploadObject(thumbPath, await thumbnail(read.bytes), "image/webp");
  } catch (error) {
    if (error instanceof StorageNotConfigured) {
      return { ok: false, code: "NOT_CONFIGURED", error: "Document storage is NOT_CONFIGURED", status: 503 };
    }
    console.error(error);
    await removeObject(path).catch(() => undefined);
    if (thumbPath) await removeObject(thumbPath).catch(() => undefined);
    return { ok: false, code: "storage_error", error: "Could not store and verify the file", status: 502 };
  }

  try {
    await sql().begin(async (tx) => {
      await tx`
        insert into documents (
          id, client_id, doc_type, storage_path, thumbnail_path, file_name, mime_type, size_bytes,
          sha256, quality, page_count, width, height, uploaded_by, status, upload_key, upload_confirmed_at
        ) values (
          ${id}, ${args.clientId}, ${args.docType}, ${path}, ${thumbPath}, ${args.file.name.slice(0, 200)}, ${read.mime},
          ${read.bytes.byteLength}, ${hash}, ${tx.json(quality as never)}, ${quality.page_count}, ${quality.width},
          ${quality.height}, ${args.actor.staffId}, 'pending', ${args.uploadKey ?? null}, now()
        )`;
      await logActivity(tx, {
        clientId: args.clientId,
        action: "document_uploaded",
        actor: args.actor,
        entityType: "document",
        entityId: id,
        newValue: {
          doc_type: args.docType,
          file_name: args.file.name,
          size_bytes: read.bytes.byteLength,
          sha256: hash,
          upload_key: args.uploadKey ?? null,
          storage_verified: true,
          advisories: quality.advisories,
        },
      });
      await enqueue(tx, {
        type: "document_extraction",
        entityId: id,
        dedupeKey: `extract:${id}:1`,
        traceId: args.actor.traceId,
        maxAttempts: 3,
      });
    });
    return { ok: true, id, status: "pending", replayed: false };
  } catch (error) {
    console.error(error);
    await removeObject(path).catch((cleanupError) => console.error("orphan cleanup failed", path, cleanupError));
    if (thumbPath) await removeObject(thumbPath).catch(() => undefined);

    if (args.uploadKey) {
      const [existing] = await sql()`
        select id,doc_type,sha256,storage_path,status,upload_confirmed_at
        from documents
        where client_id=${args.clientId} and upload_key=${args.uploadKey}
        limit 1` as unknown as ExistingUpload[];
      if (existing && existing.doc_type === args.docType && existing.sha256 === hash && existing.upload_confirmed_at) {
        return { ok: true, id: existing.id, status: existing.status, replayed: true };
      }
    }
    return { ok: false, code: "server_error", error: "Could not record the document", status: 500 };
  }
}
