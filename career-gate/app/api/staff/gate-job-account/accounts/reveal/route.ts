import { gateJobErrorResponse, secretResponse } from "@/lib/gate-job-account/api";
import { revealGateJobAccount } from "@/lib/gate-job-account/service";
import { RevealGateJobAccountSchema } from "@/lib/gate-job-account/validation";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const input = RevealGateJobAccountSchema.parse(await req.json().catch(() => undefined));
    return secretResponse(await revealGateJobAccount(guard.session, input.account_id, input.field, input.intent, traceId), traceId);
  } catch (error) {
    return gateJobErrorResponse(error, traceId);
  }
}
