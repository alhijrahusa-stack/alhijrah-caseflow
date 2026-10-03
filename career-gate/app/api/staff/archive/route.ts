import { z } from "zod";
import { getStaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { logActivity } from "@/lib/service";

export const runtime = "nodejs";

const RestoreSchema = z.object({ client_id: z.uuid() });

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const session = await getStaffSession();
  if (!session) return err("unauthorized", "Sign in required", 401, traceId);
  if (session.staff.role !== "admin" && session.staff.role !== "manager") {
    return err("forbidden", "Management access required", 403, traceId);
  }

  const parsed = RestoreSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return err("invalid_input", "Invalid client", 400, traceId);

  try {
    const restored = await sql().begin(async (tx) => {
      const [client] = await tx`
        select id, deleted_at, deleted_by, delete_reason
        from clients
        where id = ${parsed.data.client_id}
        for update`;
      if (!client) return null;
      if (!client.deleted_at) return { id: client.id, changed: false };

      await tx`
        update clients
        set deleted_at = null,
            deleted_by = null,
            delete_reason = null,
            updated_at = now()
        where id = ${client.id}`;

      await logActivity(tx, {
        clientId: client.id,
        action: "client_restored",
        actor: { staffId: session.staff.id, traceId },
        entityType: "client",
        entityId: client.id,
        oldValue: {
          deleted_at: client.deleted_at,
          deleted_by: client.deleted_by,
          delete_reason: client.delete_reason,
        },
        newValue: { deleted_at: null, deleted_by: null, delete_reason: null },
      });
      return { id: client.id, changed: true };
    });

    if (!restored) return err("not_found", "Archived client not found", 404, traceId);
    return ok(restored, 200, traceId);
  } catch {
    return err("restore_failed", "Unable to restore client", 500, traceId);
  }
}
