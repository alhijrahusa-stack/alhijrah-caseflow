import { withStaff } from "@/lib/auth";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;
  if (!["admin", "manager"].includes(g.session.staff.role)) return err("forbidden", "Admin or manager only", 403, traceId);
  const status = new URL(req.url).searchParams.get("status") ?? "open";
  if (!["open", "resolved", "ignored"].includes(status)) return err("invalid_input", "Invalid status", 400, traceId);
  const alerts = await withStaff(g.session, (tx) => tx`
    select a.*, c.ref, c.full_name from audit_alerts a join clients c on c.id = a.client_id
    where a.status = ${status}
    order by case a.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, a.created_at desc
    limit 200`);
  return ok({ alerts }, 200, traceId);
}
