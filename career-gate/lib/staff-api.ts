import "server-only";
import { getStaffSession, type StaffSession } from "@/lib/auth";
import { clientOf, clientScope, roleAllows, staffPermissionAllows, type ActionName } from "@/lib/authz";
import { err, ipHash } from "@/lib/http";
import { hit, securityEvent } from "@/lib/ratelimit";

type Guard = { session: StaffSession; response: null } | { session: null; response: Response };

async function accountingPermission(req: Request): Promise<ActionName | null> {
  if (new URL(req.url).pathname !== "/api/staff/accounting") return null;
  const body = await req.clone().json().catch(() => null) as { operation?: string; status?: string } | null;
  if (body?.operation === "record_transaction") return "record_transaction";
  if (body?.operation !== "update_commission") return null;
  if (body.status === "approved") return "approve_commission";
  if (body.status === "paid") return "pay_commission";
  if (body.status === "cancelled") return "cancel_commission";
  if (body.status === "reversed") return "reverse_commission";
  return null;
}

/** Authenticates the staff caller and applies per-staff mutation and route-level permission controls. */
export async function staffGuard(req: Request, traceId: string, opts: { mutation: boolean }): Promise<Guard> {
  const session = await getStaffSession();
  if (!session) return { session: null, response: err("unauthorized", "Sign in required", 401, traceId) };
  if (opts.mutation) {
    const key = `staff:${session.staff.id}`;
    const okMin = await hit("staff_action_minute", key);
    const okHour = await hit("staff_action_hour", key);
    if (!okMin || !okHour) {
      await securityEvent({ event: "rate_limited_staff_action", staffId: session.staff.id, ipHash: ipHash(req), route: new URL(req.url).pathname, traceId });
      return { session: null, response: err("rate_limited", "Too many actions. Wait a moment and try again.", 429, traceId) };
    }

    const permission = await accountingPermission(req);
    if (permission && (!roleAllows(session.staff.role, permission) || !(await staffPermissionAllows(session.staff.id, permission)))) {
      await securityEvent({
        event: "access_denied",
        staffId: session.staff.id,
        ipHash: ipHash(req),
        route: new URL(req.url).pathname,
        detail: { action: permission, role: session.staff.role },
        traceId,
      });
      return { session: null, response: err("forbidden", "Your access profile does not allow this action", 403, traceId) };
    }
  }
  return { session, response: null };
}

/** Role is the upper bound; granular permission and client scope are enforced beneath it. */
export async function authorize(
  req: Request,
  session: StaffSession,
  action: ActionName,
  target: { clientId?: string | null; entity?: { table: Parameters<typeof clientOf>[0]; id: string } | null },
  traceId: string,
): Promise<{ ok: true; clientId: string | null } | { ok: false; response: Response }> {
  const deny = async (status: 403 | 404, message: string, detail: Record<string, unknown>) => {
    if (status === 403) {
      await securityEvent({ event: "access_denied", staffId: session.staff.id, ipHash: ipHash(req), route: new URL(req.url).pathname, detail: { action, ...detail }, traceId });
    }
    return { ok: false as const, response: err(status === 403 ? "forbidden" : "not_found", message, status, traceId) };
  };
  if (!roleAllows(session.staff.role, action)) return deny(403, "Your role does not allow this action", { role: session.staff.role });
  if (!(await staffPermissionAllows(session.staff.id, action))) {
    return deny(403, "Your access profile does not allow this action", { role: session.staff.role });
  }
  let clientId = target.clientId ?? null;
  if (target.entity) {
    const ref = await clientOf(target.entity.table, target.entity.id);
    if (!ref.found) return deny(404, "Not found", {});
    clientId = ref.clientId;
  }
  if (clientId) {
    const scope = await clientScope(session, clientId);
    if (!scope.ok) return deny(scope.status, scope.reason, { client_id: clientId });
  }
  return { ok: true, clientId };
}
