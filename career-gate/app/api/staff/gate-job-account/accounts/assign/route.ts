import { gateJobErrorResponse } from "@/lib/gate-job-account/api";
import { confirmGateJobAssignment, releaseGateJobEmail, reserveGateJobEmail } from "@/lib/gate-job-account/service";
import { GateJobAssignmentSchema } from "@/lib/gate-job-account/validation";
import { ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const input = GateJobAssignmentSchema.parse(await req.json().catch(() => undefined));
    if (input.mode === "reserve") return ok({ reservation: await reserveGateJobEmail(guard.session, input.email_id, input.client_id, traceId) }, 200, traceId);
    if (input.mode === "release") return ok({ reservation: await releaseGateJobEmail(guard.session, input.email_id, traceId) }, 200, traceId);
    return ok({ account: await confirmGateJobAssignment(guard.session, input.email_id, input.client_id, traceId) }, 201, traceId);
  } catch (error) {
    return gateJobErrorResponse(error, traceId);
  }
}
