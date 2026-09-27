import { z } from "zod";
import { err, ipHash, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { hit, securityEvent } from "@/lib/ratelimit";
import { publicStatusByIdentifier } from "@/lib/public-status";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const parsed = z.object({ identifier: z.string().trim().min(3).max(200) }).safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return err("invalid_input", "Enter your case number, phone or email", 400, traceId);

  const ip = ipHash(req);
  const allowed15 = await hit("status_lookup_15min", ip);
  const allowedHour = await hit("status_lookup_hour", ip);
  if (!allowed15 || !allowedHour) {
    await securityEvent({ event: "rate_limited_status_lookup", ipHash: ip, route: "/api/status/lookup", traceId });
    return err("rate_limited", "Too many lookups. Try again later.", 429, traceId);
  }

  const status = await publicStatusByIdentifier(parsed.data.identifier);
  if (!status) return err("not_found", "No matching file was found.", 404, traceId);
  return ok({ ref: status.ref }, 200, traceId);
}
