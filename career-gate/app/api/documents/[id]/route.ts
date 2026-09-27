import { withStaff } from "@/lib/auth";
import { err, ipHash, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { logActivity } from "@/lib/service";
import { authorize, staffGuard } from "@/lib/staff-api";
import { signedUrl, StorageNotConfigured } from "@/lib/storage";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Authorized, logged, 10-minute signed URL. ?mode=download forces a download. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return err("not_found", "Document not found", 404, traceId);
  const authz = await authorize(req, g.session, "view_document", { entity: { table: "documents", id } }, traceId);
  if (!authz.ok) return authz.response;
  const mode = new URL(req.url).searchParams.get("mode") === "download" ? "download" : "view";

  const doc = await withStaff(g.session, async (tx) => (await tx`select id, client_id, storage_path, file_name from documents where id = ${id}`)[0]);
  if (!doc) return err("not_found", "Document not found", 404, traceId);
  let signed;
  try {
    signed = await signedUrl(doc.storage_path, mode === "download" ? doc.file_name : null);
  } catch (e) {
    if (e instanceof StorageNotConfigured) return err("NOT_CONFIGURED", e.message, 503, traceId);
    console.error(e);
    return err("storage_error", "Could not create a link", 502, traceId);
  }
  await withStaff(g.session, async (tx) => {
    await tx`insert into document_access_log (document_id, client_id, staff_id, ip_address, access_type)
             values (${doc.id}, ${doc.client_id}, ${g.session.staff.id}, ${ipHash(req)}, ${mode})`;
    await logActivity(tx, { clientId: doc.client_id, action: "document_opened", actor: { staffId: g.session.staff.id, traceId }, entityType: "document", entityId: doc.id, newValue: { mode } });
  });
  return ok({ url: signed.url, expires_in: signed.expiresIn }, 200, traceId);
}
