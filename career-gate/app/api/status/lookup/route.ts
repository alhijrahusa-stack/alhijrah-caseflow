import { z } from "zod";
import { err, ipHash, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { hit, securityEvent } from "@/lib/ratelimit";
import { startLookup } from "@/lib/status-access";

export const runtime = "nodejs";
const GENERIC = "If we find a matching request, we will send a 6-digit code to the contact on file.";
const MIN_MS = 700;

/** Same response and similar timing whether or not anything matched. */
export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const t0 = Date.now();
  const parsed = z.object({ identifier: z.string().trim().min(3).max(200) }).safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return err("invalid_input", "Enter your reference, phone or email", 400, traceId);
  const ip = ipHash(req);
  const a = await hit("status_lookup_15min", ip);
  const b = await hit("status_lookup_hour", ip);
  if (!a || !b) {
    await securityEvent({ event: "rate_limited_status_lookup", ipHash: ip, route: "/api/status/lookup", traceId });
    return err("rate_limited", "Too many lookups. Try again later.", 429, traceId);
  }
  const r = await startLookup(parsed.data.identifier, ip, traceId);
  const wait = MIN_MS - (Date.now() - t0);
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));
  return ok({ challenge_id: r.challengeId, message: GENERIC }, 200, traceId);
}
