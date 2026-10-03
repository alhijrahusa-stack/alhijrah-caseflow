import { amazonErrorResponse, secretResponse } from "@/lib/amazon/api";
import { revealAmazonEmail } from "@/lib/amazon/service";
import { RevealAmazonEmailSchema } from "@/lib/amazon/validation";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const input = RevealAmazonEmailSchema.parse(await req.json().catch(() => undefined));
    const value = await revealAmazonEmail(guard.session, input.id, input.field, input.intent, traceId);
    return secretResponse(value, traceId);
  } catch (error) {
    return amazonErrorResponse(error, traceId);
  }
}
