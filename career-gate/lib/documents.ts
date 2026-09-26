import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { DOC_TYPES } from "@/lib/domain";
import { readUpload, safeFileName } from "@/lib/files";
import { logActivity } from "@/lib/service";
import { removeObject, uploadObject } from "@/lib/storage";

export type DocType = (typeof DOC_TYPES)[number];

/**
 * Stores the file in the private bucket, then records it. If the database
 * write fails the object is removed, so no orphaned file is left behind.
 */
export async function saveDocument(args: {
  clientId: string;
  docType: string;
  file: File;
  uploadedBy: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string; status: number }> {
  if (!(DOC_TYPES as readonly string[]).includes(args.docType)) {
    return { ok: false, error: "Unknown document type", status: 400 };
  }
  const read = await readUpload(args.file);
  if ("error" in read) return { ok: false, error: read.error, status: 400 };

  const path = `${args.clientId}/${randomUUID()}-${safeFileName(args.file.name)}`;
  try {
    await uploadObject(path, read.bytes, read.mime);
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not store the file", status: 502 };
  }

  try {
    const id = await sql().begin(async (tx) => {
      const [doc] = await tx`
        insert into documents (client_id, doc_type, storage_path, file_name, mime_type, size_bytes, uploaded_by)
        values (${args.clientId}, ${args.docType}, ${path}, ${args.file.name.slice(0, 200)}, ${read.mime},
                ${read.bytes.byteLength}, ${args.uploadedBy})
        returning id`;
      await logActivity(tx, {
        clientId: args.clientId, action: "document_uploaded", handledBy: args.uploadedBy,
        entityType: "document", entityId: doc.id,
        newValue: { doc_type: args.docType, file_name: args.file.name, size_bytes: read.bytes.byteLength },
      });
      return doc.id as string;
    });
    return { ok: true, id };
  } catch (e) {
    console.error(e);
    await removeObject(path).catch((err) => console.error("orphan cleanup failed", path, err));
    return { ok: false, error: "Could not record the document", status: 500 };
  }
}
