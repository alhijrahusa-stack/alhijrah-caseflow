import { z } from "zod";
import { resolveStaffForAuthUser, setSessionCookies } from "@/lib/auth";
import { databaseConfigMessage } from "@/lib/db";
import { err, ipHash, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { verifyEmailOtp } from "@/lib/providers/supabase-auth";
import { hit, remaining, securityEvent } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const parsed = z.object({ email: z.email().max(200), code: z.string().regex(/^\d{6}$/) }).safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return err("invalid_input", "Enter the 6-digit code", 400, traceId);

  const ip = ipHash(req);
  if ((await remaining("login_failed_15min", ip)) <= 0) {
    await securityEvent({ event: "login_locked", ipHash: ip, route: "/api/staff/auth/verify", traceId });
    return err("rate_limited", "Too many failed sign-in attempts. Try again in 15 minutes.", 429, traceId);
  }

  const email = parsed.data.email.toLowerCase();
  const r = await verifyEmailOtp(email, parsed.data.code);
  if (!r.ok) {
    if (r.code === "NOT_CONFIGURED") return err("NOT_CONFIGURED", r.message, 503, traceId);
    await hit("login_failed_15min", ip);
    await securityEvent({ event: "login_failed", ipHash: ip, route: "/api/staff/auth/verify", traceId });
    return err("invalid_code", "That code is not valid or has expired", 401, traceId);
  }

  let staffId: string | null;
  try {
    staffId = await resolveStaffForAuthUser({ id: r.data.user.id, email: r.data.user.email });
  } catch (error) {
    const message = databaseConfigMessage(error);
    if (message) return err("DATABASE_NOT_READY", message, 503, traceId);
    throw error;
  }

  if (!staffId) {
    await securityEvent({ event: "login_not_staff", ipHash: ip, route: "/api/staff/auth/verify", traceId });
    return err("forbidden", "This account is not an active Career Gate staff member", 403, traceId);
  }

  await setSessionCookies(r.data.access_token, r.data.refresh_token, r.data.expires_in);
  return ok({ signed_in: true }, 200, traceId);
}
