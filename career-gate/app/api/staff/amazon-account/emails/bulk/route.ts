import { amazonErrorResponse } from "@/lib/amazon/api";
import { bulkAmazonEmails } from "@/lib/amazon/service";
import { ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    return ok(await bulkAmazonEmails(guard.session, await req.json().catch(() => undefined), traceId), 200, traceId);
  } catch (error) {
    return amazonErrorResponse(error, traceId);
  }
}
