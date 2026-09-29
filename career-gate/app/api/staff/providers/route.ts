import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { providerStates, registry } from "@/lib/providers/config";
import { openaiModelStatus } from "@/lib/providers/openai";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

/** Admin capability check: configuration state plus live model availability. */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;
  if (!(["super_admin", "admin"] as const).includes(g.session.staff.role as "super_admin" | "admin")) {
    return err("forbidden", "Admin only", 403, traceId);
  }
  const live = new URL(req.url).searchParams.get("live") === "1";
  const o = registry.openai();
  const v = registry.documentVision();
  return ok({
    states: providerStates(),
    models: live
      ? {
          document_fast: await openaiModelStatus(v.model),
          document_escalation: await openaiModelStatus(v.model),
          agent: await openaiModelStatus(o.agentModel),
          embedding: await openaiModelStatus(o.embeddingModel),
        }
      : null,
  }, 200, traceId);
}
