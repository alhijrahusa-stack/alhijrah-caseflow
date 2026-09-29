import { z } from "zod";
import { withStaff } from "@/lib/auth";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

const Input = z.object({
  staff_id: z.uuid(),
  access_scope: z.enum(["full", "assigned_only"]),
});

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  const session = guard.session;
  if (session.staff.role !== "super_admin") return err("forbidden", "Super Admin access required", 403, traceId);

  const parsed = Input.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return err("invalid_input", "Invalid access policy", 400, traceId);

  const result = await withStaff(session, async (tx) => {
    const [before] = await tx`select id, role, access_scope from staff where id = ${parsed.data.staff_id} for update`;
    if (!before) return null;
    if (before.role === "super_admin") return { id: before.id as string, access_scope: "full" as const, changed: false };
    const [after] = await tx`
      update staff set access_scope = ${parsed.data.access_scope}, updated_at = now()
      where id = ${parsed.data.staff_id}
      returning id, access_scope`;
    await tx`
      insert into staff_security_audit (actor_staff_id, target_staff_id, action, old_value, new_value)
      values (${session.staff.id}, ${parsed.data.staff_id}, 'access_scope_changed',
              ${tx.json({ access_scope: before.access_scope })}, ${tx.json({ access_scope: after.access_scope })})`;
    return { id: after.id as string, access_scope: after.access_scope as "full" | "assigned_only", changed: before.access_scope !== after.access_scope };
  });

  if (!result) return err("not_found", "Staff member not found", 404, traceId);
  return ok(result, 200, traceId);
}
