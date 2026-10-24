import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { providerStates, registry } from "@/lib/providers/config";
import { geminiLiveProbe, geminiModelStatus } from "@/lib/providers/gemini";
import { openaiModelStatus } from "@/lib/providers/openai";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

/** Admin capability check: configuration state plus live model availability. */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;
  if (g.session.staff.role !== "admin") return err("forbidden", "Admin only", 403, traceId);
  const live = new URL(req.url).searchParams.get("live") === "1";
  const o = registry.openai();
  return ok({
    states: providerStates(),
    models: live
      ? {
          document_fast: await geminiModelStatus("fast"),
          document_escalation: await geminiModelStatus("escalation"),
          agent: await openaiModelStatus(o.agentModel),
          embedding: await openaiModelStatus(o.embeddingModel),
        }
      : null,
  }, 200, traceId);
}

/** An explicit admin-only LIVE test against the real Gemini generateContent API. */
export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: true });
  if (g.response) return g.response;
  if (g.session.staff.role !== "admin") return err("forbidden", "Admin only", 403, traceId);
  let body: unknown;
  try { body = await req.json(); } catch { return err("invalid_input", "Invalid JSON body", 400, traceId); }
  if (!body || typeof body !== "object" || Array.isArray(body) || (body as { action?: unknown }).action !== "gemini_probe") {
    return err("invalid_action", "Unsupported provider action", 400, traceId);
  }
  const [fast, escalation] = await Promise.all([geminiLiveProbe("fast"), geminiLiveProbe("escalation")]);
  return ok({ gemini: { fast, escalation }, check_type: "live_generation" }, 200, traceId);
}
