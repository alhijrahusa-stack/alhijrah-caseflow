import { amazonErrorResponse } from "@/lib/amazon/api";
import { confirmAmazonAssignment, releaseAmazonEmail, reserveAmazonEmail } from "@/lib/amazon/service";
import { AmazonAssignmentSchema } from "@/lib/amazon/validation";
import { ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const input = AmazonAssignmentSchema.parse(await req.json().catch(() => undefined));
    if (input.mode === "reserve") return ok({ reservation: await reserveAmazonEmail(guard.session, input.email_id, input.client_id, traceId) }, 200, traceId);
    if (input.mode === "release") return ok({ reservation: await releaseAmazonEmail(guard.session, input.email_id, traceId) }, 200, traceId);
    return ok({ account: await confirmAmazonAssignment(guard.session, input.email_id, input.client_id, traceId) }, 201, traceId);
  } catch (error) {
    return amazonErrorResponse(error, traceId);
  }
}
