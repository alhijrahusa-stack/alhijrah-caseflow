import { verifyAuditChain } from "@/lib/audit-chain";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { securityEvent } from "@/lib/ratelimit";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Admin-only: recompute the activity audit chain and report the first broken link, if any. */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;
  if (g.session.staff.role !== "admin") {
    await securityEvent({ event: "access_denied", staffId: g.session.staff.id, route: "/api/staff/audit-integrity", traceId });
    return err("forbidden", "Admin only", 403, traceId);
  }
  return ok({ audit_chain: await verifyAuditChain(traceId) }, 200, traceId);
}
