import { amazonErrorResponse } from "@/lib/amazon/api";
import { markAmazonAccountReady } from "@/lib/amazon/service";
import { AmazonAccountIdSchema } from "@/lib/amazon/validation";
import { ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const { account_id } = AmazonAccountIdSchema.parse(await req.json().catch(() => undefined));
    return ok({ account: await markAmazonAccountReady(guard.session, account_id, traceId) }, 200, traceId);
  } catch (error) {
    return amazonErrorResponse(error, traceId);
  }
}
