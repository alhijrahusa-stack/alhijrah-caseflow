import { z } from "zod";
import { err, ipHash, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { hit, securityEvent } from "@/lib/ratelimit";
import { startLookup } from "@/lib/status-access";

export const runtime = "nodejs";

const GENERIC = "If the information matches a Career Gate file, a verification code has been sent to the contact information already on file.";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const parsed = z.object({ identifier: z.string().trim().min(3).max(200) }).safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return err("invalid_input", "Enter your file number, phone or email", 400, traceId);

  const ip = ipHash(req);
  const a = await hit("status_lookup_15min", ip);
  const b = await hit("status_lookup_hour", ip);
  if (!a || !b) {
    await securityEvent({ event: "rate_limited_status_lookup", ipHash: ip, route: "/api/status/lookup", traceId });
    return err("rate_limited", "Too many lookups. Try again later.", 429, traceId);
  }

  const lookup = await startLookup(parsed.data.identifier, ip, traceId);
  return ok({ challenge_id: lookup.challengeId, message: GENERIC }, 200, traceId);
}
