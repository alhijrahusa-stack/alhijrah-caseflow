import { z } from "zod";
import { databaseConfigMessage, sql } from "@/lib/db";
import { err, ipHash, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { registry } from "@/lib/providers/config";
import { sendEmailOtp } from "@/lib/providers/supabase-auth";
import { hit, securityEvent } from "@/lib/ratelimit";

export const runtime = "nodejs";
const GENERIC = "If this email belongs to Career Gate staff, a sign-in code has been sent.";
const ROUTE = "/api/staff/auth/login";

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const parsed = z.object({ email: z.email().max(200) }).safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return err("invalid_input", "Enter a valid email", 400, traceId);

  const s = registry.supabase();
  if (!s.url || !s.anonKey) return err("NOT_CONFIGURED", "Staff sign-in is NOT_CONFIGURED on this server", 503, traceId);

  const ip = ipHash(req);
  if (!(await hit("login_send_15min", ip))) {
    await securityEvent({ event: "rate_limited_login_send", ipHash: ip, route: ROUTE, traceId });
    return err("rate_limited", "Too many sign-in requests. Try again later.", 429, traceId);
  }

  const email = parsed.data.email.toLowerCase();
  const bootstrap = registry.app().adminEmail?.toLowerCase() === email;
  let isStaff = false;

  if (!bootstrap) {
    try {
      const [staff] = await sql()`select id from staff where lower(email) = ${email} and active`;
      isStaff = Boolean(staff);
    } catch (error) {
      const message = databaseConfigMessage(error);
      if (message) return err("DATABASE_NOT_READY", message, 503, traceId);
      throw error;
    }
  }

  if (bootstrap || isStaff) {
    const delivery = await sendEmailOtp(email, true);
    if (!delivery.ok) {
      console.error(JSON.stringify({
        trace_id: traceId,
        route: ROUTE,
        result: "otp_delivery_failed",
        provider: "supabase_auth_mailer",
        error_code: delivery.code,
      }));
      return err(
        delivery.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "AUTH_PROVIDER_ERROR",
        "Could not send the sign-in code",
        delivery.code === "NOT_CONFIGURED" ? 503 : 502,
        traceId,
      );
    }

    console.info(JSON.stringify({ trace_id: traceId, route: ROUTE, result: "otp_delivery_sent", provider: "supabase_auth_mailer" }));
  }

  return ok({ message: GENERIC }, 200, traceId);
}
