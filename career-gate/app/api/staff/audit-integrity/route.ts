import { verifyAuditChain } from "@/lib/audit-chain";
import { err, ipHash, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { hit, securityEvent } from "@/lib/ratelimit";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";
export const maxDuration = 60;

const ROUTE = "/api/staff/audit-integrity";

/**
 * Admin-only: recompute the activity audit chain and report the first broken
 * link, if any. `anchor_seq` + `anchor_hash` check the chain against a head
 * recorded earlier outside the database (an `audit_chain_head` log line).
 */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;
  if (g.session.staff.role !== "admin") {
    await securityEvent({ event: "access_denied", staffId: g.session.staff.id, ipHash: ipHash(req), route: ROUTE, traceId });
    return err("forbidden", "Admin only", 403, traceId);
  }
  const params = new URL(req.url).searchParams;
  const seqParam = params.get("anchor_seq");
  const hashParam = params.get("anchor_hash");
  if ((seqParam == null) !== (hashParam == null)) return err("validation", "anchor_seq and anchor_hash go together", 400, traceId);
  let anchor = null;
  if (seqParam != null && hashParam != null) {
    if (!/^[1-9]\d{0,15}$/.test(seqParam) || !/^[0-9a-f]{64}$/.test(hashParam)) return err("validation", "Invalid anchor", 400, traceId);
    anchor = { seq: Number(seqParam), hash: hashParam };
  }
  if (!(await hit("audit_verify_hour", `staff:${g.session.staff.id}`))) {
    await securityEvent({ event: "rate_limited_audit_verify", staffId: g.session.staff.id, ipHash: ipHash(req), route: ROUTE, traceId });
    return err("rate_limited", "Too many integrity checks. Try again later.", 429, traceId);
  }
  const result = await verifyAuditChain({ traceId, anchor });
  if (result.status === "busy") return err("busy", "An integrity check is already running", 409, traceId);
  return ok({ audit_chain: result }, 200, traceId);
}
