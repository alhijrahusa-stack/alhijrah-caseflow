import { withStaff } from "@/lib/auth";
import { err, ipHash } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { authorize, staffGuard } from "@/lib/staff-api";
import { downloadObject, StorageNotConfigured } from "@/lib/storage";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Streams the small derived thumbnail to an authorized staff member (never cached). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return err("not_found", "Not found", 404, traceId);
  const authz = await authorize(req, g.session, "view_document", { entity: { table: "documents", id } }, traceId);
  if (!authz.ok) return authz.response;
  const doc = await withStaff(g.session, async (tx) => (await tx`select id, client_id, thumbnail_path from documents where id = ${id}`)[0]);
  if (!doc?.thumbnail_path) return err("not_found", "No thumbnail", 404, traceId);
  try {
    const bytes = await downloadObject(doc.thumbnail_path);
    await withStaff(g.session, (tx) => tx`insert into document_access_log (document_id, client_id, staff_id, ip_address, access_type)
                                          values (${doc.id}, ${doc.client_id}, ${g.session.staff.id}, ${ipHash(req)}, 'thumbnail')`);
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof StorageNotConfigured) return err("NOT_CONFIGURED", e.message, 503, traceId);
    return err("storage_error", "Thumbnail unavailable", 502, traceId);
  }
}
