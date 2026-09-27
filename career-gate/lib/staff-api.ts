import "server-only";
import { getStaffSession, type StaffSession } from "@/lib/auth";
import { clientOf, clientScope, roleAllows, type ActionName } from "@/lib/authz";
import { err, ipHash } from "@/lib/http";
import { hit, securityEvent } from "@/lib/ratelimit";

type Guard = { session: StaffSession; response: null } | { session: null; response: Response };

/** Authenticates the staff caller and applies the per-staff mutation limits. */
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
  }
  return { session, response: null };
}

/** Role and client-scope check. Denials return 403 (or 404) and are logged. */
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
