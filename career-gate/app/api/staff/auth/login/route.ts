import { z } from "zod";
import { databaseConfigMessage, sql } from "@/lib/db";
import { err, ipHash, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { registry } from "@/lib/providers/config";
import { sendEmail } from "@/lib/providers/messaging";
import { generateEmailOtp, sendEmailOtp } from "@/lib/providers/supabase-auth";
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
    // Supabase remains the authentication authority. Generate its OTP once and use
    // Resend as the primary transport so a broken Supabase SMTP configuration does
    // not add latency or become a single point of failure.
    const generated = await generateEmailOtp(email);
    if (generated.ok) {
      const delivery = await sendEmail(
        email,
        "Career Gate — Staff Sign-In Code | رمز تسجيل دخول الموظفين",
        `CAREER GATE\n\nStaff Sign-In Code / رمز تسجيل دخول الموظفين\n\n${generated.data.email_otp}\n\nThis code is temporary. If you did not request it, ignore this email.\nهذا الرمز مؤقت. إذا لم تطلب تسجيل الدخول، تجاهل هذه الرسالة.`,
      );

      if (delivery.status === "sent") {
        console.info(JSON.stringify({ trace_id: traceId, route: ROUTE, result: "otp_delivery_sent", provider: delivery.provider }));
        return ok({ message: GENERIC }, 200, traceId);
      }

      console.warn(JSON.stringify({
        trace_id: traceId,
        route: ROUTE,
        result: "primary_delivery_unavailable",
        provider: delivery.provider,
        delivery_status: delivery.status,
      }));
    } else {
      console.warn(JSON.stringify({ trace_id: traceId, route: ROUTE, result: "otp_generation_unavailable", error_code: generated.code }));
    }

    // Controlled failover only. This keeps sign-in recoverable if Resend or the
    // service-role generation path is unavailable, without changing Auth authority.
    const fallback = await sendEmailOtp(email, true);
    if (!fallback.ok) {
      console.error(JSON.stringify({ trace_id: traceId, route: ROUTE, result: "all_delivery_paths_failed", error_code: fallback.code }));
      return err(fallback.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "AUTH_PROVIDER_ERROR", "Could not send the sign-in code", fallback.code === "NOT_CONFIGURED" ? 503 : 502, traceId);
    }

    console.info(JSON.stringify({ trace_id: traceId, route: ROUTE, result: "otp_delivery_sent", provider: "supabase_auth_mailer" }));
  }

  return ok({ message: GENERIC }, 200, traceId);
}
