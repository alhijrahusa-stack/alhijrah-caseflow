import { z } from "zod";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { answerStaffQuestion } from "@/lib/staff-assistant";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";
export const maxDuration = 35;

const BodySchema = z.object({
  question: z.string().trim().min(2).max(1200),
  route: z.string().trim().max(240).default("/staff"),
});

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("invalid_input", "Enter a valid staff question", 400, traceId);

  const result = await answerStaffQuestion(guard.session, parsed.data.question, parsed.data.route);
  if (!result.ok) {
    const status = result.code === "NOT_CONFIGURED" ? 503 : result.code === "TIMEOUT" ? 504 : 502;
    return err(result.code, result.message, status, traceId);
  }
  return ok({
    answer: result.answer,
    recommended_actions: result.recommended_actions,
    source_keys: result.source_keys,
    references: result.references,
    model: result.model,
  }, 200, traceId);
}
