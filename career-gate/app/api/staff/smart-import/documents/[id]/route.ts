import { withStaff } from "@/lib/auth";
import { err } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import { signedUrl, StorageNotConfigured } from "@/lib/storage";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return err("forbidden", "Import document access requires manager or admin access", 403, traceId);
  const { id } = await ctx.params;
  if (!UUID.test(id)) return err("not_found", "Import document not found", 404, traceId);

  const doc = await withStaff(guard.session, async (tx) => (await tx`
    select id,storage_reference,original_filename
    from client_import_documents
    where id=${id}
  `)[0]);
  if (!doc) return err("not_found", "Import document not found", 404, traceId);

  try {
    const signed = await signedUrl(String(doc.storage_reference), null);
    return Response.json({ ok: true, url: signed.url, expires_in: signed.expiresIn, file_name: String(doc.original_filename), trace_id: traceId }, {
      status: 200,
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof StorageNotConfigured) return err("NOT_CONFIGURED", error.message, 503, traceId);
    return err("storage_error", "Could not create document link", 502, traceId);
  }
}
