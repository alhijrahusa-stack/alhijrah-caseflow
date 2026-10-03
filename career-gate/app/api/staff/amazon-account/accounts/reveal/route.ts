import { amazonErrorResponse, secretResponse } from "@/lib/amazon/api";
import { revealAmazonAccount } from "@/lib/amazon/service";
import { RevealAmazonAccountSchema } from "@/lib/amazon/validation";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const input = RevealAmazonAccountSchema.parse(await req.json().catch(() => undefined));
    return secretResponse(await revealAmazonAccount(guard.session, input.account_id, input.field, input.intent, traceId), traceId);
  } catch (error) {
    return amazonErrorResponse(error, traceId);
  }
}
