import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import { operationalAnswer } from "@/lib/operational-assistant";
import { ActionError } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return err("forbidden", "Operational assistant requires manager or admin access", 403, traceId);
  const question = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (question.length > 500) return err("invalid_input", "Use a question of 500 characters or less", 400, traceId);
  try {
    const response = ok({ answer: await operationalAnswer(guard.session, question) }, 200, traceId);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    console.error("operational_assistant_failed", { traceId });
    return err("assistant_unavailable", "Operational data is unavailable. Try again.", 503, traceId);
  }
}
