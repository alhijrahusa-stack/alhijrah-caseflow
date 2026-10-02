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

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const parsed = z.object({ email: z.email().max(200) }).safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return err("invalid_input", "Enter a valid email", 400, traceId);

  const s = registry.supabase();
  if (!s.url || !s.anonKey) return err("NOT_CONFIGURED", "Staff sign-in is NOT_CONFIGURED on this server", 503, traceId);

  const ip = ipHash(req);
  if (!(await hit("login_send_15min", ip))) {
    await securityEvent({ event: "rate_limited_login_send", ipHash: ip, route: "/api/staff/auth/login", traceId });
    return err("rate_limited", "Too many sign-in requests. Try again later.", 429, traceId);
  }

  const email = parsed.data.email.toLowerCase();
  const bootstrap = registry.app().adminEmail?.toLowerCase() === email;
  let isStaff = false;

  // The bootstrap admin can receive the OTP before the database link is created.
  // Non-bootstrap accounts must already exist as active staff.
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
    const primary = await sendEmailOtp(email, true);
    if (!primary.ok) {
      if (primary.code === "NOT_CONFIGURED") return err("NOT_CONFIGURED", primary.message, 503, traceId);
      if (primary.code !== "PROVIDER_ERROR") {
        console.error(JSON.stringify({ trace_id: traceId, route: "/api/staff/auth/login", result: "provider_rejected", error_code: primary.code }));
        return err("AUTH_PROVIDER_ERROR", "Could not send the sign-in code", 502, traceId);
      }

      // Supabase Auth remains the authentication authority. If its SMTP delivery fails,
      // generate a valid Supabase OTP with the service role and deliver that token via
      // the already-supported Resend provider instead of bypassing Auth.
      const generated = await generateEmailOtp(email);
      if (!generated.ok) {
        console.error(JSON.stringify({ trace_id: traceId, route: "/api/staff/auth/login", result: "otp_generation_failed", error_code: generated.code }));
        return err("AUTH_PROVIDER_ERROR", "Could not send the sign-in code", 502, traceId);
      }

      const delivery = await sendEmail(
        email,
        "Career Gate - Staff Sign-In Code رمز تسجيل دخول الموظفين",
        `CAREER GATE\n\nStaff Sign-In Code / رمز تسجيل دخول الموظفين\n\n${generated.data.email_otp}\n\nThis code is temporary. If you did not request it, ignore this email.\nهذا الرمز مؤقت. إذا لم تطلب تسجيل الدخول، تجاهل هذه الرسالة.`,
      );
      if (delivery.status !== "sent") {
        console.error(JSON.stringify({
          trace_id: traceId,
          route: "/api/staff/auth/login",
          result: "fallback_delivery_failed",
          provider: delivery.provider,
          delivery_status: delivery.status,
        }));
        return err(delivery.status === "not_configured" ? "NOT_CONFIGURED" : "AUTH_PROVIDER_ERROR", "Could not send the sign-in code", delivery.status === "not_configured" ? 503 : 502, traceId);
      }

      console.info(JSON.stringify({ trace_id: traceId, route: "/api/staff/auth/login", result: "fallback_delivery_sent", provider: delivery.provider }));
    }
  }

  return ok({ message: GENERIC }, 200, traceId);
}
