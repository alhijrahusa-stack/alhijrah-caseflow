import { z } from "zod";
import { fail, json, parseBody, requireStaff } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = process.env.DOCUMENTS_BUCKET || "client-documents";
const Schema = z.object({ documentId: z.uuid() });
const OCR_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff"]);
const MAX_BYTES = 10 * 1024 * 1024;

/** Extracts text from an uploaded image and stores it on the document row. */
export async function POST(req: Request) {
  const { staff, response } = await requireStaff();
  if (response) return response;
  const { data, response: bad } = await parseBody(req, Schema);
  if (bad) return bad;
  const db = staff.supabase;

  const { data: doc } = await db
    .from("documents").select("id, client_id, storage_path, mime_type, size_bytes")
    .eq("id", data.documentId).maybeSingle();
  if (!doc) return fail("Not found", 404);
  if (!OCR_TYPES.has(doc.mime_type)) return fail("OCR supports images only", 415);
  if (doc.size_bytes > MAX_BYTES) return fail("File too large for OCR", 413);

  await db.from("documents").update({ ocr_status: "pending" }).eq("id", doc.id);

  const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(doc.storage_path);
  if (dlErr || !blob) {
    await db.from("documents").update({ ocr_status: "failed" }).eq("id", doc.id);
    return fail("Could not read file", 500);
  }

  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data: result } = await worker.recognize(Buffer.from(await blob.arrayBuffer()));
    const text = result.text.trim();
    await db.from("documents").update({ ocr_status: "done", ocr_text: text }).eq("id", doc.id);
    await db.from("activity").insert({
      client_id: doc.client_id, actor: staff.user.id, type: "ocr_completed",
      summary: `OCR extracted ${text.length} characters`, data: { document_id: doc.id },
    });
    return json({ text, confidence: result.confidence });
  } catch (e) {
    await db.from("documents").update({ ocr_status: "failed" }).eq("id", doc.id);
    return fail(e instanceof Error ? e.message : "OCR failed", 500);
  } finally {
    await worker.terminate();
  }
}
