import { after } from "next/server";
import { ActionSchema, directClientId, entityRef, runAction } from "@/lib/actions";
import { intakeAgentFor } from "@/lib/agent-runs";
import { runAudit } from "@/lib/audit";
import { withStaff } from "@/lib/auth";
import { dbErrorResponse, err, ok } from "@/lib/http";
import { processJobs } from "@/lib/jobs";
import { observe, traceIdFrom } from "@/lib/obs";
import { issuesMessage } from "@/lib/schemas";
import { queueEmbedding } from "@/lib/semantic";
import { ActionError } from "@/lib/service";
import { authorize, staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  return observe({ trace_id: traceId, route: "/api/staff/action", operation: "staff_action" }, async () => {
    const guard = await staffGuard(req, traceId, { mutation: true });
    if (guard.response) return guard.response;
    const session = guard.session;

    const parsed = ActionSchema.safeParse(await req.json().catch(() => undefined));
    if (!parsed.success) return err("invalid_input", issuesMessage(parsed.error), 400, traceId);
    const a = parsed.data;

    const authz = await authorize(req, session, a.action, { clientId: directClientId(a), entity: entityRef(a) }, traceId);
    if (!authz.ok) return authz.response;

    if (a.action === "run_intake_agent") {
      const run = await intakeAgentFor(a.client_id, session.staff.id, traceId);
      return run ? ok({ action: a.action, run }, 200, traceId) : err("not_found", "Client not found", 404, traceId);
    }
    if (a.action === "run_audit_scan") {
      const r = await runAudit(a.client_id ?? null, traceId);
      return ok({ action: a.action, ...r }, 200, traceId);
    }

    const semantic: { source: "note" | "task" | "contact" | "followup"; id: string }[] = [];
    try {
      const result = await withStaff(session, async (tx) => {
        const r = await runAction({ tx, actor: { staffId: session.staff.id, traceId }, role: session.staff.role, semantic }, a);
        for (const s of semantic) await queueEmbedding(tx, s.source, s.id, traceId);
        return r;
      });
      const clientId = authz.clientId ?? (typeof result.client_id === "string" ? result.client_id : null);
      after(async () => {
        if (clientId) await runAudit(clientId, traceId).catch((e) => console.error(e));
        await processJobs(10).catch((e) => console.error(e));
      });
      return ok({ action: a.action, ...result }, 200, traceId);
    } catch (e) {
      if (e instanceof ActionError) return err(e.code, e.message, e.status, traceId);
      return dbErrorResponse(e, traceId);
    }
  }, (res) => ({ result: res.status < 400 ? "ok" : "error", error_code: res.status < 400 ? null : String(res.status) }));
}
