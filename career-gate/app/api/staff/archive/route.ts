import { z } from "zod";
import { getStaffSession, withStaff, type Tx } from "@/lib/auth";
import { sql } from "@/lib/db";
import { dbErrorResponse, err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { ActionError, logActivity } from "@/lib/service";
import { archiveClient } from "@/lib/client-archive";
import { staffOperation } from "@/lib/staff-operation";

export const runtime = "nodejs";

const ArchiveSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("archive"), client_id: z.uuid(), reason: z.string().trim().min(1).max(500), operation_id: z.uuid().optional() }),
  z.object({ operation: z.literal("restore"), client_id: z.uuid(), operation_id: z.uuid().optional() }),
]);

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const session = await getStaffSession();
  if (!session) return err("unauthorized", "Sign in required", 401, traceId);
  if (session.staff.role !== "admin" && session.staff.role !== "manager") {
    return err("forbidden", "Management access required", 403, traceId);
  }

  const parsed = ArchiveSchema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return err("invalid_input", "Invalid archive request", 400, traceId);
  const input = parsed.data;

  try {
    const updateArchive = (tx: Tx) => staffOperation(tx, session, input.operation_id, `client_${input.operation}`, input, async () => {
      if (input.operation === "archive") return archiveClient(tx, session, input.client_id, input.reason, traceId);
      const [client] = await tx`
        select id, deleted_at, deleted_by, delete_reason, manager_review_id
        from clients
        where id = ${input.client_id}
        for update`;
      if (!client) throw new ActionError("not_found", "Client not found", 404);
      if (client.manager_review_id) throw new ActionError("manager_review_pending", "Resolve the manager review before restoring this file", 409);

      if (!client.deleted_at) return { id: client.id, changed: false, archived: false };
      await tx`
        update clients
        set deleted_at = null,
            deleted_by = null,
            delete_reason = null,
            updated_at = now()
        where id = ${client.id}`;
      await logActivity(tx, {
        clientId: client.id,
        action: "client_updated",
        actor: { staffId: session.staff.id, traceId },
        entityType: "client",
        entityId: client.id,
        oldValue: {
          deleted_at: client.deleted_at,
          deleted_by: client.deleted_by,
          delete_reason: client.delete_reason,
        },
        newValue: { deleted_at: null, deleted_by: null, delete_reason: null, restored_from_archive: true },
      });
      return { id: client.id, changed: true, archived: false };
    });
    const result = input.operation === "archive"
      ? await withStaff(session, updateArchive)
      : await sql().begin(updateArchive);

    return ok(result, 200, traceId);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    return dbErrorResponse(error, traceId);
  }
}
