import { gateJobErrorResponse } from "@/lib/gate-job-account/api";
import { removeGateJobAccount } from "@/lib/gate-job-account/service";
import { GateJobAccountIdSchema } from "@/lib/gate-job-account/validation";
import { ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const { account_id } = GateJobAccountIdSchema.parse(await req.json().catch(() => undefined));
    return ok({ account: await removeGateJobAccount(guard.session, account_id, traceId) }, 200, traceId);
  } catch (error) {
    return gateJobErrorResponse(error, traceId);
  }
}
