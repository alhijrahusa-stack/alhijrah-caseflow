import { sql } from "@/lib/db";
import { clientIp, err, ok, staffAllowed } from "@/lib/http";
import { logActivity } from "@/lib/service";
import { signedUrl } from "@/lib/storage";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Issues a 10-minute signed URL and records the access. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await staffAllowed())) return err("unauthorized", "Office access required", 401);
  const { id } = await ctx.params;
  if (!UUID.test(id)) return err("not_found", "Document not found", 404);
  const handledBy = new URL(req.url).searchParams.get("handled_by");
  if (handledBy && !UUID.test(handledBy)) return err("invalid_staff", "Invalid staff member");

  const db = sql();
  const [doc] = await db`select id, client_id, storage_path, file_name from documents where id = ${id}`;
  if (!doc) return err("not_found", "Document not found", 404);
  if (handledBy) {
    const [s] = await db`select id from staff_directory where id = ${handledBy} and active`;
    if (!s) return err("invalid_staff", "Unknown or inactive staff member");
  }

  let signed;
  try {
    signed = await signedUrl(doc.storage_path, doc.file_name);
  } catch (e) {
    console.error(e);
    return err("storage_error", "Could not create a download link", 502);
  }

  await db.begin(async (tx) => {
    await tx`insert into document_access_log (document_id, client_id, handled_by, ip_address)
             values (${doc.id}, ${doc.client_id}, ${handledBy}, ${clientIp(req)})`;
    await logActivity(tx, {
      clientId: doc.client_id, action: "document_opened", handledBy, entityType: "document", entityId: doc.id,
    });
  });

  return ok({ url: signed.url, expires_in: signed.expiresIn });
}
