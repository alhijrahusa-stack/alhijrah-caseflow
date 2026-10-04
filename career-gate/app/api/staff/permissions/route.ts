import { z } from "zod";
import { dbErrorResponse, err, ipHash, ok } from "@/lib/http";
import { observe, traceIdFrom } from "@/lib/obs";
import { authorize, staffGuard } from "@/lib/staff-api";
import { StaffPermissionMutationError, updateStaffPermissions } from "@/lib/staff-permissions";

export const runtime = "nodejs";

const RequestSchema = z.object({
  staff_id: z.uuid(),
  permission_mode: z.enum(["full", "custom"]),
  permissions: z.array(z.string().min(1).max(80)).max(100),
});

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  return observe({ trace_id: traceId, route: "/api/staff/permissions", operation: "staff_permissions_update" }, async () => {
    const guard = await staffGuard(req, traceId, { mutation: true });
    if (guard.response) return guard.response;
    const session = guard.session;

    const parsed = RequestSchema.safeParse(await req.json().catch(() => undefined));
    if (!parsed.success) return err("invalid_input", "Invalid permission update", 400, traceId);

    const authz = await authorize(req, session, "manage_staff_permissions", {}, traceId);
    if (!authz.ok) return authz.response;

    try {
      const result = await updateStaffPermissions(session, {
        staffId: parsed.data.staff_id,
        permissionMode: parsed.data.permission_mode,
        permissions: parsed.data.permissions,
        traceId,
        ipHash: ipHash(req),
      });
      return ok(result, 200, traceId);
    } catch (error) {
      if (error instanceof StaffPermissionMutationError) return err(error.code, error.message, error.status, traceId);
      return dbErrorResponse(error, traceId);
    }
  }, (res) => ({ result: res.status < 400 ? "ok" : "error", error_code: res.status < 400 ? null : String(res.status) }));
}
