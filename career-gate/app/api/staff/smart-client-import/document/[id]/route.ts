import { z } from "zod";
import { ActionError } from "@/lib/service";
import { err } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import { assertImportReviewPermission, getImportDocument } from "@/lib/smart-client-import";
import { downloadObjectStream, StorageNotConfigured } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PREVIEW_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  try {
    await assertImportReviewPermission(guard.session);
    const { id } = await context.params;
    const document = await getImportDocument(guard.session, z.uuid().parse(id));
    if (!PREVIEW_MIME_TYPES.has(document.mime_type)) return err("unsupported_preview", "This document type cannot be previewed", 415, traceId);
    const range = req.headers.get("range") ?? undefined;
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return err("invalid_range", "Invalid document byte range", 416, traceId);
    const stored = await downloadObjectStream(document.storage_reference, range);
    const filename = document.original_filename.replace(/[\\/"\x00-\x1f\x7f]/g, "_").slice(0, 180) || "document";
    const fallback = filename.replace(/[^\x20-\x7e]/g, "_");
    const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    const headers = new Headers({
      "Content-Type": document.mime_type,
      "Content-Disposition": `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; object-src 'none'",
      "Referrer-Policy": "no-referrer",
    });
    const contentRange = stored.headers.get("content-range");
    if (contentRange && /^bytes (?:\d+-\d+|\*)\/(?:\d+|\*)$/.test(contentRange)) headers.set("Content-Range", contentRange);
    if (stored.status === 416) {
      await stored.body?.cancel();
      return new Response(null, { status: 416, headers });
    }
    const contentLength = stored.headers.get("content-length");
    if (!stored.headers.get("content-encoding") && contentLength && /^\d+$/.test(contentLength)) headers.set("Content-Length", contentLength);
    if (stored.headers.get("accept-ranges") === "bytes") headers.set("Accept-Ranges", "bytes");
    return new Response(stored.body, { status: stored.status === 206 ? 206 : 200, headers });
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    if (error instanceof z.ZodError) return err("invalid_id", "Invalid document ID", 400, traceId);
    if (error instanceof StorageNotConfigured) return err("NOT_CONFIGURED", "Document storage is not configured", 503, traceId);
    return err("document_open_failed", "Unable to open document", 500, traceId);
  }
}
