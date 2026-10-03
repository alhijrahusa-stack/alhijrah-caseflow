import { amazonErrorResponse } from "@/lib/amazon/api";
import { updateAmazonAccount } from "@/lib/amazon/service";
import { ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    return ok({ account: await updateAmazonAccount(guard.session, await req.json().catch(() => undefined), traceId) }, 200, traceId);
  } catch (error) {
    return amazonErrorResponse(error, traceId);
  }
}
