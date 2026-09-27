import { z } from "zod";
import { runAction } from "@/lib/actions";
import { withStaff } from "@/lib/auth";
import { dbErrorResponse, err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { ActionError } from "@/lib/service";
import { authorize, staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("resolve"), note: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal("ignore"), reason: z.string().trim().min(1, "A reason is required to ignore an alert").max(1000) }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: true });
  if (g.response) return g.response;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return err("not_found", "Alert not found", 404, traceId);
  const parsed = Body.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return err("invalid_input", parsed.error.issues[0]?.message ?? "Invalid request", 400, traceId);
  const name = parsed.data.action === "resolve" ? "resolve_alert" : "ignore_alert";
  const authz = await authorize(req, g.session, name, { entity: { table: "audit_alerts", id } }, traceId);
  if (!authz.ok) return authz.response;
  try {
    await withStaff(g.session, (tx) => runAction(
      { tx, actor: { staffId: g.session.staff.id, traceId }, role: g.session.staff.role, semantic: [] },
      parsed.data.action === "resolve"
        ? { action: "resolve_alert", alert_id: id, note: parsed.data.note || null }
        : { action: "ignore_alert", alert_id: id, reason: parsed.data.reason },
    ));
    return ok({ status: parsed.data.action === "resolve" ? "resolved" : "ignored" }, 200, traceId);
  } catch (e) {
    if (e instanceof ActionError) return err(e.code, e.message, e.status, traceId);
    return dbErrorResponse(e, traceId);
  }
}
