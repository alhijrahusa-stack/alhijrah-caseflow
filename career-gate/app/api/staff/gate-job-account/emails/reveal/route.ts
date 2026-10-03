import { gateJobErrorResponse, secretResponse } from "@/lib/gate-job-account/api";
import { revealGateJobEmail } from "@/lib/gate-job-account/service";
import { RevealGateJobEmailSchema } from "@/lib/gate-job-account/validation";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const input = RevealGateJobEmailSchema.parse(await req.json().catch(() => undefined));
    const value = await revealGateJobEmail(guard.session, input.id, input.field, input.intent, traceId);
    return secretResponse(value, traceId);
  } catch (error) {
    return gateJobErrorResponse(error, traceId);
  }
}
