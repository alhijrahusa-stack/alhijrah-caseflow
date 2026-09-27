import { z } from "zod";
import { err, ipHash, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { hit, securityEvent } from "@/lib/ratelimit";
import { cookies } from "next/headers";
import { SESSION_TTL_SECONDS, STATUS_COOKIE, verifyCode } from "@/lib/status-access";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const parsed = z.object({ challenge_id: z.uuid(), code: z.string().trim().max(10) }).safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return err("invalid_code", "The code is not valid", 400, traceId);
  const ip = ipHash(req);
  if (!(await hit("status_verify_15min", ip))) {
    await securityEvent({ event: "rate_limited_status_verify", ipHash: ip, route: "/api/status/verify", traceId });
    return err("rate_limited", "Too many attempts. Try again later.", 429, traceId);
  }
  const r = await verifyCode(parsed.data.challenge_id, parsed.data.code, ip, traceId);
  if (!r.ok) {
    if (r.code === "locked") await securityEvent({ event: "status_otp_locked", ipHash: ip, route: "/api/status/verify", traceId });
    const msg = r.code === "locked" ? "Too many wrong codes. Try again in 15 minutes." : r.code === "expired" ? "This code expired. Request a new one." : "The code is not valid.";
    return err(r.code === "invalid" ? "invalid_code" : r.code, msg, r.code === "locked" ? 429 : 400, traceId);
  }
  (await cookies()).set(STATUS_COOKIE, r.token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS,
  });
  return ok({ ref: r.ref }, 200, traceId);
}
